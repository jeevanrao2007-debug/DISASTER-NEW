/* =========================================================
   src/services/notificationService.js
   Phase 2: Full implementation

   Responsibilities:
   • subscribeUser(payload) — requests permission, gets FCM
     token, stores token + optional WhatsApp opt-in fields
     in Firebase via /api/register
   • triggerNotification(alert) — calls /api/dispatch-alert
     to fan out push + WhatsApp notifications
   ========================================================= */

import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { app, firebaseConfig } from "../config/firebase.js";
import { normalizePhoneE164 } from "../utils/phone.js";

function resolveVapidKey() {
  const runtimeConfigKey = globalThis?.DISASTER_ALERT_CONFIG?.vapidKey;
  const configKey = firebaseConfig?.vapidKey;
  const windowKey = globalThis?.VITE_VAPID_KEY;
  const localOverride = localStorage.getItem("vapid_key");

  const vapidKey = runtimeConfigKey || configKey || windowKey || localOverride;
  if (!vapidKey) {
    throw new Error(
      "VAPID key not configured. Set DISASTER_ALERT_CONFIG.vapidKey, VITE_VAPID_KEY, or localStorage.vapid_key."
    );
  }
  return vapidKey;
}

const API_BASE = "/api"; // Vercel serverless base path

/* ── FCM MESSAGING INSTANCE ─────────────────────────────── */
let _messaging = null;
function getMsg() {
  if (!_messaging) _messaging = getMessaging(app);
  return _messaging;
}

/* ── SERVICE WORKER REGISTRATION ───────────────────────── */
let _swReg = null;
async function ensureServiceWorker() {
  if (_swReg) return _swReg;
  await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  _swReg = await navigator.serviceWorker.ready;
  return _swReg;
}

/* ── GEOLOCATION (for Phase 3 geofencing prep) ──────────── */
function getUserLocation() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 5000, maximumAge: 60000 }
    );
  });
}

/**
 * Full subscribe flow:
 * 1. Request Notification permission
 * 2. Register service worker
 * 3. Get FCM token
 * 4. Capture user location (optional)
 * 5. POST {token, location, whatsappNumber, whatsappOptIn} to /api/register
 *
 * @param {Object|string} payload - Optional subscription payload
 * @param {string} payload.whatsappNumber - Optional E.164 number
 * @param {boolean} payload.whatsappOptIn - Explicit WhatsApp opt-in
 * @returns {{ success: boolean, message: string }}
 */
export async function subscribeUser(payload = {}) {
  const normalizedPayload = typeof payload === "string"
    ? { whatsappNumber: payload, whatsappOptIn: true }
    : (payload || {});

  const rawWhatsApp = String(normalizedPayload.whatsappNumber || "").trim();
  const whatsappNumber = normalizePhoneE164(rawWhatsApp) || "";
  const whatsappOptIn = Boolean(normalizedPayload.whatsappOptIn);
  const effectiveWhatsAppOptIn = whatsappOptIn && Boolean(whatsappNumber);

  if (whatsappOptIn && rawWhatsApp && !whatsappNumber) {
    return {
      success: false,
      message: "Enter a valid WhatsApp number in E.164 format (example: +919876543210)."
    };
  }

  // Step 1: Request permission
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { success: false, message: "Notification permission denied." };
  }

  try {
    let vapidKey;
    try {
      vapidKey = resolveVapidKey();
    } catch (keyErr) {
      console.error("[notificationService]", keyErr.message);
      return { success: false, message: keyErr.message };
    }

    // Step 2: Ensure service worker
    const swReg = await ensureServiceWorker();

    // Step 3: Get FCM token
    const token = await getToken(getMsg(), {
      vapidKey,
      serviceWorkerRegistration: swReg
    });

    if (!token) {
      return { success: false, message: "Failed to get push token. Try again." };
    }

    // Step 4: Get location (non-blocking)
    const location = await getUserLocation();

    // Step 5: Register with backend
    const resp = await fetch(`${API_BASE}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        location,
        whatsappNumber: whatsappNumber || null,
        whatsappOptIn: effectiveWhatsAppOptIn
      })
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error(`Server error: ${resp.status} - ${errBody.error || errBody.message || resp.statusText}`);
    }

    localStorage.setItem("fcm_token", token);
    localStorage.setItem("subscribed_whatsapp", whatsappNumber || "");
    localStorage.setItem("whatsapp_opt_in", effectiveWhatsAppOptIn ? "true" : "false");

    const successMessage = (effectiveWhatsAppOptIn && whatsappNumber)
      ? "Subscribed! You'll receive push and WhatsApp alerts."
      : "Subscribed! You'll receive push alerts.";

    return { success: true, message: successMessage };
  } catch (err) {
    console.error("[notificationService] Subscribe failed:", err);
    return { success: false, message: err.message || "Subscription failed." };
  }
}

/**
 * Trigger backend notification dispatch for a published alert.
 * Called from admin.js after publish or approve.
 * 
 * Now uses secure Firebase ID token auth to call /api/dispatch-alert.
 *
 * @param {Object} alert - The alert object from Firebase
 */
export async function triggerNotification(alert) {
  try {
    // Get Firebase Auth instance and current user
    const authModule = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
    const { getAuth } = authModule;
    const { app } = await import("../config/firebase.js");
    
    const auth = getAuth(app);
    const user = auth.currentUser;
    
    if (!user) {
      console.warn(
        "[notificationService] No authenticated user. Cannot dispatch alert. " +
        "User must be logged in to trigger notifications."
      );
      return { error: "Not authenticated" };
    }

    // Get Firebase ID token
    const idToken = await user.getIdToken();

    const resp = await fetch(`/api/dispatch-alert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${idToken}`
      },
      body: JSON.stringify({
        type:        alert.type        || "Alert",
        severity:    alert.severity    || alert.level || "low",
        description: alert.description || alert.desc  || "",
        lat:         alert.lat,
        lng:         alert.lng
      })
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error(
        `Dispatch API error ${resp.status}: ${errBody.error || resp.statusText}`
      );
    }

    const result = await resp.json();
    console.info("[notificationService] Dispatch result:", result);
    return result;
  } catch (err) {
    console.error("[notificationService] Dispatch failed:", err.message);
    return { error: err.message };
  }
}

/**
 * Check if the user is already subscribed (has a persisted FCM token).
 */
export function isSubscribed() {
  return !!localStorage.getItem("fcm_token");
}
