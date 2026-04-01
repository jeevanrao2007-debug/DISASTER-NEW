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

messaging.onBackgroundMessage(payload => {

  self.registration.showNotification(
    payload.notification.title,
    {
      body: payload.notification.body,
      icon: "/icon.png",
      vibrate: [200,100,200,100,200],
      requireInteraction: true
    }
  );

});