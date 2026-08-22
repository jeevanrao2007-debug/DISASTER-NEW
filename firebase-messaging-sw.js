// Scripts for firebase and firebase messaging
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// Force immediate activation of the latest service worker on Android
self.addEventListener('install', (event) => {
  console.log('[SW] Installing latest emergency service worker...');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating latest emergency service worker and claiming clients...');
  event.waitUntil(clients.claim());
});

// Initialize Firebase in Service Worker
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

// 6-Second Heavy Multi-Pulse Vibration Sequence for Android Pockets
const HEAVY_POCKET_VIBRATION = [500, 200, 500, 200, 500, 200, 1000, 300, 1000, 300, 1000];

// Handle background push messages
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received emergency background push:', payload);

  const title = payload.notification?.title ||
    payload.data?.title ||
    (payload.data?.type ? `🚨 ${payload.data.type} Alert Nearby` : '🚨 Disaster Alert Nearby');

  const body = payload.notification?.body ||
    payload.data?.body ||
    payload.data?.description ||
    payload.data?.desc ||
    'A critical emergency alert was reported near your location. Take immediate precautions.';

  const notificationOptions = {
    body: body,
    icon: payload.notification?.icon || '/favicon.ico',
    badge: '/favicon.ico',
    vibrate: HEAVY_POCKET_VIBRATION,
    requireInteraction: true,
    renotify: true,
    tag: payload.data?.alertId || 'critical-emergency-alert',
    silent: false,
    data: {
      url: payload.fcmOptions?.link || payload.data?.url || '/',
      ...payload.data
    }
  };

  self.registration.showNotification(title, notificationOptions);
});

// Direct Web Push Event Fallback (ensures vibration triggers even if FCM compat bypasses onBackgroundMessage)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const raw = event.data.json();
    console.log('[SW:push] Raw push payload received:', raw);

    const title = raw.notification?.title ||
      raw.data?.title ||
      (raw.data?.type ? `🚨 ${raw.data.type} Alert Nearby` : '🚨 Disaster Alert Nearby');

    const body = raw.notification?.body ||
      raw.data?.body ||
      raw.data?.description ||
      'Critical emergency alert reported nearby.';

    event.waitUntil(
      self.registration.showNotification(title, {
        body: body,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        vibrate: HEAVY_POCKET_VIBRATION,
        requireInteraction: true,
        renotify: true,
        tag: raw.data?.alertId || 'critical-emergency-alert',
        silent: false,
        data: {
          url: raw.fcmOptions?.link || raw.data?.url || '/',
          ...raw.data
        }
      })
    );
  } catch (err) {
    console.warn('[SW:push] Fallback parsing push payload:', err);
  }
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
