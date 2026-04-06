/* Firebase Messaging Service Worker */

importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

// To avoid hardcoding keys in public files, replace these placeholders 
// with your actual Firebase config or inject them during deployment.
firebase.initializeApp(globalThis.FIREBASE_SW_CONFIG);

const messaging = firebase.messaging();

/* BACKGROUND MESSAGE HANDLER */
messaging.onBackgroundMessage(function(payload) {
  
  if (!payload || !payload.notification) {
    console.warn("[FCM Service Worker] Received message without notification field. Skipping.");
    return;
  }

  const title = payload.notification.title || "Disaster Alert";
  const body = payload.notification.body || "Emergency warning nearby";

  self.registration.showNotification(title, {
    body: body,
    icon: "https://cdn-icons-png.flaticon.com/512/564/564619.png",
    badge: "https://cdn-icons-png.flaticon.com/512/564/564619.png",
    vibrate: [300,100,300,100,300],
    requireInteraction: true
  });

});