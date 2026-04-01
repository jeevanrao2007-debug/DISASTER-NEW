/* =========================================================
   src/index.js
   Entry point for the public dashboard (index.html).
   Ties together the map, live alerts, and UI modules.
   ========================================================= */

import { initMap, addMarker, removeMarker, flyToMarker, fitMapBounds } from "./ui/mapModule.js";
import { setupAudioUnlock, enableCriticalUI, disableCriticalUI } from "./ui/alarmModule.js";
import { showToast } from "./ui/toastModule.js";
import { addActivity } from "./ui/activityModule.js";
import { listenForAlerts } from "./services/alertService.js";
import { subscribeUser, isSubscribed } from "./services/notificationService.js";

// DOM Elements
const sysStatus = document.getElementById("sysStatus");
const heartbeatDot = document.getElementById("heartbeatDot");

// Initialize Map
initMap('map', [13.0827, 80.2707], 12);

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

// Listen to Live Alerts
listenForAlerts((data) => {
  bumpHeartbeat();

  const bounds = [];
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
    if (a.lat == null || a.lng == null) return;
    
    // Check severity/level depending on schema migration state
    const severity = a.level || a.severity || "Low";

    if (markers[id]) {
      if (severity.toLowerCase() === "critical") critical = true;
      bounds.push([a.lat, a.lng]);
      return;
    }

    // Build marker
    markers[id] = addMarker([a.lat, a.lng], severity, a, id, false);
    bounds.push([a.lat, a.lng]);
    if (severity.toLowerCase() === "critical") critical = true;

    // Trigger toast and activity for new items (if not first load)
    if (newIds.includes(id) && !isInitialLoad) {
      const isCritical = severity.toLowerCase() === "critical";
      const isHigh = severity.toLowerCase() === "high";
      const dotColor = isCritical ? "red" : isHigh ? "yellow" : "green";
      
      addActivity(`${a.type} alert — <b>${severity}</b>`, dotColor);
      showToast(
        `${a.type} Alert`, 
        a.desc || a.description || `Severity: ${severity}`, 
        isCritical ? "critical" : isHigh ? "warning" : "info"
      );

      // Pan to new alert
      flyToMarker([a.lat, a.lng], 13, 1.2);
    }
  });

  previousAlertIds = currentIds;

  if (sysStatus) {
    sysStatus.textContent = `LIVE · ${currentIds.size} ALERT${currentIds.size !== 1 ? "S" : ""}`;
  }

  // Auto-fit map on initial population
  if (isInitialLoad && bounds.length > 0) {
    fitMapBounds(bounds, [60, 60]);
    isInitialLoad = false;
  }

  // Alarm and critical UI
  if (critical) {
    enableCriticalUI();
    // We can also check if dismissed, but we'll deal with dismiss fully in UI upgrades
  } else {
    disableCriticalUI();
  }
});

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
  if (subBtn) subBtn.textContent = "✅ Subscribed";
}

window.openSubscribeModal = () => {
  overlay?.classList.add("open");
  document.getElementById("subEmail")?.focus();
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

window.handleSubscribe = async () => {
  const email = document.getElementById("subEmail")?.value?.trim() || "";

  if (subSubmit) { subSubmit.disabled = true; subSubmit.textContent = "⏳ Enabling…"; }
  if (subResult) { subResult.textContent = ""; subResult.className = "sub-result"; }

  const { success, message } = await subscribeUser(email);

  if (subResult) {
    subResult.textContent = message;
    subResult.className   = `sub-result ${success ? "success" : "error"}`;
  }

  if (success) {
    subBtn?.classList.add("subscribed");
    if (subBtn) subBtn.textContent = "✅ Subscribed";
    addActivity("Push notifications enabled", "green");
    // Auto-close after 2.5 seconds on success
    setTimeout(() => window.closeSubscribeModal(), 2500);
  }

  if (subSubmit) { subSubmit.disabled = false; subSubmit.textContent = "Enable Notifications"; }
};
