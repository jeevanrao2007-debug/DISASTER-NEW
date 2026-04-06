/* =========================================================
   src/services/notificationService.js
   Phase 2: Full implementation

   Responsibilities:
   • subscribeUser(email) — requests permission, gets FCM
     token, stores it + email in Firebase via /api/register
   • triggerNotification(alert) — calls /api/alert to fan
     out push + email notifications
   ========================================================= */

import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { app, firebaseConfig } from "../config/firebase.js";

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
  _swReg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
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
 * 5. POST {token, email, location} to /api/register
 *
 * @param {string} email - User-provided email address
 * @returns {{ success: boolean, message: string }}
 */
export async function subscribeUser(email) {
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
      body: JSON.stringify({ token, email: email || null, location })
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error(`Server error: ${resp.status} - ${errBody.error || errBody.message || resp.statusText}`);
    }

    localStorage.setItem("fcm_token", token);
    localStorage.setItem("subscribed_email", email || "");

    return { success: true, message: "Subscribed! You'll receive alerts." };
  } catch (err) {
    console.error("[notificationService] Subscribe failed:", err);
    return { success: false, message: err.message || "Subscription failed." };
  }
}

/**
 * Trigger backend notification dispatch for a published alert.
 * Called from admin.js after publish or approve.
 *
 * @param {Object} alert - The alert object from Firebase
 */
export async function triggerNotification(alert) {
  try {
    const apiKey = globalThis?.DISASTER_ALERT_CONFIG?.apiKey;
    if (!apiKey) {
      console.warn(
        "[notificationService] Missing API key: DISASTER_ALERT_CONFIG.apiKey not configured. Notifications will not be dispatched."
      );
      return { error: "API key not configured" };
    }

    const resp = await fetch(`${API_BASE}/alert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify({
        type:        alert.type        || "Alert",
        severity:    alert.severity    || alert.level || "low",
        description: alert.description || alert.desc  || ""
      })
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      throw new Error(
        `API error ${resp.status}: ${errBody.error || resp.statusText}`
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
