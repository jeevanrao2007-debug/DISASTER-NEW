import {
  getApp,
  getApps,
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

function getFirebaseConfig() {
  const config = window.DISASTER_ALERT_CONFIG;

  if (!config) {
    throw new Error("Firebase config not loaded.");
  }

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
      throw new Error(`Firebase config is missing required field: ${field}`);
    }
  }

  return config;
}

let firebaseApp;
let firebaseInitError = null;

const firebaseAppReady = (async () => {
  try {
    await window.DISASTER_ALERT_CONFIG_READY;
    const config = getFirebaseConfig();
    firebaseApp = getApps().length ? getApp() : initializeApp(config);
  } catch (error) {
    firebaseInitError = error;
    console.error("[firebase.js] Initialization failed:", error.message);
  }
})();

export async function getFirebaseApp() {
  if (firebaseApp) {
    return firebaseApp;
  }

  await firebaseAppReady;

  if (firebaseInitError) {
    throw firebaseInitError;
  }

  if (!firebaseApp) {
    throw new Error("Firebase app failed to initialize");
  }

  return firebaseApp;
}

export const app = new Proxy({}, {
  get: (target, prop) => {
    if (!firebaseApp) {
      throw new Error("Firebase app not initialized yet. Use getFirebaseApp().");
    }

    return firebaseApp[prop];
  }
});
