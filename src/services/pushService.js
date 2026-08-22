/**
 * Push Notification Service (Firebase Cloud Messaging)
 * Additive service for geofenced push alerts.
 */

import { getFirebaseApp } from "../config/firebase.js";

function getRegisterPushUrl() {
  return globalThis?.DISASTER_ALERT_FUNCTIONS?.registerPush || "/registerPush";
}

function getCurrentCoordinates() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      return reject(new Error("Geolocation not supported by browser"));
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
      },
      (error) => {
        reject(error);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      }
    );
  });
}

/**
 * Register push notification subscription with token & current coordinates.
 * Non-blocking, fails gracefully without disrupting any email or map workflows.
 */
export async function registerPushSubscription() {
  try {
    if (!("serviceWorker" in navigator) || !("Notification" in window)) {
      console.log("[pushService] Push notifications or Service Worker not supported in this browser.");
      return { success: false, reason: "unsupported" };
    }

    // 1. Request notification permission
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.log("[pushService] Notification permission not granted:", permission);
      return { success: false, reason: "notification_permission_denied" };
    }

    // 2. Request geolocation permission
    let coords;
    try {
      coords = await getCurrentCoordinates();
      console.log("[pushService] Obtained coordinates for push registration:", coords);
    } catch (geoErr) {
      console.warn("[pushService] Geolocation permission denied or unavailable:", geoErr.message);
      return { success: false, reason: "geolocation_denied" };
    }

    // 3. Register service worker
    const registration = await navigator.serviceWorker.register("./firebase-messaging-sw.js");
    await navigator.serviceWorker.ready;

    // 4. Initialize Firebase messaging & get token
    const firebaseApp = await getFirebaseApp();
    const { getMessaging, getToken } = await import(
      "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js"
    );

    const messaging = getMessaging(firebaseApp);
    const vapidKey = window.DISASTER_ALERT_CONFIG?.vapidKey;

    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration
    });

    if (!token) {
      console.warn("[pushService] No FCM token returned.");
      return { success: false, reason: "no_token" };
    }

    console.log("[pushService] FCM token obtained successfully:", token.substring(0, 15) + "...");

    // 5. Send token and coordinates to backend
    const response = await fetch(getRegisterPushUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        token,
        lat: coords.lat,
        lng: coords.lng
      })
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.error || "Failed to register push subscription on backend");
    }

    const result = await response.json();
    console.log("[pushService] Push subscription registered on backend:", result);
    localStorage.setItem("push_subscribed", "true");

    return {
      success: true,
      token,
      coords
    };
  } catch (error) {
    console.warn("[pushService] Gracefully caught push subscription error:", error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Automatically check and attempt push registration if permissions are already granted,
 * or setup trigger handlers.
 */
export async function initPushService() {
  if (!("serviceWorker" in navigator) || !("Notification" in window)) {
    return;
  }

  // If permission is already granted, refresh the token & location registration quietly in background
  if (Notification.permission === "granted") {
    try {
      await registerPushSubscription();
    } catch (e) {
      console.debug("[pushService] Background push refresh skipped:", e.message);
    }
  }
}
