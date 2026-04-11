/* =========================================================
   src/config/firebase.js
   Single source of truth for Firebase app initialization.
   All other modules import { app } from here — never
   call initializeApp() themselves.
   
   Firebase config is loaded at runtime from the server
   via window.DISASTER_ALERT_CONFIG (set by src/bootstrap.js).
   ========================================================= */

import { initializeApp, getApps, getApp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

// Runtime config loaded from /api/runtime-config by bootstrap.js
function getFirebaseConfig() {
  const config = window.DISASTER_ALERT_CONFIG;
  
  if (!config) {
    throw new Error(
      "Firebase config not loaded. Ensure src/bootstrap.js is included before this module. " +
      "window.DISASTER_ALERT_CONFIG should be set by the runtime config loader."
    );
  }

  // Validate required fields
  const requiredFields = [
    "apiKey",
    "authDomain",
    "databaseURL",
    "projectId",
    "storageBucket",
    "messagingSenderId",
    "appId",
    "vapidKey"
  ];

  for (const field of requiredFields) {
    if (!config[field]) {
      throw new Error(
        `Firebase config is missing required field: ${field}. ` +
        `This usually means the runtime config endpoint returned incomplete data.`
      );
    }
  }

  return config;
}

// Wait for bootstrap.js to load config before initializing Firebase
let firebaseConfig;
let firebaseApp;
let firebaseInitError = null;

const firebaseAppReady = (async function initializeFirebase() {
  try {
    // Wait for bootstrap.js to finish loading config
    await window.DISASTER_ALERT_CONFIG_READY;
    firebaseConfig = getFirebaseConfig();
    firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
  } catch (err) {
    firebaseInitError = err;
    console.error("[firebase.js] Initialization failed:", err.message);
  }
})();

export async function getFirebaseApp() {
  // If already initialized, return immediately
  if (firebaseApp) return firebaseApp;

  // Wait for initialization to complete
  await firebaseAppReady;

  if (firebaseInitError) {
    throw firebaseInitError;
  }

  if (!firebaseApp) {
    throw new Error("Firebase app failed to initialize");
  }

  return firebaseApp;
}

// For backward compatibility, provide both lazy and direct access
export const app = new Proxy({}, {
  get: (target, prop) => {
    if (!firebaseApp) {
      throw new Error(
        "Firebase app not initialized yet. Use getFirebaseApp() or wait for window.DISASTER_ALERT_CONFIG_READY"
      );
    }
    return firebaseApp[prop];
  }
});
