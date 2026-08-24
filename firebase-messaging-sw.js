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

// 6-Second Multi-Pulse Vibration Sequence for Supported Web Push Devices
const EMERGENCY_VIBRATION_PATTERN = [500, 200, 500, 200, 500, 200, 1000, 300, 1000, 300, 1000];

// ============================================================================
// Unified Single Push Event Handler (Keeps worker alive via event.waitUntil)
// ============================================================================
self.addEventListener('push', (event) => {
  console.log('[SW] Push received');

  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (parseErr) {
      console.warn('[SW] Non-JSON push payload received, falling back to text');
      payload = { data: { body: event.data.text() } };
    }
  }

  const notificationData = payload.notification || {};
  const customData = payload.data || {};

  const title = notificationData.title ||
    customData.title ||
    (customData.type ? `🚨 ${customData.type} Alert Nearby` : '🚨 Emergency Disaster Alert');

  const body = notificationData.body ||
    customData.body ||
    customData.description ||
    customData.desc ||
    'A critical emergency alert was reported near your location. Take immediate precautions.';

  const targetUrl = payload.fcmOptions?.link || customData.url || '/';
  const tag = notificationData.tag || customData.alertId || 'critical-emergency-alert';

  const notificationOptions = {
    body: body,
    icon: notificationData.icon || '/assets/icons/icon-192.png',
    badge: notificationData.badge || '/assets/icons/icon-192.png',
    vibrate: EMERGENCY_VIBRATION_PATTERN,
    requireInteraction: true,
    renotify: true,
    tag: tag,
    silent: false,
    data: {
      url: targetUrl,
      ...customData
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, notificationOptions)
      .then(() => {
        console.log('[SW] Notification displayed');
      })
      .catch((displayErr) => {
        console.error('[SW] Failed to display notification:', displayErr);
      })
  );
});

// ============================================================================
// Handle Notification Click to Focus or Open the PWA
// ============================================================================
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
