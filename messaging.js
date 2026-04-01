/* =========================================================
   messaging.js — FCM Foreground Message Handler
   Phase 2: Stripped to its single responsibility.
   
   ✦ Registers service worker
   ✦ Handles FOREGROUND push messages (toast + activity)
   ✦ Token acquisition is now handled by notificationService
     (triggered on user action via Subscribe modal)
   ========================================================= */

import { getMessaging, onMessage }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { app } from "./src/config/firebase.js";

/* Register service worker (required for background notifications) */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/firebase-messaging-sw.js")
    .then(reg => console.log("[FCM] Service Worker registered:", reg.scope))
    .catch(err => console.error("[FCM] Service Worker registration failed:", err));
}

/* ── FOREGROUND MESSAGE HANDLER ─────────────────────────── */
const messaging = getMessaging(app);

onMessage(messaging, payload => {
  console.log("[FCM] Foreground message received:", payload);

  const title = payload.notification?.title || "Disaster Alert";
  const body  = payload.notification?.body  || "Emergency warning nearby";
  const sev   = (payload.data?.severity || "").toLowerCase();

  const type =
    sev === "critical" ? "critical" :
    sev === "high"     ? "warning"  : "info";

  const dotColor =
    sev === "critical" ? "red" :
    sev === "high"     ? "yellow" : "green";

  /* Use in-app toast (set by toastModule.js) when the page is visible */
  if (typeof window.showToast === "function") {
    window.showToast(`📡 ${title}`, body, type);
  } else {
    /* Fallback: native browser notification */
    if (Notification.permission === "granted") {
      new Notification(title, { body, icon: "/icon.png" });
    }
  }

  /* Log to activity stream */
  if (typeof window.addActivity === "function") {
    window.addActivity(`Broadcast received: <b>${title}</b>`, dotColor);
  }
});