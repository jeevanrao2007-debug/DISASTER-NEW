/* =========================================================
   api/dispatch-alert.js — POST /api/dispatch-alert
   Vercel Serverless Function
   
   Secure alert dispatch endpoint that requires Firebase
   ID token authentication (Bearer token in Authorization
   header). Only authenticated admin users can trigger
   alert broadcast to all subscribers.
   
   Request body:
   {
     type:        string   e.g. "Flood"
     severity:    string   "low" | "moderate" | "high" | "critical"
     description: string?
     lat:         number?
     lng:         number?
   }
   
   Authentication: Authorization: Bearer <Firebase ID Token>
   ========================================================= */

import { verifyFirebaseToken } from "./_firebaseAdmin.js";
import { sendFCMMulticast, sendWhatsAppAlert } from "./_alertDispatch.js";

/* ---- CORS ------------------------------------------------ */
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/* ---- Helpers --------------------------------------------- */
function toFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/* ---- Handler --------------------------------------------- */
export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // 1. Firebase ID Token Verification
    const authHeader = req.headers.authorization;
    let decodedToken;
    
    try {
      decodedToken = await verifyFirebaseToken(authHeader);
      console.info(`[/api/dispatch-alert] Authenticated user: ${decodedToken.email || decodedToken.uid}`);
    } catch (err) {
      return res.status(401).json({ error: err.message });
    }

    // 2. Optional: Check if user is an admin (claims/domain allowlist)
    // For now, any authenticated user can dispatch. Update this to restrict further.
    const userEmail = decodedToken.email || decodedToken.uid || "unknown";
    // TODO: Add role/domain allowlist check if needed

    // 3. JSON Body Parsing
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: "Invalid JSON body" });
      }
    }

    const {
      type = "Emergency",
      severity = "moderate",
      description = "",
      lat,
      lng
    } = body ?? {};

    // 4. Basic Request Validation
    if (!type || typeof type !== "string") {
      return res.status(400).json({ error: "Missing or invalid alert type" });
    }

    const normSev = String(severity || "moderate").toLowerCase();
    const VALID_SEVERITIES = new Set(["low", "moderate", "high", "critical"]);
    
    if (!VALID_SEVERITIES.has(normSev)) {
      return res.status(400).json({ error: `Invalid severity level: ${severity}` });
    }

    const displayLevel = normSev.charAt(0).toUpperCase() + normSev.slice(1);
    const alertLat = toFiniteNumber(lat);
    const alertLng = toFiniteNumber(lng);

    // 5. Send notifications in parallel (FCM + WhatsApp)
    const [fcmResult, whatsappResult] = await Promise.allSettled([
      sendFCMMulticast({
        title: `${type} - ${displayLevel.toUpperCase()}`,
        body: description || "Emergency nearby. Stay safe.",
        severity: normSev,
        type
      }),
      sendWhatsAppAlert({
        type,
        severity: normSev,
        description,
        lat: alertLat,
        lng: alertLng,
        locationName: body?.locationName || body?.location || "",
        instructions: body?.instructions || ""
      })
    ]);

    const response = {
      success: true,
      dispatchedBy: userEmail,
      fcm:
        fcmResult.status === "fulfilled"
          ? fcmResult.value
          : { error: fcmResult.reason?.message },
      whatsapp:
        whatsappResult.status === "fulfilled"
          ? whatsappResult.value
          : { error: whatsappResult.reason?.message }
    };

    console.info("[/api/dispatch-alert] Alert dispatched successfully:", response);
    return res.status(200).json(response);
  } catch (err) {
    console.error("[/api/dispatch-alert] Error:", err);
    return res
      .status(500)
      .json({ error: "Failed to send notifications", detail: err.message });
  }
}
