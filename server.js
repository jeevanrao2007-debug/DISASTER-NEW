import express from "express";
import cors from "cors";
import crypto from "crypto";
import * as SibApiV3Sdk from "@getbrevo/brevo";
import { getAdminDb, getAdminMessaging, verifyFirebaseAuthToken } from "./helpers/firebaseAdmin.js";
import { haversineKm } from "./helpers/geo.js";
import { reverseGeocode } from "./helpers/geocode.js";
import { config, validateConfig } from "./helpers/config.js";
import { initAlertSyncListener } from "./helpers/syncService.js";

// Run secure configuration checks
validateConfig();

// Initialize real-time CrisisMesh sync ingestion
initAlertSyncListener();

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Brevo (formerly Sendinblue) Transactional Email Client
// Free tier allows sending to ANY verified recipient — no domain ownership required.
// ---------------------------------------------------------------------------
const brevoEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();
brevoEmailApi.setApiKey(
  SibApiV3Sdk.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY || ""
);
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || "";
const BREVO_SENDER_NAME = "Disaster Alerts";

// Middleware
app.use(cors());
app.use(express.json());

// Root / Healthcheck route
app.get("/", (req, res) => {
  res.send("Disaster Alert System Express Backend is running.");
});

// Helper for register email normalization
function normalizeEmail(email) {
  if (typeof email !== "string") {
    return null;
  }
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

// POST /register
app.post("/register", async (req, res) => {
  const { email } = req.body || {};
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    res.status(400).json({ success: false, error: "A valid email address is required" });
    return;
  }

  try {
    const db = getAdminDb();
    
    // Prevent duplicate emails
    const snapshot = await db.ref("subscribers")
      .orderByChild("email")
      .equalTo(normalizedEmail)
      .once("value");

    if (snapshot.exists()) {
      res.status(400).json({ success: false, error: "This email is already subscribed" });
      return;
    }

    const newSubRef = db.ref("subscribers").push();
    const record = {
      email: normalizedEmail,
      createdAt: Date.now()
    };

    await newSubRef.set(record);

    res.status(200).json({
      success: true,
      message: "Subscribed successfully",
      record
    });
  } catch (error) {
    console.error("[register] Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to subscribe"
    });
  }
});

// POST /registerPush
app.post("/registerPush", async (req, res) => {
  const { token, lat, lng } = req.body || {};

  if (!token || typeof token !== "string" || !token.trim()) {
    res.status(400).json({ success: false, error: "Valid FCM token is required" });
    return;
  }

  const numLat = Number(lat);
  const numLng = Number(lng);

  if (!Number.isFinite(numLat) || numLat < -90 || numLat > 90 ||
      !Number.isFinite(numLng) || numLng < -180 || numLng > 180) {
    res.status(400).json({ success: false, error: "Valid latitude (-90 to 90) and longitude (-180 to 180) are required" });
    return;
  }

  try {
    const db = getAdminDb();
    // SHA-256 hash token to create a safe, valid RTDB key and avoid duplicates
    const tokenKey = crypto.createHash("sha256").update(token.trim()).digest("hex");
    const subscriberRef = db.ref(`pushSubscribers/${tokenKey}`);

    const record = {
      token: token.trim(),
      lat: numLat,
      lng: numLng,
      updatedAt: Date.now()
    };

    await subscriberRef.set(record);
    console.log(`[registerPush] Registered push subscriber at lat=${numLat}, lng=${numLng}`);

    res.status(200).json({
      success: true,
      message: "Push notification subscription registered successfully",
      record
    });
  } catch (error) {
    console.error("[registerPush] Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to register push subscription"
    });
  }
});

// Helper for alert normalization
function normalizeAlertPayload(input = {}) {
  const type = String(input.type || "Disaster").trim();
  const severity = String(input.severity || input.level || "moderate").trim().toLowerCase();
  const level = String(input.level || input.severity || "Moderate").trim();
  
  let lat = input.lat != null ? Number(input.lat) : null;
  let lng = input.lng != null ? Number(input.lng) : null;

  // If lat/lng missing, try parsing from input.location if formatted as "lat, lng"
  if ((lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) && typeof input.location === "string") {
    const match = input.location.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (match) {
      lat = Number(match[1]);
      lng = Number(match[2]);
    }
  }

  const hasCoordinates = lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng);
  const location = String(input.location || (hasCoordinates ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : "your area")).trim();
  const description = String(input.description || input.desc || "").trim();
  const createdAt = Number.isFinite(Number(input.createdAt)) ? Number(input.createdAt) : Date.now();

  return {
    type,
    severity,
    level,
    location,
    description,
    createdAt,
    lat: hasCoordinates ? lat : null,
    lng: hasCoordinates ? lng : null
  };
}

// POST /dispatchAlert
app.post("/dispatchAlert", async (req, res) => {
  try {
    console.log("[dispatchAlert] Function invoked, verifying auth...");
    const decodedToken = await verifyFirebaseAuthToken(req.headers.authorization || "");
    console.log("[dispatchAlert] Auth verified for:", decodedToken.email || decodedToken.uid);
    const alert = normalizeAlertPayload(req.body || {});
    console.log("[dispatchAlert] Alert payload:", JSON.stringify(alert));

    if (!alert.type) {
      res.status(400).json({ success: false, error: "Alert type is required" });
      return;
    }

    // Reverse geocode if coordinates are present
    if (alert.lat !== null && alert.lng !== null) {
      try {
        console.log(`[dispatchAlert] Reverse geocoding lat=${alert.lat}, lng=${alert.lng}...`);
        const placeName = await reverseGeocode(alert.lat, alert.lng, 5000);
        const rawCoords = `${alert.lat.toFixed(4)}, ${alert.lng.toFixed(4)}`;

        if (placeName && placeName !== rawCoords) {
          alert.location = `${placeName} (${rawCoords})`;
        } else if (placeName) {
          alert.location = placeName;
        }
        console.log("[dispatchAlert] Resolved readable location:", alert.location);
      } catch (geoErr) {
        console.warn("[dispatchAlert] Geocoding error, falling back to location/coords:", geoErr.message);
      }
    }

    const db = getAdminDb();
    console.log("[dispatchAlert] Loading subscribers from database...");
    const snapshot = await db.ref("subscribers").once("value");
    const rawData = snapshot.val();
    console.log("[dispatchAlert] Raw subscribers data:", JSON.stringify(rawData));
    const subscribers = Object.values(rawData || {});

    const recipients = [...new Set(
      subscribers
        .map((s) => (typeof s === "string" ? s : String(s?.email || "")).trim().toLowerCase())
        .filter(Boolean)
    )];

    console.log("[dispatchAlert] Unique recipients:", recipients.length, recipients);
    let sent = 0;
    let failed = 0;
    const errors = [];
    const validRecipients = [];
    const invalidRecipients = [];

    if (recipients.length > 0) {
      // Validate each recipient address before attempting to send — a malformed
      // entry in the DB (e.g. accidental whitespace or partial save) should be
      // skipped and logged rather than crashing the whole batch.
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      for (const email of recipients) {
        if (EMAIL_RE.test(email)) {
          validRecipients.push(email);
        } else {
          invalidRecipients.push(email);
        }
      }

      if (invalidRecipients.length > 0) {
        console.warn("[dispatchAlert] Skipping malformed recipient addresses:", invalidRecipients);
      }
    } else {
      console.log("[dispatchAlert] No email subscribers found in database.");
    }

    const DASHBOARD_URL = "https://disaster-alert-50aae.web.app";

    if (validRecipients.length > 0) {
      const emailSubject = `🚨 ${alert.type} Alert — ${alert.level} Severity`;

      // Severity-based color palette (inline for email client compatibility)
      const severityKey = (alert.severity || alert.level || "").toLowerCase();
      const palette = severityKey.includes("critical")
        ? { accent: "#b91c1c", accentLight: "#fef2f2", accentBorder: "#fca5a5", badge: "#dc2626", badgeText: "#ffffff", icon: "🔴" }
        : severityKey.includes("high")
        ? { accent: "#c2410c", accentLight: "#fff7ed", accentBorder: "#fdba74", badge: "#ea580c", badgeText: "#ffffff", icon: "🟠" }
        : severityKey.includes("moderate") || severityKey.includes("medium")
        ? { accent: "#b45309", accentLight: "#fffbeb", accentBorder: "#fcd34d", badge: "#d97706", badgeText: "#ffffff", icon: "🟡" }
        : { accent: "#1d4ed8", accentLight: "#eff6ff", accentBorder: "#93c5fd", badge: "#2563eb", badgeText: "#ffffff", icon: "🔵" };

      const emailBody = [
        "DISASTER ALERT SYSTEM",
        "=".repeat(40),
        "",
        `⚠️  ${alert.type.toUpperCase()} ALERT`,
        "",
        `Severity   : ${alert.level}`,
        `Location   : ${alert.location}`,
        `Description: ${alert.description}`,
        "",
        "─".repeat(40),
        `View on Dashboard: ${DASHBOARD_URL}`,
        "─".repeat(40),
        "",
        "",
        "Stay safe. Take immediate precautions.",
        "",
        "You are receiving this because you subscribed to Disaster Alert System notifications.",
      ].join("\n");

      const emailHtml = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif;">

  <!-- Outer wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">

      <!-- Email card -->
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">

        <!-- ── BRAND HEADER ── -->
        <tr>
          <td style="background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);padding:20px 32px;text-align:center;">
            <p style="margin:0;font-size:13px;letter-spacing:2px;color:#94a3b8;text-transform:uppercase;font-weight:600;">Disaster Alert System</p>
            <p style="margin:4px 0 0;font-size:11px;color:#475569;">Real-Time Emergency Monitoring</p>
          </td>
        </tr>

        <!-- ── ALERT BANNER ── -->
        <tr>
          <td style="background:${palette.accent};padding:28px 32px 24px;text-align:center;">
            <p style="margin:0 0 8px;font-size:48px;line-height:1;">${palette.icon}</p>
            <h1 style="margin:0 0 6px;font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">
              ${alert.type} Alert
            </h1>
            <span style="display:inline-block;background:rgba(255,255,255,0.2);color:#ffffff;font-size:13px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:4px 14px;border-radius:20px;border:1px solid rgba(255,255,255,0.35);">
              ${alert.level} Severity
            </span>
          </td>
        </tr>

        <!-- ── ALERT DETAILS ── -->
        <tr>
          <td style="padding:28px 32px 8px;">

            <!-- Severity row -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;background:${palette.accentLight};border-left:4px solid ${palette.accent};border-radius:0 8px 8px 0;">
              <tr>
                <td style="padding:14px 18px;">
                  <p style="margin:0 0 2px;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${palette.accent};">Severity Level</p>
                  <p style="margin:0;font-size:17px;font-weight:700;color:#1e293b;">${alert.level}</p>
                </td>
              </tr>
            </table>

            <!-- Location row -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;background:#f8fafc;border-left:4px solid #64748b;border-radius:0 8px 8px 0;">
              <tr>
                <td style="padding:14px 18px;">
                  <p style="margin:0 0 2px;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#475569;">📍 Location</p>
                  <p style="margin:0;font-size:17px;font-weight:600;color:#1e293b;">${alert.location}</p>
                </td>
              </tr>
            </table>

            <!-- Description row -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;background:#f8fafc;border-left:4px solid #64748b;border-radius:0 8px 8px 0;">
              <tr>
                <td style="padding:14px 18px;">
                  <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#475569;">📋 Description</p>
                  <p style="margin:0;font-size:15px;color:#334155;line-height:1.7;">${alert.description || "No additional details provided."}</p>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- ── CTA BUTTON ── -->
        <tr>
          <td style="padding:0 32px 32px;text-align:center;">
            <a href="${DASHBOARD_URL}"
               target="_blank"
               style="display:inline-block;background:${palette.accent};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:8px;letter-spacing:0.5px;box-shadow:0 4px 12px rgba(0,0,0,0.2);">
              🗺️ View Alert on Dashboard
            </a>
            <p style="margin:12px 0 0;font-size:12px;color:#94a3b8;">
              Or copy: <span style="color:#475569;">${DASHBOARD_URL}</span>
            </p>
          </td>
        </tr>

        <!-- ── SAFETY NOTICE ── -->
        <tr>
          <td style="background:${palette.accentLight};border-top:1px solid ${palette.accentBorder};padding:18px 32px;text-align:center;">
            <p style="margin:0;font-size:14px;font-weight:700;color:${palette.accent};">⚠️ Take immediate precautions. Follow official guidance.</p>
          </td>
        </tr>

        <!-- ── FOOTER ── -->
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center;">
            <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#374151;">Disaster Alert System</p>
            <p style="margin:0 0 10px;font-size:12px;color:#9ca3af;line-height:1.6;">
              You received this alert because you subscribed to emergency notifications.<br>
              Stay safe — your safety is our priority.
            </p>
            <p style="margin:0;font-size:11px;color:#cbd5e1;">
              &copy; ${new Date().getFullYear()} Disaster Alert System &nbsp;|&nbsp; Powered by Team Alpha
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>

</body>
</html>`;

      console.log("=== SENDING VIA BREVO === htmlContent length:", emailHtml.length, "first 200 chars:", emailHtml.substring(0, 200));
      console.log("[dispatchAlert] BREVO_SENDER_EMAIL:", BREVO_SENDER_EMAIL);

      const settled = await Promise.allSettled(
        validRecipients.map((recipientEmail) =>
          brevoEmailApi.sendTransacEmail({
            sender: { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME },
            to: [{ email: recipientEmail }],
            subject: emailSubject,
            htmlContent: emailHtml,
            textContent: emailBody
          })
        )
      );

      settled.forEach((result, idx) => {
        console.log(`=== BREVO RESPONSE [recipient: ${validRecipients[idx]}] ===`, JSON.stringify(result));
        if (result.status === "fulfilled") {
          sent++;
        } else {
          failed++;
          const errMsg = result.reason?.message || String(result.reason);
          console.error(`[dispatchAlert] Failed to send to ${validRecipients[idx]}:`, errMsg);
          errors.push({ email: validRecipients[idx], error: errMsg });
        }
      });

      console.log(`[dispatchAlert] Brevo email results: sent=${sent}, failed=${failed}, skipped=${invalidRecipients.length}`);
    }

    // -------------------------------------------------------------------------
    // Geofenced FCM Push Notifications (50km Radius with Emergency Fallback)
    // -------------------------------------------------------------------------
    const PUSH_RADIUS_KM = Number(process.env.PUSH_RADIUS_KM || 50);
    let pushSent = 0;
    let pushFailed = 0;
    const pushErrors = [];
    let pushEligibleCount = 0;

    try {
      console.log(`=== INITIATING FCM PUSH NOTIFICATIONS (Radius: ${PUSH_RADIUS_KM}km, Alert Lat=${alert.lat}, Lng=${alert.lng}) ===`);
      const pushSnapshot = await db.ref("pushSubscribers").once("value");
      const pushData = pushSnapshot.val() || {};
      const pushSubscribers = Object.entries(pushData).map(([key, value]) => ({
        dbKey: key,
        ...value
      }));

      console.log(`[dispatchAlert:Push] Found ${pushSubscribers.length} total push subscribers registered in RTDB.`);

      let targetSubscribers = [];
      if (alert.lat !== null && alert.lng !== null && !alert.broadcastAll) {
        targetSubscribers = pushSubscribers.filter((sub) => {
          if (!sub.token) return false;
          if (typeof sub.lat !== "number" || typeof sub.lng !== "number") return true; // Include if coords missing
          const dist = haversineKm(alert.lat, alert.lng, sub.lat, sub.lng);
          return dist <= PUSH_RADIUS_KM;
        });

        // If no subscribers within 50km, fall back to all subscribers so critical test broadcasts are never lost
        if (targetSubscribers.length === 0 && pushSubscribers.length > 0) {
          console.log("[dispatchAlert:Push] No subscribers strictly within radius; broadcasting to all registered devices.");
          targetSubscribers = pushSubscribers;
        }
      } else {
        targetSubscribers = pushSubscribers;
      }

      pushEligibleCount = targetSubscribers.length;
      console.log(`[dispatchAlert:Push] ${pushEligibleCount} subscribers selected for dispatch.`);

      if (pushEligibleCount > 0) {
        const messaging = getAdminMessaging();

        for (const sub of targetSubscribers) {
          const pushTitle = `🚨 ${alert.type} Alert Nearby`;
          const pushBody = alert.description || `${alert.type} emergency reported in your area. Take immediate precautions.`;

          // Data-only payload ensures Android Chrome hands full control to our Service Worker
          // without intercepting with the browser's default no-vibration notification handler.
          const payload = {
            webpush: {
              headers: {
                Urgency: "high",
                TTL: "86400"
              },
              fcmOptions: {
                link: DASHBOARD_URL
              }
            },
            android: {
              priority: "high"
            },
            data: {
              title: String(pushTitle),
              body: String(pushBody),
              type: String(alert.type || ""),
              severity: String(alert.severity || alert.level || "critical"),
              location: String(alert.location || ""),
              lat: String(alert.lat ?? ""),
              lng: String(alert.lng ?? ""),
              url: String(DASHBOARD_URL),
              alertId: String(alert.createdAt || Date.now())
            },
            token: sub.token
          };

          try {
            const fcmResponse = await messaging.send(payload);
            console.log(`[dispatchAlert:Push] Successfully sent FCM push to subscriber (key=${sub.dbKey}):`, fcmResponse);
            pushSent++;
          } catch (fcmErr) {
            pushFailed++;
            const errMsg = fcmErr.message || String(fcmErr);
            console.error(`[dispatchAlert:Push] FCM send failed for subscriber (key=${sub.dbKey}):`, errMsg);
            pushErrors.push({ tokenKey: sub.dbKey, error: errMsg });

            // Automatically clean up invalid/expired tokens
            if (
              fcmErr.code === "messaging/registration-token-not-registered" ||
              fcmErr.code === "messaging/invalid-registration-token" ||
              /not-registered|invalid-registration-token|invalid argument/i.test(errMsg)
            ) {
              console.log(`[dispatchAlert:Push] Removing invalid/unregistered token from database: ${sub.dbKey}`);
              await db.ref(`pushSubscribers/${sub.dbKey}`).remove().catch((cleanupErr) => {
                console.warn(`[dispatchAlert:Push] Failed to remove bad token ${sub.dbKey}:`, cleanupErr.message);
              });
            }
          }
        }
      }
    } catch (pushErr) {
      console.error("[dispatchAlert:Push] Unexpected error during push dispatch:", pushErr);
    }

    console.log(`[dispatchAlert] Summary: emailSent=${sent}, emailFailed=${failed}, pushSent=${pushSent}, pushFailed=${pushFailed}`);

    res.status(200).json({
      success: true,
      dispatchedBy: decodedToken.email || decodedToken.uid || "unknown",
      alert,
      sent,
      failed,
      skipped: invalidRecipients.length,
      errors: errors.length > 0 ? errors : undefined,
      pushSent,
      pushFailed,
      pushEligible: pushEligibleCount,
      pushErrors: pushErrors.length > 0 ? pushErrors : undefined
    });
  } catch (error) {
    const status = /Authorization|token/i.test(error.message) ? 401 : 500;
    console.error("[dispatchAlert] Error:", error);
    res.status(status).json({
      success: false,
      error: status === 401 ? error.message : "Failed to dispatch alert"
    });
  }
});

// Helper for aiAdvisor
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";

function buildPrompt({ type, severity, description, lat, lng }) {
  const location = (lat != null && lng != null)
    ? `near coordinates ${lat}, ${lng}`
    : "at an unspecified location";

  return `You are an expert emergency response AI advisor for a real-time disaster monitoring system.

A disaster alert has been triggered with the following details:
- Disaster Type: ${type || "Unknown Disaster"}
- Severity Level: ${severity || "moderate"}
- Description: ${description || "No additional details"}
- Location: ${location}

Based on this information, provide a structured safety advisory. Use this exact format with these section headers and emoji prefixes. Keep each section concise (2-3 bullet points max):

🚨 SITUATION OVERVIEW
Brief 1-2 sentence summary of the threat.

🛡️ IMMEDIATE ACTIONS
- Numbered steps people should take RIGHT NOW

📦 EMERGENCY KIT ESSENTIALS
- Items people should grab or have ready

📍 EVACUATION GUIDANCE
- Whether to evacuate or shelter in place
- Safe zones and routes to consider

📞 EMERGENCY CONTACTS
- List relevant emergency service numbers (India: 112, NDRF: 011-24363260, etc.)

⚠️ THINGS TO AVOID
- Common mistakes people make during this disaster

💡 RECOVERY TIPS
- What to do after the immediate danger passes

Keep the response practical, actionable, and under 400 words. Do not use markdown headers. Use plain text with the emoji prefixes shown above as section dividers. Write for a general public audience.`;
}

// POST /aiAdvisor
app.post("/aiAdvisor", async (req, res) => {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    res.status(503).json({
      success: false,
      error: "AI Advisor is not configured"
    });
    return;
  }

  const { type, severity, description, lat, lng } = req.body || {};

  if (!type || typeof type !== "string") {
    res.status(400).json({
      success: false,
      error: "Missing disaster type"
    });
    return;
  }

  try {
    const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: buildPrompt({ type, severity, description, lat, lng })
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          topP: 0.9,
          topK: 40,
          maxOutputTokens: 800
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
      })
    });

    if (!geminiResponse.ok) {
      console.error("[aiAdvisor] Gemini API error:", geminiResponse.status, await geminiResponse.text());
      res.status(502).json({
        success: false,
        error: "AI service returned an error"
      });
      return;
    }

    const payload = await geminiResponse.json();
    const advice = payload?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!advice) {
      res.status(502).json({
        success: false,
        error: "AI service returned an empty response"
      });
      return;
    }

    res.status(200).json({
      success: true,
      advice,
      model: "gemini-2.5-flash-lite"
    });
  } catch (error) {
    console.error("[aiAdvisor] Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate safety advice"
    });
  }
});

// Helpers for nearbyResources (Overpass OpenStreetMap API)
const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.nchc.org.tw/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter"
];

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes static infrastructure cache
const DEFAULT_RADIUS_METERS = 5000;
const MIN_RADIUS_METERS = 500;
const MAX_RADIUS_METERS = 10000;
const MAX_RESULTS = 5;

const nearbyResourcesCache = new Map();

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampRadius(value) {
  const parsed = toNumber(value) ?? DEFAULT_RADIUS_METERS;
  return Math.max(MIN_RADIUS_METERS, Math.min(MAX_RADIUS_METERS, Math.round(parsed)));
}

function cacheKey(lat, lng, radius) {
  // Bucketing to ~110m precision for instant cache hits across nearby alerts
  return `${lat.toFixed(3)}:${lng.toFixed(3)}:${radius}`;
}

function getOverpassKind(tags = {}) {
  const amenity = (tags.amenity || "").toLowerCase();
  const building = (tags.building || "").toLowerCase();
  const healthcare = (tags.healthcare || "").toLowerCase();

  if (amenity === "hospital" || healthcare === "hospital" || amenity === "clinic" || amenity === "doctors") {
    return "hospital";
  }
  if (amenity === "police") {
    return "police";
  }
  if (amenity === "shelter" || building === "shelter" || amenity === "social_facility" || tags.social_facility) {
    return "shelter";
  }
  return "shelter";
}

function toOverpassPlace(elem, targetLat, targetLng) {
  const tags = elem.tags || {};
  const placeLat = elem.lat ?? elem.center?.lat;
  const placeLng = elem.lon ?? elem.center?.lon;

  if (placeLat == null || placeLng == null || !Number.isFinite(placeLat) || !Number.isFinite(placeLng)) {
    return null;
  }

  const kind = getOverpassKind(tags);
  const distanceKm = haversineKm(targetLat, targetLng, placeLat, placeLng);
  const distanceMeters = Math.round(distanceKm * 1000);

  const rawName = tags.name || tags["name:en"] || tags.operator || "";
  const fallbackKindName = kind.charAt(0).toUpperCase() + kind.slice(1);
  const name = rawName.trim() || `${fallbackKindName} Facility`;

  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const area = tags["addr:suburb"] || tags["addr:district"] || tags["addr:neighbourhood"] || "";
  const city = tags["addr:city"] || tags["addr:town"] || "";

  const vicinity = tags["addr:full"] || [street, area, city].filter(Boolean).join(", ") || street || area || city || "Address unavailable";

  return {
    id: `${elem.type || "node"}-${elem.id}`,
    name,
    type: kind,
    vicinity,
    lat: placeLat,
    lng: placeLng,
    distanceMeters,
    distanceKm: Number(distanceKm.toFixed(2))
  };
}

async function fetchOverpassResources(lat, lng, radius, timeoutMs = 6000) {
  // Precompute geographic bounding box for instant index lookup
  const latDelta = (radius / 1000) / 111.0;
  const lngDelta = (radius / 1000) / (111.0 * Math.cos((lat * Math.PI) / 180));
  const minLat = (lat - latDelta).toFixed(4);
  const minLng = (lng - lngDelta).toFixed(4);
  const maxLat = (lat + latDelta).toFixed(4);
  const maxLng = (lng + lngDelta).toFixed(4);

  // High-performance BBox-indexed Overpass query
  const query = `
    [out:json][timeout:5];
    (
      node["amenity"="hospital"](${minLat},${minLng},${maxLat},${maxLng});
      node["amenity"="police"](${minLat},${minLng},${maxLat},${maxLng});
      node["amenity"="shelter"](${minLat},${minLng},${maxLat},${maxLng});
      node["healthcare"="hospital"](${minLat},${minLng},${maxLat},${maxLng});
      way["amenity"="hospital"](${minLat},${minLng},${maxLat},${maxLng});
      way["amenity"="police"](${minLat},${minLng},${maxLat},${maxLng});
      way["amenity"="shelter"](${minLat},${minLng},${maxLat},${maxLng});
      way["building"="shelter"](${minLat},${minLng},${maxLat},${maxLng});
    );
    out center 20;
  `;

  // Race all public mirrors concurrently - first responding mirror wins
  const fetchFromMirror = async (endpoint) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "DisasterAlertSystem/1.0 (contact: disaster-alert@alpha.local)"
        },
        body: "data=" + encodeURIComponent(query)
      });

      if (!response.ok) {
        throw new Error(`Mirror ${endpoint} HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!Array.isArray(data?.elements)) {
        throw new Error(`Invalid response structure from ${endpoint}`);
      }
      return data.elements;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await Promise.any(OVERPASS_ENDPOINTS.map((ep) => fetchFromMirror(ep)));
  } catch (aggErr) {
    console.warn("[overpass] All mirrors failed or timed out:", aggErr?.message || aggErr);
    return [];
  }
}

function mergeAndRank(...groups) {
  const deduped = new Map();

  groups.flat().forEach((entry) => {
    if (!entry?.id) {
      return;
    }

    const existing = deduped.get(entry.id);
    if (!existing || entry.distanceMeters < existing.distanceMeters) {
      deduped.set(entry.id, entry);
    }
  });

  return [...deduped.values()]
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, MAX_RESULTS)
    .map(({ id, distanceMeters, ...safe }) => safe);
}

// POST /nearbyResources
app.post("/nearbyResources", async (req, res) => {
  const lat = toNumber(req.body?.lat);
  const lng = toNumber(req.body?.lng);
  const radius = clampRadius(req.body?.radius);

  if (lat == null || lng == null) {
    res.status(400).json({
      success: false,
      places: [],
      error: "Valid latitude and longitude are required"
    });
    return;
  }

  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    res.status(400).json({
      success: false,
      places: [],
      error: "Latitude/longitude out of range"
    });
    return;
  }

  const key = cacheKey(lat, lng, radius);
  const cached = nearbyResourcesCache.get(key);

  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    res.status(200).json({
      success: true,
      places: cached.places,
      cached: true
    });
    return;
  }

  try {
    const rawElements = await fetchOverpassResources(lat, lng, radius, 9000);
    const parsedPlaces = rawElements
      .map((elem) => toOverpassPlace(elem, lat, lng))
      .filter(Boolean);

    const places = mergeAndRank(parsedPlaces);

    nearbyResourcesCache.set(key, {
      createdAt: Date.now(),
      places
    });

    res.status(200).json({
      success: true,
      places,
      cached: false
    });
  } catch (error) {
    console.warn("[nearbyResources] Overpass fetch failed/timed out, returning empty fallback:", error.message);
    res.status(200).json({
      success: true,
      places: [],
      cached: false
    });
  }
});

// Helpers for detector
const USGS_FEED_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson";
const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000;

function normalizeSeverity(magnitude) {
  if (magnitude >= 6.5) {
    return { severity: "critical", level: "Critical" };
  }
  if (magnitude >= 5.5) {
    return { severity: "high", level: "High" };
  }
  return { severity: "moderate", level: "Moderate" };
}

function toPendingAlert(feature) {
  const magnitude = Number(feature?.properties?.mag || 0);
  const id = String(feature?.id || "").trim();
  const coordinates = feature?.geometry?.coordinates || [];
  const lng = Number(coordinates[0]);
  const lat = Number(coordinates[1]);

  if (!id || !Number.isFinite(magnitude) || magnitude <= 4.5) {
    return null;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const createdAt = Number(feature?.properties?.time) || Date.now();
  const { severity, level } = normalizeSeverity(magnitude);
  const place = String(feature?.properties?.place || "Unknown location").trim();
  const updatedAt = Number(feature?.properties?.updated) || createdAt;

  return {
    id,
    type: "Earthquake",
    severity,
    level,
    description: `Magnitude ${magnitude.toFixed(1)} earthquake near ${place}`,
    desc: `Magnitude ${magnitude.toFixed(1)} earthquake near ${place}`,
    lat,
    lng,
    source: "USGS Earthquake Feed",
    confidence: Math.min(99, Math.max(70, Math.round(magnitude * 15))),
    auto: true,
    status: "Pending",
    createdAt,
    detectedAt: new Date(createdAt).toISOString(),
    updatedAt,
    expiresAt: createdAt + DEFAULT_EXPIRY_MS,
    externalId: id,
    metadata: {
      magnitude,
      place,
      usgsUrl: feature?.properties?.url || null
    }
  };
}

// POST /detector
app.post("/detector", async (req, res) => {
  const authHeader = (req.headers["authorization"] || "").trim();
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const usgsResponse = await fetch(USGS_FEED_URL, {
      headers: {
        "Content-Type": "application/json"
      }
    });

    if (!usgsResponse.ok) {
      throw new Error(`USGS feed request failed with status ${usgsResponse.status}`);
    }

    const payload = await usgsResponse.json();
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const db = getAdminDb();
    const pendingRef = db.ref("pending");
    const pendingSnapshot = await pendingRef.once("value");
    const existingPending = pendingSnapshot.val() || {};
    const updates = {};
    let created = 0;

    for (const feature of features) {
      const alert = toPendingAlert(feature);
      if (!alert) {
        continue;
      }
      if (existingPending[alert.id]) {
        continue;
      }
      updates[`pending/${alert.id}`] = alert;
      created += 1;
    }

    if (created > 0) {
      await db.ref().update(updates);
    }

    res.status(200).json({
      success: true,
      message: `Added ${created} earthquake alerts to pending`,
      created
    });
  } catch (error) {
    console.error("[detector] Error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to check earthquake feed"
    });
  }
});

// ---------------------------------------------------------------------------
// GET /health/email
// On-demand Brevo API key connectivity check — call this after deploying to Render
// to confirm BREVO_API_KEY is correctly set in the dashboard.
// Protected by CRON_SECRET so it isn't publicly accessible.
// ---------------------------------------------------------------------------
app.get("/health/email", async (req, res) => {
  const authHeader = (req.headers["authorization"] || "").trim();
  const cronSecret = (process.env.CRON_SECRET || "").trim();

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  const apiKey = (process.env.BREVO_API_KEY || "").trim();
  const senderEmail = (process.env.BREVO_SENDER_EMAIL || "").trim();

  console.log("[health/email] BREVO_API_KEY present:", !!apiKey, "length:", apiKey.length, "prefix:", apiKey ? apiKey.substring(0, 8) + "..." : "N/A");
  console.log("[health/email] BREVO_SENDER_EMAIL present:", !!senderEmail, "email:", senderEmail);

  if (!apiKey) {
    res.status(500).json({
      success: false,
      error: "BREVO_API_KEY is missing from environment variables"
    });
    return;
  }

  if (!senderEmail) {
    res.status(500).json({
      success: false,
      error: "BREVO_SENDER_EMAIL is missing from environment variables"
    });
    return;
  }

  try {
    // Verify the API key by calling Brevo's account info endpoint
    const accountApi = new SibApiV3Sdk.AccountApi();
    accountApi.setApiKey(SibApiV3Sdk.AccountApiApiKeys.apiKey, apiKey);
    const accountInfo = await accountApi.getAccount();

    console.log("[health/email] Brevo API key verified OK for:", accountInfo?.body?.email);
    res.status(200).json({
      success: true,
      message: "✅ Brevo API key verified successfully",
      account: accountInfo?.body?.email || "(unknown)",
      senderEmail,
      keyPrefix: apiKey.substring(0, 8) + "..."
    });
  } catch (error) {
    const brevoErrorBody = error.response?.body || error.body || null;
    const statusCode = error.response?.statusCode || error.statusCode || null;
    const detailMsg = brevoErrorBody?.message || brevoErrorBody?.code || error.message || String(error);

    console.error("[health/email] Brevo verification failed!");
    console.error("[health/email] Status Code:", statusCode);
    console.error("[health/email] Error Message:", error.message);
    console.error("[health/email] Response Body:", JSON.stringify(brevoErrorBody));

    res.status(502).json({
      success: false,
      error: `Brevo API verification failed: ${detailMsg}`,
      details: brevoErrorBody || undefined,
      statusCode
    });
  }
});

// POST /cleanup
app.post("/cleanup", async (req, res) => {
  const authHeader = (req.headers["authorization"] || "").trim();
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const db = getAdminDb();
    const snapshot = await db.ref("alerts").once("value");
    const alerts = snapshot.val() || {};
    const now = Date.now();
    const updates = {};
    let deleted = 0;

    Object.entries(alerts).forEach(([id, alert]) => {
      const expiresAt = Number(alert?.expiresAt);
      if (Number.isFinite(expiresAt) && expiresAt <= now) {
        updates[`alerts/${id}`] = null;
        deleted += 1;
      }
    });

    if (deleted > 0) {
      await db.ref().update(updates);
    }

    console.log(`[cleanup] Deleted ${deleted} expired alerts`);
    res.status(200).json({
      success: true,
      message: `Deleted ${deleted} expired alerts`,
      deleted
    });
  } catch (error) {
    console.error("[cleanup] Error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to cleanup expired alerts"
    });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
