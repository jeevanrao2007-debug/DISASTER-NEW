/* Firebase Messaging Service Worker */

importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCUzWxWJWRtdYy4O5GTvziphzv2XXfTIx4",
  authDomain: "disaster-alert-50aae.firebaseapp.com",
  projectId: "disaster-alert-50aae",
  messagingSenderId: "359144434898",
  appId: "1:359144434898:web:844f9278880b73291c110b"
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