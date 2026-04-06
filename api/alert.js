/* =========================================================
   api/alert.js - POST /api/alert
   Vercel Serverless Function

   Triggered when an alert is published or approved.

   Actions:
   1. Reads all FCM tokens from Firebase RTDB
   2. Sends FCM multicast push to ALL valid tokens (broadcast mode)
   3. Reads all subscriber emails from Firebase RTDB
   4. Sends email alerts for ALL severity levels to ALL subscribers
   5. Cleans up invalid FCM tokens automatically

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

/* ---- EMAIL VALIDATION --------------------------------- */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  if (!email || typeof email !== "string") return false;
  return EMAIL_REGEX.test(email.trim());
}

/* ---- CORS ------------------------------------------------ */
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-key");
}

/* ---- Sanitization ---------------------------------------- */
function sanitizeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* ---- Helpers --------------------------------------------- */
const NOTIFICATION_ICON_URL = "https://cdn-icons-png.flaticon.com/512/564/564619.png";
const NOTIFICATION_BADGE_URL = "https://cdn-icons-png.flaticon.com/512/564/564619.png";

function toFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/* ---- FCM multicast --------------------------------------- */
async function sendFCMMulticast({ title, body, severity, type }) {
  const db = getAdminDb();
  const snap = await db.ref("fcm_tokens").once("value");
  const tokensMap = snap.val() || {};

  const entries = Object.entries(tokensMap);

  // Broadcast mode: include all tokens that have a valid token string.
  const validEntries = entries.filter(([, v]) => Boolean(v?.token));
  const tokens = validEntries.map(([, v]) => v.token);

  console.info(`[FCM] Broadcasting to all subscribers. Total: ${entries.length} | Valid tokens: ${tokens.length}`);

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
        icon: NOTIFICATION_ICON_URL,
        badge: NOTIFICATION_BADGE_URL,
        vibrate: severity === "critical" ? [200, 100, 200, 100, 400] : [200]
      }
    }
  });

  // Clean up stale/invalid tokens automatically.
  const invalidKeys = [];
  response.responses.forEach((resp, idx) => {
    if (!resp.success) {
      const code = resp.error?.code;
      if (
        code === "messaging/invalid-registration-token" ||
        code === "messaging/registration-token-not-registered"
      ) {
        invalidKeys.push(validEntries[idx][0]);
      }
    }
  });

  if (invalidKeys.length > 0) {
    const updates = {};
    invalidKeys.forEach((k) => {
      updates[`fcm_tokens/${k}`] = null;
    });
    db.ref().update(updates).catch((e) => console.error("[FCM] Cleanup error:", e));
  }

  return {
    sent: response.successCount,
    failed: response.failureCount,
    cleaned: invalidKeys.length,
    total: entries.length
  };
}

/* ---- Email service -------------------------------------- */
function buildEmailHtml({ type, severity, description }) {
  const sType = sanitizeHTML(type);
  const sSeverity = sanitizeHTML(severity);
  const sDescription = sanitizeHTML(description);

  // Map severity levels to brand colors.
  const sevMap = {
    critical: "#ef4444", // Red
    high: "#f97316",     // Orange
    moderate: "#f59e0b", // Yellow/Amber
    low: "#22c55e"       // Green
  };
  const sevColor = sevMap[sSeverity.toLowerCase()] || "#fb923c";

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:20px;background:#0f172a;">
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#1e293b;color:#e2e8f0;border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);">

  <div style="background:linear-gradient(135deg,#1e293b,#0f172a);padding:28px 24px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.05);">
    <div style="font-size:36px;margin-bottom:8px;">🔔</div>
    <h1 style="margin:0;font-size:22px;font-weight:700;color:#fff;letter-spacing:1px;">DISASTER ALERT</h1>
    <div style="margin-top:8px;font-size:13px;color:#94a3b8;">${new Date().toLocaleString()}</div>
  </div>

  <div style="padding:24px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:8px 12px;color:#94a3b8;font-size:13px;width:110px;">Type</td>
        <td style="padding:8px 12px;font-weight:700;color:#f1f5f9;font-size:15px;">${sType}</td>
      </tr>
      <tr style="background:rgba(255,255,255,0.03);">
        <td style="padding:8px 12px;color:#94a3b8;font-size:13px;">Severity</td>
        <td style="padding:8px 12px;font-weight:700;color:${sevColor};font-size:15px;letter-spacing:1px;">${(sSeverity || "").toUpperCase()}</td>
      </tr>
      ${sDescription ? `<tr>
        <td style="padding:8px 12px;color:#94a3b8;font-size:13px;">Details</td>
        <td style="padding:8px 12px;color:#cbd5e1;">${sDescription}</td>
      </tr>` : ""}
    </table>

    <div style="margin-top:20px;padding:14px 16px;background:rgba(239,68,68,0.08);border-radius:8px;border-left:3px solid ${sevColor};">
      <p style="margin:0;font-size:13px;color:#fca5a5;line-height:1.6;">
        WARNING: <strong>Stay safe.</strong> Follow all official emergency broadcasts.
        Do not enter affected areas. Move to higher ground if advised.
      </p>
    </div>

    <p style="margin-top:20px;font-size:11px;color:#475569;text-align:center;">
      You received this alert because you subscribed to Disaster Alert notifications.<br>
      <small style="color:#334155">This is a broadcast notification sent to all subscribers.</small>
    </p>
  </div>
</div>
</body>
</html>`;
}

async function sendEmailAlerts({ type, severity, description }) {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailPass) {
    console.warn("[email-diag] GMAIL_USER or GMAIL_APP_PASSWORD not set in env vars.");
    return { skipped: true, reason: "env_missing" };
  }

  console.info(`[email-diag] Processing ${type} alert (${severity}).`);

  const db = getAdminDb();
  const snap = await db.ref("fcm_tokens").once("value");
  const tokensMap = snap.val() || {};

  const emailSnap = await db.ref("subscribers").once("value");
  const emailSubs = emailSnap.val() || {};

  const recipients = [];

  Object.values(tokensMap).forEach((v) => {
    if (v?.email && isValidEmail(v.email)) {
      recipients.push(v.email.toLowerCase());
    }
  });

  Object.values(emailSubs).forEach((v) => {
    if (v?.email && isValidEmail(v.email)) {
      recipients.push(v.email.toLowerCase());
    }
  });

  const emails = [...new Set(recipients)];

  console.info(
    `[email-diag] Recipients found: ${emails.length} (From DB: ${Object.keys(tokensMap).length} fcm, ${Object.keys(emailSubs).length} subscribers)`
  );

  if (emails.length === 0) {
    console.info("[email-diag] No subscribers found.");
    return { sent: 0, reason: "no_subscribers" };
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPass }
  });

  const subject = `[ALERT] ${(severity || "").toUpperCase()} ALERT: ${type} Detected`;
  const html = buildEmailHtml({ type, severity, description });

  const results = await Promise.allSettled(
    emails.map((to) =>
      transporter.sendMail({
        from: `"Disaster Alert System" <${gmailUser}>`,
        to,
        subject,
        html
      })
    )
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  const failedResults = results.filter((r) => r.status === "rejected");
  const failedCount = failedResults.length;

  if (failedCount > 0) {
    failedResults.forEach((r, idx) => {
      console.error(`[email-diag] Delivery error #${idx + 1}:`, r.reason);
    });
  }

  console.info(`[email-diag] Emails sent: ${sent}, Failed: ${failedCount}`);
  return { sent, failed: failedCount, total: emails.length };
}

/* ---- Handler --------------------------------------------- */
export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 1. API Key Validation
  const apiKey = req.headers["x-api-key"] || req.headers["authorization"]?.replace("Bearer ", "");
  const expectedKey = process.env.ALERT_API_KEY;

  if (!expectedKey) {
    console.error("[api/alert] ALERT_API_KEY is not defined in environment variables.");
    return res.status(500).json({ error: "API configuration error" });
  }

  if (apiKey !== expectedKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // 2. JSON Body Parsing check (handle cases where req.body is not automatically parsed)
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

    // 3. Basic Request Validation
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

    const [fcmResult, emailResult] = await Promise.allSettled([
      sendFCMMulticast({
        title: `${type} - ${displayLevel.toUpperCase()}`,
        body: description || "Emergency nearby. Stay safe.",
        severity: normSev,
        type
      }),
      sendEmailAlerts({
        type,
        severity: normSev,
        description
      })
    ]);

    return res.status(200).json({
      success: true,
      fcm:
        fcmResult.status === "fulfilled"
          ? fcmResult.value
          : { error: fcmResult.reason?.message },
      email:
        emailResult.status === "fulfilled"
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
