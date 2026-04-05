/* Firebase Messaging Service Worker */

importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

// To avoid hardcoding keys in public files, replace these placeholders 
// with your actual Firebase config or inject them during deployment.
firebase.initializeApp({
  apiKey: "FIREBASE_API_KEY_PLACEHOLDER",
  authDomain: "FIREBASE_AUTH_DOMAIN_PLACEHOLDER",
  projectId: "FIREBASE_PROJECT_ID_PLACEHOLDER",
  messagingSenderId: "FIREBASE_MESSAGING_SENDER_ID_PLACEHOLDER",
  appId: "FIREBASE_APP_ID_PLACEHOLDER"
});

const messaging = firebase.messaging();

/* BACKGROUND MESSAGE HANDLER */
messaging.onBackgroundMessage(function(payload) {

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