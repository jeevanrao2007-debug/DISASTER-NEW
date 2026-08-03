const DEFAULT_FIREBASE_CONFIG = Object.freeze({
  apiKey: "AIzaSyCUzWxWJWRtdYy4O5GTvziphzv2XXfTIx4",
  authDomain: "disaster-alert-50aae.firebaseapp.com",
  databaseURL: "https://disaster-alert-50aae-default-rtdb.firebaseio.com",
  projectId: "disaster-alert-50aae",
  storageBucket: "disaster-alert-50aae.firebasestorage.app",
  messagingSenderId: "359144434898",
  appId: "1:359144434898:web:844f9278880b73291c110b",
  vapidKey: "BPB4AgB1jx0U7iAjyGRW4DBe2Z5hqWXS0s-ir0jBiAUZiMWlIMXdUNtaJyyc07Q7Ye5tvkSu0L5b_3z3_MXl7qg"
});

const runtimeOverrides = globalThis.__DISASTER_ALERT_CONFIG__ || {};
const firebaseConfig = Object.freeze({
  ...DEFAULT_FIREBASE_CONFIG,
  ...runtimeOverrides
});

const isLocalhost = Boolean(
  globalThis.location?.hostname === "localhost" ||
  globalThis.location?.hostname === "127.0.0.1"
);

const functionsBaseUrl =
  globalThis.__DISASTER_ALERT_FUNCTIONS_BASE_URL__ ||
  runtimeOverrides.functionsBaseUrl ||
  (isLocalhost
    ? "http://localhost:3000"
    : "https://disaster-new.onrender.com");

window.DISASTER_ALERT_CONFIG = firebaseConfig;
window.DISASTER_ALERT_FUNCTIONS = Object.freeze({
  register: runtimeOverrides.functions?.register || `${functionsBaseUrl}/register`,
  dispatchAlert: runtimeOverrides.functions?.dispatchAlert || `${functionsBaseUrl}/dispatchAlert`,
  aiAdvisor: runtimeOverrides.functions?.aiAdvisor || `${functionsBaseUrl}/aiAdvisor`,
  nearbyResources: runtimeOverrides.functions?.nearbyResources || `${functionsBaseUrl}/nearbyResources`
});

window.DISASTER_ALERT_CONFIG_READY = Promise.resolve(firebaseConfig);
