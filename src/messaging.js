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
import { app } from "./config/firebase.js";

const NOTIFICATION_ICON_URL = "https://cdn-icons-png.flaticon.com/512/564/564619.png";

/* NOTE: Service worker is registered in notificationService.js during subscribeUser().
   Do not register again here to avoid lifecycle conflicts. */

/* ── FOREGROUND MESSAGE HANDLER ─────────────────────────── */
const messaging = getMessaging(app);

onMessage(messaging, payload => {
  console.log("[FCM] Foreground message received:", payload);

  if (!payload || !payload.notification) {
    console.warn("[FCM] Received message without notification field. Skipping foreground handling.");
    return;
  }

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
      new Notification(title, { body, icon: NOTIFICATION_ICON_URL });
    }
  }

  /* Log to activity stream */
  if (typeof window.addActivity === "function") {
    window.addActivity(`Broadcast received: <b>${title}</b>`, dotColor);
  }
});
