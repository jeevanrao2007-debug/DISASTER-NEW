/**
 * Push Notification Service (Firebase Cloud Messaging)
 * Robust registration with direct Firebase Realtime Database persistence & backend fallback.
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

function createSafeKey(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  const cleanStr = str.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);
  return `sub_${cleanStr}_${Math.abs(hash)}`;
}

/**
 * Register push notification subscription with token & current coordinates.
 * Saves directly into Firebase Realtime Database and notifies backend.
 */
export async function registerPushSubscription() {
  try {
    if (!("serviceWorker" in navigator) || !("Notification" in window)) {
      console.log("[pushService] Push notifications or Service Worker not supported.");
      return { success: false, reason: "unsupported" };
    }

    // 1. Request notification permission
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.log("[pushService] Notification permission not granted:", permission);
      return { success: false, reason: "notification_permission_denied" };
    }

    // 2. Request geolocation permission
    let coords = { lat: 13.0827, lng: 80.2707 }; // Default fallback coordinates
    try {
      coords = await getCurrentCoordinates();
      console.log("[pushService] Obtained coordinates for push registration:", coords);
    } catch (geoErr) {
      console.warn("[pushService] Geolocation unavailable, using fallback:", geoErr.message);
    }

    // 3. Register service worker with updateViaCache: 'none'
    const registration = await navigator.serviceWorker.register("./firebase-messaging-sw.js", {
      updateViaCache: "none"
    });
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

    // 5. Direct write to Firebase Realtime Database (100% instant, bypasses server cold starts)
    try {
      const { getDatabase, ref, set } = await import(
        "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js"
      );
      const db = getDatabase(firebaseApp);
      const dbKey = createSafeKey(token);

      await set(ref(db, `pushSubscribers/${dbKey}`), {
        token,
        lat: Number(coords.lat),
        lng: Number(coords.lng),
        updatedAt: Date.now(),
        platform: navigator.userAgent || "web"
      });
      console.log("[pushService] Saved push subscriber directly into Firebase Realtime Database:", dbKey);
    } catch (rtdbErr) {
      console.warn("[pushService] Direct RTDB write fallback warning:", rtdbErr.message);
    }

    // 6. Also notify backend endpoint if available
    try {
      fetch(getRegisterPushUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, lat: coords.lat, lng: coords.lng })
      }).catch(() => {});
    } catch (e) {}

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
 * Automatically check and attempt push registration if permissions are already granted.
 */
export async function initPushService() {
  if (!("serviceWorker" in navigator) || !("Notification" in window)) {
    return;
  }

  if (Notification.permission === "granted") {
    try {
      await registerPushSubscription();
    } catch (e) {
      console.debug("[pushService] Background push refresh skipped:", e.message);
    }
  }
}
