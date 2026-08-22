import { initMap, addMarker, removeMarker, flyToMarker, fitMapBounds, refreshMarkerPopup, locateUserAndCenter, getUserLocation } from "./ui/mapModule.js";
import { setupAudioUnlock, enableCriticalUI, disableCriticalUI } from "./ui/alarmModule.js";
import { showToast } from "./ui/toastModule.js";
import { addActivity } from "./ui/activityModule.js";
import { showNearbyResourcesForAlert } from "./ui/resourcesPanel.js";
import { listenForAlerts } from "./services/alertService.js";
import { subscribeUser, isSubscribed } from "./services/notificationService.js";
import { initPushService, registerPushSubscription } from "./services/pushService.js";
import {
  initLanguage,
  setupLanguageToggle,
  onLanguageChange,
  t,
  translateAlertType,
  translateSeverity,
  translateDynamicText,
  applyDocumentTranslations
} from "./i18n/languageManager.js";

const sysStatus = document.getElementById("sysStatus");
const heartbeatDot = document.getElementById("heartbeatDot");
const overlay = document.getElementById("subModalOverlay");
const subBtn = document.getElementById("subscribeBtn");
const subResult = document.getElementById("subResult");
const subSubmit = document.getElementById("subSubmitBtn");
const locateFab = document.getElementById("locateMeFab");

function formatLiveStatus(count) {
  return t("messages.liveCount", `LIVE · ${count} ALERT${count !== 1 ? "S" : ""}`, {
    count,
    suffix: count !== 1 ? "S" : ""
  });
}

function setSubscribedUI() {
  subBtn?.classList.add("subscribed");
  if (subBtn) {
    subBtn.innerHTML = `✅ <span data-i18n="ui.subscribe">${t("ui.subscribe", "Subscribe")}</span>`;
  }
}

initMap("map", [13.0827, 80.2707], 12);
initLanguage();
setupLanguageToggle();
applyDocumentTranslations();
setupAudioUnlock();
initPushService();

// Automatically request user location and display the human-like figure pointer on dashboard load
if ("geolocation" in navigator) {
  getUserLocation()
    .then((coords) => {
      console.log("[index] Human-like user location pointer active at:", coords);
    })
    .catch((err) => {
      console.log("[index] Geolocation not permitted on startup:", err.message);
    });
}

// Locate Me button handler
locateFab?.addEventListener("click", async () => {
  try {
    locateFab.style.transform = "scale(0.9)";
    setTimeout(() => { locateFab.style.transform = ""; }, 150);
    showToast("Locating", "Finding your GPS coordinates...", "info");
    await locateUserAndCenter();
    showToast("Located", "Centered map on your location.", "success");
  } catch (err) {
    showToast("Location Error", "Could not get your location. Please check browser permissions.", "warning");
  }
});

let heartbeatTimer;
function bumpHeartbeat() {
  heartbeatDot?.classList.remove("offline");
  clearTimeout(heartbeatTimer);
  heartbeatTimer = setTimeout(() => heartbeatDot?.classList.add("offline"), 8000);
}

let markers = {};
let previousAlertIds = new Set();
let isInitialLoad = true;
let latestAlertCount = 0;
let unsubscribeAlerts = null;
let unsubscribeLanguageChange = null;

unsubscribeLanguageChange = onLanguageChange(() => {
  applyDocumentTranslations();
  if (sysStatus) {
    sysStatus.textContent = formatLiveStatus(latestAlertCount);
  }
  Object.values(markers).forEach((marker) => refreshMarkerPopup(marker));
});

(async function initAlertsListener() {
  unsubscribeAlerts = await listenForAlerts((data) => {
    bumpHeartbeat();

    const bounds = [];
    const newBounds = [];
    let critical = false;
    const currentIds = new Set(Object.keys(data));
    const newIds = [...currentIds].filter((id) => !previousAlertIds.has(id));

    Object.keys(markers).forEach((id) => {
      if (!currentIds.has(id)) {
        removeMarker(markers[id]);
        delete markers[id];
      }
    });

    Object.entries(data).forEach(([id, alert]) => {
      if (typeof alert.lat !== "number" || typeof alert.lng !== "number" || !isFinite(alert.lat) || !isFinite(alert.lng)) {
        return;
      }

      const severity = alert.severity || alert.level || "moderate";

      if (markers[id]) {
        if (String(severity).toLowerCase() === "critical") critical = true;
        bounds.push([alert.lat, alert.lng]);
        return;
      }

      markers[id] = addMarker(
        [alert.lat, alert.lng],
        severity,
        alert,
        id,
        false,
        null,
        () => showNearbyResourcesForAlert({ id, ...alert, severity })
      );

      bounds.push([alert.lat, alert.lng]);
      if (String(severity).toLowerCase() === "critical") critical = true;

      if (newIds.includes(id) && !isInitialLoad) {
        const isCritical = String(severity).toLowerCase() === "critical";
        const isHigh = String(severity).toLowerCase() === "high";
        const dotColor = isCritical ? "red" : isHigh ? "yellow" : "green";
        const alertType = translateAlertType(alert.type || "Disaster");
        const severityLabel = translateSeverity(severity);
        const descriptionText = translateDynamicText(alert.desc || alert.description || "");

        addActivity(`${alertType} ${t("ui.alert", "Alert")} — <b>${severityLabel}</b>`, dotColor);
        showToast(
          `${alertType} ${t("ui.alert", "Alert")}`,
          descriptionText || `${t("ui.severity", "Severity")}: ${severityLabel}`,
          isCritical ? "critical" : isHigh ? "warning" : "info"
        );

        if (isCritical) {
          enableCriticalUI();
        }

        newBounds.push([alert.lat, alert.lng]);
      }
    });

    previousAlertIds = currentIds;
    latestAlertCount = currentIds.size;

    if (sysStatus) {
      sysStatus.textContent = formatLiveStatus(currentIds.size);
    }

    if (isInitialLoad && bounds.length > 0) {
      fitMapBounds(bounds, [60, 60]);
      isInitialLoad = false;
    } else if (newBounds.length > 0) {
      if (newBounds.length === 1) {
        flyToMarker(newBounds[0], 13, 1.2);
      } else {
        fitMapBounds(newBounds, [60, 60]);
      }
    }

    if (critical) {
      enableCriticalUI();
    } else {
      disableCriticalUI();
    }
  });
})();

if (isSubscribed()) {
  setSubscribedUI();
}

window.openSubscribeModal = () => {
  overlay?.classList.add("open");
  document.getElementById("subEmail")?.focus();
  // Prompt for push & location in the background if not yet requested
  registerPushSubscription().catch(() => {});
};

window.closeSubscribeModal = () => {
  overlay?.classList.remove("open");
  if (subResult) {
    subResult.textContent = "";
    subResult.className = "sub-result";
  }
};

overlay?.addEventListener("click", (event) => {
  if (event.target === overlay) {
    window.closeSubscribeModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && overlay?.classList.contains("open")) {
    window.closeSubscribeModal();
  }
});

window.addEventListener("beforeunload", () => {
  if (typeof unsubscribeAlerts === "function") unsubscribeAlerts();
  if (typeof unsubscribeLanguageChange === "function") unsubscribeLanguageChange();
});

window.handleSubscribe = async () => {
  const email = document.getElementById("subEmail")?.value?.trim() || "";

  if (subSubmit) {
    subSubmit.disabled = true;
    subSubmit.textContent = "Subscribing...";
  }

  if (subResult) {
    subResult.textContent = "";
    subResult.className = "sub-result";
  }

  // Also ensure push subscription is attempted
  registerPushSubscription().catch(() => {});

  const { success, message } = await subscribeUser({ email });

  if (subResult) {
    subResult.textContent = message;
    subResult.className = `sub-result ${success ? "success" : "error"}`;
  }

  if (success) {
    setSubscribedUI();
    addActivity("Subscribed to email alerts", "green");
    setTimeout(() => window.closeSubscribeModal(), 2500);
  }

  if (subSubmit) {
    subSubmit.disabled = false;
    subSubmit.textContent = "Subscribe to Email Alerts";
  }
};

const aiBtn = document.getElementById("aiAdvisorBtn");
aiBtn?.addEventListener("click", () => {
  if (window._aiOpenPanel) {
    window._aiOpenPanel();
  }
});
