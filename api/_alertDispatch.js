/* =========================================================
   api/_alertDispatch.js
   Shared alert dispatch logic
   
   Extracted from api/alert.js to be reused by both:
   - api/alert.js (backward compatible API key auth route)
   - api/dispatch-alert.js (new Firebase ID token auth route)
   ========================================================= */

import { getAdminDb, getAdminMessaging } from "./_firebaseAdmin.js";
import {
  getWhatsAppDispatchConfig,
  isValidPhoneE164,
  normalizePhoneE164,
  sendWhatsAppMessage,
  validateWhatsAppProviderConfig
} from "./_whatsappProvider.js";

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

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function toDisplaySeverity(severity) {
  const norm = String(severity || "moderate").toLowerCase();
  return norm.charAt(0).toUpperCase() + norm.slice(1);
}

function resolveLocation(alertData = {}) {
  if (typeof alertData.location === "string" && alertData.location.trim()) {
    return alertData.location.trim();
  }
  if (typeof alertData.locationName === "string" && alertData.locationName.trim()) {
    return alertData.locationName.trim();
  }
  if (typeof alertData.city === "string" && alertData.city.trim()) {
    return alertData.city.trim();
  }

  const lat = toFiniteNumber(alertData.lat);
  const lng = toFiniteNumber(alertData.lng);
  if (lat != null && lng != null) {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }

  return "Unknown location";
}

function resolveInstructions(alertData = {}, severity = "moderate") {
  if (typeof alertData.instructions === "string" && alertData.instructions.trim()) {
    return alertData.instructions.trim();
  }

  const norm = String(severity || "moderate").toLowerCase();
  if (norm === "critical") {
    return "Move to a safe shelter immediately and follow official emergency advisories.";
  }
  if (norm === "high") {
    return "Stay indoors, avoid non-essential travel, and monitor official updates.";
  }
  if (norm === "moderate") {
    return "Stay alert and avoid risk-prone areas until conditions improve.";
  }
  return "Remain cautious and follow local authority guidance.";
}

function buildWhatsAppMessage(alertData = {}) {
  const type = String(alertData.type || "Disaster");
  const severity = toDisplaySeverity(alertData.severity || alertData.level || "moderate");
  const location = resolveLocation(alertData);
  const instructions = resolveInstructions(alertData, alertData.severity || alertData.level);

  return [
    `Disaster Alert: ${type}`,
    `Location: ${location}`,
    `Severity: ${severity}`,
    `Instructions: ${instructions}`
  ].join("\n");
}

/* ---- FCM multicast --------------------------------------- */
export async function sendFCMMulticast({ title, body, severity, type }) {
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

function collectWhatsAppRecipientsFromRecords(records = []) {
  const unique = new Set();

  records.forEach((entry) => {
    const optedIn = entry?.whatsappOptIn === true || entry?.whatsappOptIn === "true";
    if (!optedIn) return;

    const normalized = normalizePhoneE164(entry?.whatsappNumber || "");
    if (!normalized || !isValidPhoneE164(normalized)) return;
    unique.add(normalized);
  });

  return [...unique];
}

export async function listWhatsAppRecipients() {
  const db = getAdminDb();

  const [tokensSnap, subscribersSnap] = await Promise.all([
    db.ref("fcm_tokens").once("value"),
    db.ref("whatsapp_subscribers").once("value")
  ]);

  const tokenRecords = Object.values(tokensSnap.val() || {});
  const subscriberRecords = Object.values(subscribersSnap.val() || {}).map((item) => ({
    whatsappNumber: item?.whatsappNumber,
    whatsappOptIn: item?.whatsappOptIn !== false
  }));

  return collectWhatsAppRecipientsFromRecords([...tokenRecords, ...subscriberRecords]);
}

export async function sendWhatsAppAlert(alertData = {}, recipients = []) {
  const { provider, batchSize, maxParallelBatches } = getWhatsAppDispatchConfig();

  try {
    validateWhatsAppProviderConfig();
  } catch (err) {
    return {
      sent: 0,
      failed: 0,
      total: 0,
      provider,
      skipped: err.code || "provider_config_error",
      detail: err.message
    };
  }

  const initialRecipients = Array.isArray(recipients) && recipients.length
    ? recipients
    : await listWhatsAppRecipients();

  const normalizedRecipients = [...new Set(
    initialRecipients
      .map((value) => normalizePhoneE164(value || ""))
      .filter(Boolean)
  )];

  if (normalizedRecipients.length === 0) {
    return {
      sent: 0,
      failed: 0,
      total: 0,
      provider,
      skipped: "no_recipients"
    };
  }

  const message = buildWhatsAppMessage(alertData);
  const batches = chunkArray(normalizedRecipients, batchSize);
  const errorsSample = [];

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < batches.length; i += maxParallelBatches) {
    const group = batches.slice(i, i + maxParallelBatches);

    const groupResults = await Promise.all(
      group.map(async (batch) => {
        const settled = await Promise.allSettled(
          batch.map((to) => sendWhatsAppMessage({ to, body: message }))
        );

        let batchSent = 0;
        let batchFailed = 0;

        settled.forEach((result, idx) => {
          if (result.status === "fulfilled") {
            batchSent += 1;
            return;
          }

          batchFailed += 1;
          if (errorsSample.length < 10) {
            errorsSample.push({
              to: batch[idx],
              code: result.reason?.code || "delivery_error",
              error: result.reason?.message || "Unknown provider error"
            });
          }
        });

        return { batchSent, batchFailed };
      })
    );

    groupResults.forEach((entry) => {
      sent += entry.batchSent;
      failed += entry.batchFailed;
    });
  }

  return {
    sent,
    failed,
    total: normalizedRecipients.length,
    provider,
    batchSize,
    batches: batches.length,
    errorsSample
  };
}
