import { getFirebaseApp } from "../config/firebase.js";

let firebaseApp = null;

function getFunctionUrl(name) {
  const url = globalThis?.DISASTER_ALERT_FUNCTIONS?.[name];
  if (!url) {
    throw new Error(`Missing Cloud Function URL for ${name}`);
  }

  return url;
}

export async function subscribeUser(payload = {}) {
  const email = typeof payload?.email === "string" && payload.email.trim()
    ? payload.email.trim().toLowerCase()
    : null;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, message: "A valid email address is required." };
  }

  try {
    const response = await fetch(getFunctionUrl("register"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email })
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error || errorBody.detail || response.statusText);
    }

    localStorage.setItem("alert_email", email);

    return {
      success: true,
      message: "Subscribed to email alerts."
    };
  } catch (error) {
    console.error("[notificationService] Subscribe failed:", error);
    return {
      success: false,
      message: error.message || "Subscription failed."
    };
  }
}

export async function triggerNotification(alert) {
  try {
    const authModule = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
    const { getAuth } = authModule;

    firebaseApp = firebaseApp || await getFirebaseApp();
    const auth = getAuth(firebaseApp);
    const user = auth.currentUser;

    if (!user) {
      return { error: "Not authenticated" };
    }

    const idToken = await user.getIdToken();
    const response = await fetch(getFunctionUrl("dispatchAlert"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({
        type: alert.type || "Alert",
        severity: alert.severity || alert.level || "moderate",
        level: alert.level || alert.severity || "Moderate",
        description: alert.description || alert.desc || "",
        lat: alert.lat,
        lng: alert.lng,
        expiresAt: alert.expiresAt
      })
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error || errorBody.detail || response.statusText);
    }

    return response.json();
  } catch (error) {
    console.error("[notificationService] Dispatch failed:", error);
    return { error: error.message };
  }
}

export function isSubscribed() {
  return Boolean(localStorage.getItem("alert_email"));
}
