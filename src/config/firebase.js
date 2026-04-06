/* =========================================================
   src/config/firebase.js
   Single source of truth for Firebase app initialization.
   All other modules import { app } from here — never
   call initializeApp() themselves.
   ========================================================= */

import { initializeApp, getApps, getApp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

export const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL:       import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  vapidKey:          import.meta.env.VITE_FIREBASE_VAPID_KEY,
  alertApiKey:       import.meta.env.VITE_ALERT_API_KEY
};

// Guard: reuse existing app if already initialized by another module
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
