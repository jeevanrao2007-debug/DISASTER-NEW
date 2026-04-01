/* =========================================================
   api/alert.js — POST /api/alert
   Vercel Serverless Function

   Triggered when an alert is published or approved.

   Actions:
   1. Reads all FCM tokens from Firebase RTDB
   2. Filters tokens by distance (Haversine, 25km radius)
      — if user has no location stored, they always get notified
   3. Sends FCM multicast push to filtered devices
   4. Reads all subscriber emails from Firebase RTDB
   5. For HIGH or CRITICAL severity only, sends email alerts
      — also filtered by 25km if user location is stored
   6. Cleans up invalid FCM tokens automatically

   Body payload:
   {
     type:        string   e.g. "Flood"
     severity:    string   "low" | "moderate" | "high" | "critical"
     description: string?
     lat:         number?
     lng:         number?
   }
   ========================================================= */

import nodemailer from "nodemailer";
import { getAdminDb, getAdminMessaging } from "./_firebaseAdmin.js";

/* ── CORS ──────────────────────────────────────────────── */
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/* ── HAVERSINE FORMULA ─────────────────────────────────── */
/**
 * Calculates the distance in km between two lat/lng points.
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth radius in km
  const toRad = deg => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const GEOFENCE_RADIUS_KM = 25;

/**
 * Returns true if the user should receive this alert.
 * - If no alert location provided → always notify (broadcast mode)
 * - If user has no stored location → always notify (opt-in to all)
 * - If user is within 25km → notify
 * - Otherwise → skip
 */
function isWithinRadius(alertLat, alertLng, userLocation) {
  if (alertLat == null || alertLng == null) return true;
  if (!userLocation?.lat || !userLocation?.lng) return true;

  const dist = haversineKm(
    parseFloat(alertLat),
    parseFloat(alertLng),
    parseFloat(userLocation.lat),
    parseFloat(userLocation.lng)
  );

  return dist <= GEOFENCE_RADIUS_KM;
}

/* ── FCM MULTICAST (geofenced) ─────────────────────────── */
async function sendFCMMulticast({ title, body, severity, type, lat, lng }) {
  const db = getAdminDb();
  const snap = await db.ref("fcm_tokens").once("value");
  const tokensMap = snap.val() || {};

  const entries = Object.entries(tokensMap);

  // Filter by geofence — keep token if within radius or no location stored
  const filtered = entries.filter(([, v]) =>
    isWithinRadius(lat, lng, v.location)
  );

  const tokens = filtered.map(([, v]) => v.token).filter(Boolean);

  console.info(
    `[FCM] Total tokens: ${entries.length} | In radius: ${filtered.length} | Skipped: ${entries.length - filtered.length}`
  );

  if (tokens.length === 0) {
    return { sent: 0, failed: 0, skipped: "no_tokens_in_radius" };
  }

  const messaging = getAdminMessaging();
  const response = await messaging.sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: {
      severity: severity || "low",
      type: type || "alert",
      ts: String(Date.now())
    },
    webpush: {
      headers: { Urgency: severity === "critical" ? "high" : "normal" },
      notification: {
        icon: "/icon-192.png",
        badge: "/icon-72.png",
        vibrate: severity === "critical" ? [200, 100, 200, 100, 400] : [200]
      }
    }
  });

  // Clean up stale/invalid tokens automatically
  const invalidKeys = [];
  response.responses.forEach((resp, idx) => {
    if (!resp.success) {
      const code = resp.error?.code;
      if (
        code === "messaging/invalid-registration-token" ||
        code === "messaging/registration-token-not-registered"
      ) {
        invalidKeys.push(filtered[idx][0]); // key in RTDB
      }
    }
  });

  if (invalidKeys.length > 0) {
    const updates = {};
    invalidKeys.forEach(k => { updates[`fcm_tokens/${k}`] = null; });
    db.ref().update(updates).catch(console.error);
  }

  return {
    sent: response.successCount,
    failed: response.failureCount,
    cleaned: invalidKeys.length,
    total: entries.length,
    inRadius: filtered.length
  };
}

/* ── EMAIL SERVICE (geofenced) ─────────────────────────── */
const HIGH_OR_CRITICAL = new Set(["high", "critical"]);

function buildEmailHtml({ type, severity, description, lat, lng }) {
  const sevColor = severity === "critical" ? "#ef4444" : "#fb923c";
  const locationRow =
    lat && lng
      ? `<tr>
          <td style="padding:8px 12px;color:#94a3b8;font-size:13px;">Location</td>
          <td style="padding:8px 12px;color:#f1f5f9;">
            Lat: ${parseFloat(lat).toFixed(4)}, Lng: ${parseFloat(lng).toFixed(4)}
          </td>
        </tr>`
      : "";

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:20px;background:#0f172a;">
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#1e293b;color:#e2e8f0;border-radius:14px;overflow:hidden;border:1px solid rgba(239,68,68,0.3);">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#991b1b,#7f1d1d);padding:28px 24px;text-align:center;">
    <div style="font-size:36px;margin-bottom:8px;">🚨</div>
    <h1 style="margin:0;font-size:22px;font-weight:700;color:#fff;letter-spacing:1px;">DISASTER ALERT</h1>
    <div style="margin-top:8px;font-size:13px;color:#fca5a5;">${new Date().toLocaleString()}</div>
  </div>

  <!-- Alert Details -->
  <div style="padding:24px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:8px 12px;color:#94a3b8;font-size:13px;width:110px;">Type</td>
        <td style="padding:8px 12px;font-weight:700;color:#f1f5f9;font-size:15px;">${type}</td>
      </tr>
      <tr style="background:rgba(255,255,255,0.03);">
        <td style="padding:8px 12px;color:#94a3b8;font-size:13px;">Severity</td>
        <td style="padding:8px 12px;font-weight:700;color:${sevColor};font-size:15px;letter-spacing:1px;">${(severity || "").toUpperCase()}</td>
      </tr>
      ${description ? `<tr>
        <td style="padding:8px 12px;color:#94a3b8;font-size:13px;">Details</td>
        <td style="padding:8px 12px;color:#cbd5e1;">${description}</td>
      </tr>` : ""}
      ${locationRow}
    </table>

    <!-- Warning box -->
    <div style="margin-top:20px;padding:14px 16px;background:rgba(239,68,68,0.08);border-radius:8px;border-left:3px solid #ef4444;">
      <p style="margin:0;font-size:13px;color:#fca5a5;line-height:1.6;">
        ⚠&nbsp; <strong>Stay safe.</strong> Follow all official emergency broadcasts.
        Do not enter affected areas. Move to higher ground if advised.
      </p>
    </div>

    <!-- Footer -->
    <p style="margin-top:20px;font-size:11px;color:#475569;text-align:center;">
      You received this alert because you subscribed to Disaster Alert notifications.<br>
      <small style="color:#334155">Alerts are filtered to your area (${GEOFENCE_RADIUS_KM}km radius).</small>
    </p>
  </div>
</div>
</body>
</html>`;
}

async function sendEmailAlerts({ type, severity, description, lat, lng }) {
  if (!HIGH_OR_CRITICAL.has(severity?.toLowerCase())) {
    return { skipped: true, reason: "severity_below_high" };
  }

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailPass) {
    console.warn("[alert] Email env vars missing — skipping email");
    return { skipped: true, reason: "env_missing" };
  }

  // Fetch subscriber list (stored under fcm_tokens to access location)
  const db = getAdminDb();
  const snap = await db.ref("fcm_tokens").once("value");
  const tokensMap = snap.val() || {};

  // Also fetch plain email subscribers (no location)
  const emailSnap = await db.ref("subscribers").once("value");
  const emailSubs = emailSnap.val() || {};

  // Build a unified list of {email, location}
  const recipients = [];

  // From fcm_tokens (have location + optional email)
  Object.values(tokensMap).forEach(v => {
    if (v.email && v.email.includes("@")) {
      if (isWithinRadius(lat, lng, v.location)) {
        recipients.push(v.email.toLowerCase());
      }
    }
  });

  // From subscribers (no location — always notify)
  Object.values(emailSubs).forEach(v => {
    if (v.email && v.email.includes("@")) {
      recipients.push(v.email.toLowerCase());
    }
  });

  // Deduplicate emails
  const emails = [...new Set(recipients)];

  if (emails.length === 0) return { sent: 0, reason: "no_subscribers_in_radius" };

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPass }
  });

  const subject = `🚨 ${(severity || "").toUpperCase()} ALERT: ${type} Detected`;
  const html = buildEmailHtml({ type, severity, description, lat, lng });

  const results = await Promise.allSettled(
    emails.map(to =>
      transporter.sendMail({
        from: `"Disaster Alert System" <${gmailUser}>`,
        to,
        subject,
        html
      })
    )
  );

  const sent = results.filter(r => r.status === "fulfilled").length;
  const failed = results.filter(r => r.status === "rejected").length;
  return { sent, failed, total: emails.length };
}

/* ── HANDLER ──────────────────────────────────────────── */
export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const {
    type = "Unknown",
    severity = "low",
    description = "",
    lat,
    lng
  } = req.body ?? {};

  try {
    const normSev = severity.toLowerCase();

    const [fcmResult, emailResult] = await Promise.allSettled([
      sendFCMMulticast({
        title: `${type} — ${normSev.toUpperCase()}`,
        body: description || "Emergency nearby. Stay safe.",
        severity: normSev,
        type,
        lat,
        lng
      }),
      sendEmailAlerts({ type, severity: normSev, description, lat, lng })
    ]);

    return res.status(200).json({
      success: true,
      fcm: fcmResult.status === "fulfilled"
        ? fcmResult.value
        : { error: fcmResult.reason?.message },
      email: emailResult.status === "fulfilled"
        ? emailResult.value
        : { error: emailResult.reason?.message }
    });
  } catch (err) {
    console.error("[/api/alert] Error:", err);
    return res
      .status(500)
      .json({ error: "Failed to send notifications", detail: err.message });
  }
}