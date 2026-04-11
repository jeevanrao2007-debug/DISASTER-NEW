/* =========================================================
   src/index.js
   Entry point for the public dashboard (index.html).
   Ties together the map, live alerts, and UI modules.
   ========================================================= */

import { initMap, addMarker, removeMarker, flyToMarker, fitMapBounds, refreshMarkerPopup } from "./ui/mapModule.js";
import { setupAudioUnlock, enableCriticalUI, disableCriticalUI } from "./ui/alarmModule.js";
import { showToast } from "./ui/toastModule.js";
import { addActivity } from "./ui/activityModule.js";
import { showNearbyResourcesForAlert } from "./ui/resourcesPanel.js";
import { listenForAlerts } from "./services/alertService.js";
import { subscribeUser, isSubscribed } from "./services/notificationService.js";
import { normalizePhoneE164 } from "./utils/phone.js";
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

// DOM Elements
const sysStatus = document.getElementById("sysStatus");
const heartbeatDot = document.getElementById("heartbeatDot");

function formatLiveStatus(count) {
  return t("messages.liveCount", `LIVE · ${count} ALERT${count !== 1 ? "S" : ""}`, {
    count,
    suffix: count !== 1 ? "S" : ""
  });
}

// Initialize Map
initMap('map', [13.0827, 80.2707], 12);
initLanguage();
setupLanguageToggle();
applyDocumentTranslations();

// Setup audio unlock requirement
setupAudioUnlock();

// Heartbeat status logic
let heartbeatTimer;
function bumpHeartbeat() {
  if (heartbeatDot) heartbeatDot.classList.remove("offline");
  clearTimeout(heartbeatTimer);
  heartbeatTimer = setTimeout(() => {
    if (heartbeatDot) heartbeatDot.classList.add("offline");
  }, 8000);
}

// Markers tracking
let markers = {};
let previousAlertIds = new Set();
let isInitialLoad = true;
let latestAlertCount = 0;

// Store unsubscribe functions to prevent memory leaks
let unsubscribeAlerts = null;
let unsubscribeLanguageChange = null;

unsubscribeLanguageChange = onLanguageChange(() => {
  applyDocumentTranslations();

  if (sysStatus) {
    sysStatus.textContent = formatLiveStatus(latestAlertCount);
  }

  Object.values(markers).forEach((marker) => refreshMarkerPopup(marker));
});

// Listen to Live Alerts
(async function initAlertsListener() {
  unsubscribeAlerts = await listenForAlerts((data) => {
    bumpHeartbeat();

    const bounds = [];
    const newBounds = [];
    let critical = false;
    const currentIds = new Set(Object.keys(data));
    const newIds = [...currentIds].filter(id => !previousAlertIds.has(id));

    // Fade-remove stale markers
    Object.keys(markers).forEach(id => {
      if (!currentIds.has(id)) {
        removeMarker(markers[id]);
        delete markers[id];
      }
    });

    // Rebuild map markers
    Object.entries(data).forEach(([id, a]) => {
      // Ensure coordinates are valid numbers
      if (typeof a.lat !== "number" || typeof a.lng !== "number" || !isFinite(a.lat) || !isFinite(a.lng)) {
        console.warn(`[index] Alert ${id} has invalid coordinates:`, a.lat, a.lng);
        return;
      }

      // Check severity/level depending on schema migration state
      const severity = a.level || a.severity || "Low";

      if (markers[id]) {
        if (severity.toLowerCase() === "critical") critical = true;
        bounds.push([a.lat, a.lng]);
        return;
      }

      // Build marker
      markers[id] = addMarker(
        [a.lat, a.lng],
        severity,
        a,
        id,
        false,
        null,
        () => showNearbyResourcesForAlert({ id, ...a, severity })
      );
      bounds.push([a.lat, a.lng]);
      if (severity.toLowerCase() === "critical") critical = true;

      // Trigger toast and activity for new items (if not first load)
      if (newIds.includes(id) && !isInitialLoad) {
        const isCritical = severity.toLowerCase() === "critical";
        const isHigh = severity.toLowerCase() === "high";
        const dotColor = isCritical ? "red" : isHigh ? "yellow" : "green";

        const alertType = translateAlertType(a.type || "Disaster");
        const severityLabel = translateSeverity(severity);
        const descriptionText = translateDynamicText(a.desc || a.description || "");
        addActivity(`${alertType} ${t("ui.alert", "Alert")} — <b>${severityLabel}</b>`, dotColor);
        showToast(
          `${alertType} ${t("ui.alert", "Alert")}`,
          descriptionText || `${t("ui.severity", "Severity")}: ${severityLabel}`,
          isCritical ? "critical" : isHigh ? "warning" : "info"
        );

        // Collect new alert bounds instead of panning multiple times
        newBounds.push([a.lat, a.lng]);
      }
    });

    previousAlertIds = currentIds;
    latestAlertCount = currentIds.size;

    if (sysStatus) {
      sysStatus.textContent = formatLiveStatus(currentIds.size);
    }

    // Auto-fit map on initial population
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

    // Alarm and critical UI
    if (critical) {
      enableCriticalUI();
      // We can also check if dismissed, but we'll deal with dismiss fully in UI upgrades
    } else {
      disableCriticalUI();
    }
  });
})();

/* ── SUBSCRIBE MODAL CONTROLLER ─────────────────────────
   Controls the Phase-2 subscription modal.
   Exposed on window so the inline HTML onclick handlers
   (openSubscribeModal, closeSubscribeModal, handleSubscribe)
   can reach this module scope.
   ─────────────────────────────────────────────────────── */

const overlay    = document.getElementById("subModalOverlay");
const subBtn     = document.getElementById("subscribeBtn");
const subResult  = document.getElementById("subResult");
const subSubmit  = document.getElementById("subSubmitBtn");

// Mark button as subscribed if already registered
if (isSubscribed()) {
  subBtn?.classList.add("subscribed");
  if (subBtn) subBtn.innerHTML = `✅ ${t("ui.subscribe", "Subscribe")}`;
}

window.openSubscribeModal = () => {
  overlay?.classList.add("open");
  document.getElementById("subWhatsapp")?.focus();
};

window.closeSubscribeModal = () => {
  overlay?.classList.remove("open");
  if (subResult) { subResult.textContent = ""; subResult.className = "sub-result"; }
};

// Close on backdrop click
overlay?.addEventListener("click", e => {
  if (e.target === overlay) window.closeSubscribeModal();
});

// Close on Escape key
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && overlay?.classList.contains("open")) {
    window.closeSubscribeModal();
  }
});

// Cleanup on page unload to prevent memory leaks
window.addEventListener("beforeunload", () => {
  if (typeof unsubscribeAlerts === "function") unsubscribeAlerts();
  if (typeof unsubscribeLanguageChange === "function") unsubscribeLanguageChange();
});

window.handleSubscribe = async () => {
  const rawWhatsappNumber = document.getElementById("subWhatsapp")?.value?.trim() || "";
  const whatsappOptIn = Boolean(document.getElementById("subWhatsappOptIn")?.checked);
  const normalizedWhatsappNumber = normalizePhoneE164(rawWhatsappNumber);

  if (whatsappOptIn && rawWhatsappNumber && !normalizedWhatsappNumber) {
    if (subResult) {
      subResult.textContent = "Enter a valid WhatsApp number in E.164 format (example: +919876543210).";
      subResult.className = "sub-result error";
    }
    return;
  }

  if (subSubmit) { subSubmit.disabled = true; subSubmit.textContent = "⏳ Enabling…"; }
  if (subResult) { subResult.textContent = ""; subResult.className = "sub-result"; }

  const { success, message } = await subscribeUser({
    whatsappNumber: normalizedWhatsappNumber || rawWhatsappNumber,
    whatsappOptIn
  });

  if (subResult) {
    subResult.textContent = message;
    subResult.className   = `sub-result ${success ? "success" : "error"}`;
  }

  if (success) {
    subBtn?.classList.add("subscribed");
    if (subBtn) subBtn.innerHTML = `✅ ${t("ui.subscribe", "Subscribe")}`;
    const activityMessage = (whatsappOptIn && normalizedWhatsappNumber)
      ? "Push and WhatsApp subscription enabled"
      : "Push notifications enabled";
    addActivity(activityMessage, "green");
    // Auto-close after 2.5 seconds on success
    setTimeout(() => window.closeSubscribeModal(), 2500);
  }

  if (subSubmit) { subSubmit.disabled = false; subSubmit.textContent = "Enable Notifications"; }
};
