// Scripts for firebase and firebase messaging
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// Initialize the Firebase app in the service worker with identical project credentials
firebase.initializeApp({
  apiKey: "AIzaSyCUzWxWJWRtdYy4O5GTvziphzv2XXfTIx4",
  authDomain: "disaster-alert-50aae.firebaseapp.com",
  databaseURL: "https://disaster-alert-50aae-default-rtdb.firebaseio.com",
  projectId: "disaster-alert-50aae",
  storageBucket: "disaster-alert-50aae.firebasestorage.app",
  messagingSenderId: "359144434898",
  appId: "1:359144434898:web:844f9278880b73291c110b"
});

const messaging = firebase.messaging();

// Handle background push messages
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message: ', payload);

  const title = payload.notification?.title ||
    (payload.data?.type ? `🚨 ${payload.data.type} Alert Nearby` : '🚨 Disaster Alert Nearby');

  const body = payload.notification?.body ||
    payload.data?.description ||
    payload.data?.desc ||
    'A critical emergency alert was reported near your location.';

  const notificationOptions = {
    body: body,
    icon: payload.notification?.icon || '/favicon.ico',
    badge: '/favicon.ico',
    vibrate: [200, 100, 200, 100, 200], // SOS vibration pattern
    tag: payload.data?.alertId || 'disaster-alert',
    renotify: true,
    data: {
      url: payload.fcmOptions?.link || payload.data?.url || '/',
      ...payload.data
    }
  };

  self.registration.showNotification(title, notificationOptions);
});

// Handle notification click to open or focus the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
