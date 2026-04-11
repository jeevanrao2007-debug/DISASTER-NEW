/* =========================================================
   src/admin.js
   Entry point for the admin dashboard (admin.html).
   ========================================================= */

import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirebaseApp } from "./config/firebase.js";
import { initMap, addMarker, removeMarker, refreshMarkerPopup } from "./ui/mapModule.js";
import { showToast } from "./ui/toastModule.js";
import { showNearbyResourcesForAlert } from "./ui/resourcesPanel.js";
import { createSimulationController } from "./ui/simulationModule.js";
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
import {
  listenForAlerts, listenForPendingAlerts, publishAlert,
  deleteLiveAlert, approvePendingAlert, rejectPendingAlert,
  resolveAlert
} from "./services/alertService.js";
import { triggerNotification } from "./services/notificationService.js";

let auth = null;
let map;
let selected = null;
let previewMarker = null;
let markers = {};
let simulationController = null;

// DOM Elements
const adminActivityList = document.getElementById("adminActivityList");
const coordsText = document.getElementById("coords");
const alarmInd = document.getElementById("alarmIndicator");
const flash = document.getElementById("criticalFlash");
const sysStatus = document.getElementById("sysStatus");
const publishBtn = document.getElementById("publishBtn");
const broadcastBar = document.getElementById("broadcastBar");
const pubStatusText = document.getElementById("status");
const pendingBadge = document.getElementById("pendingCount");
const pendingBox = document.getElementById("pendingBox");
const simulationModeBtn = document.getElementById("simulationModeBtn");
const simulationControls = document.getElementById("simulationControls");
const simDisasterType = document.getElementById("simDisasterType");
const simSeverity = document.getElementById("simSeverity");
const simStopAllBtn = document.getElementById("simStopAllBtn");
const simActiveCount = document.getElementById("simActiveCount");
const simulationModeLabel = document.getElementById("simulationModeLabel");

let isInitialized = false;
let hasCriticalActive = false;
let latestPendingAlerts = {};

// Store unsubscribe functions to prevent memory leaks
let unsubscribeAlerts = null;
let unsubscribePendingAlerts = null;
let unsubscribeLanguageChange = null;

initLanguage();
setupLanguageToggle();
applyDocumentTranslations();

/* ── AUTH GUARD ───────────────────────────────────────── */
(async function initializeAuth() {
  try {
    const app = await getFirebaseApp();
    auth = getAuth(app);
    
    onAuthStateChanged(auth, async user => {
      if (!user) { window.location.href = "login.html"; return; }
      document.body.style.display = "block";
      logActivity(`Authenticated as ${user.email || "admin"}`, "green");
      if (!isInitialized) {
        await setupInit();
        isInitialized = true;
      }
    });
  } catch (err) {
    console.error("Failed to initialize auth:", err);
    window.location.href = "login.html";
  }
})();

window.logout = () => {
  // Clean up Firebase listeners to prevent memory leaks
  if (typeof unsubscribeAlerts === "function") unsubscribeAlerts();
  if (typeof unsubscribePendingAlerts === "function") unsubscribePendingAlerts();
  if (typeof unsubscribeLanguageChange === "function") unsubscribeLanguageChange();
  
  signOut(auth).then(() => window.location.href = "login.html");
};

/* ── ACTIVITY LOG ─────────────────────────────────────── */
function logActivity(text, dotClass = "") {
  if (!adminActivityList) return;
  while (adminActivityList.children.length >= 8) adminActivityList.lastChild.remove();
  const li = document.createElement("li");
  li.className = "activity-item";
  li.innerHTML = `<div class="ai-dot ${dotClass}"></div><span>${text}</span>`;
  adminActivityList.insertBefore(li, adminActivityList.firstChild);
}

function updateSessionStatusText() {
  if (!sysStatus) return;
  sysStatus.textContent = hasCriticalActive
    ? `⚠ ${t("ui.criticalActive", "CRITICAL ACTIVE")}`
    : t("ui.secureSession", "SECURE SESSION");
}

function updateSimulationModeVisuals(enabled) {
  if (!simulationModeBtn || !simulationControls) return;

  simulationModeBtn.classList.toggle("active", enabled);
  simulationControls.classList.toggle("open", enabled);

  if (simulationModeLabel) {
    simulationModeLabel.textContent = enabled
      ? t("ui.simulationModeOn", "Simulation Mode: ON")
      : t("ui.simulationModeOff", "Simulation Mode: OFF");
  }

  if (simActiveCount && simulationController) {
    simActiveCount.textContent = `${t("ui.active", "Active")}: ${simulationController.activeCount()}`;
  }
}

unsubscribeLanguageChange = onLanguageChange(() => {
  applyDocumentTranslations();
  updateSessionStatusText();
  updateSimulationModeVisuals(isSimulationModeActive());
  renderPendingAlerts(latestPendingAlerts);
  Object.values(markers).forEach((marker) => refreshMarkerPopup(marker));
});

/* ── BROADCAST ANIMATION ──────────────────────────────── */
function animateBroadcast(success) {
  if (!publishBtn || !broadcastBar || !pubStatusText) return;

  publishBtn.disabled = true;
  publishBtn.textContent = "Broadcasting...";
  broadcastBar.style.width = "0%";

  requestAnimationFrame(() => { broadcastBar.style.width = "100%"; });

  setTimeout(() => {
    if (success) {
      publishBtn.textContent = "✅ Published!";
      publishBtn.style.background = "linear-gradient(135deg,#16a34a,#15803d)";
      pubStatusText.textContent = `${t("messages.alertPublished", "Alert Published")} ✔`;
      pubStatusText.style.color = "var(--low)";
    } else {
      publishBtn.textContent = "⚠ Failed";
      publishBtn.style.background = "linear-gradient(135deg,#b91c1c,#7f1d1d)";
    }
    setTimeout(() => {
      publishBtn.disabled = false;
      publishBtn.textContent = `🚨 ${t("ui.publishAlert", "Publish Alert")}`;
      publishBtn.style.background = "";
      broadcastBar.style.width = "0%";
    }, 2200);
  }, 550);
}

/* ── SETUP ────────────────────────────────────────────── */
async function setupInit() {
  map = initMap('map', [13.0827, 80.2707], 11);
  simulationController = createSimulationController(map, {
    onCreate: ({ type, severity }) => {
      logActivity(`Simulation placed: ${type} (${severity})`, "yellow");
    },
    onStopAll: () => {
      logActivity("All simulations stopped", "red");
    },
    onCountChange: (count) => {
      if (simActiveCount) simActiveCount.textContent = `${t("ui.active", "Active")}: ${count}`;
    }
  });
  setupSimulationControls();
  updateSimulationModeVisuals(false);
  updateSessionStatusText();
  setupMapEvents();
  await setupAlertsListener();
  await setupPendingListener();
}

function isSimulationModeActive() {
  return Boolean(simulationController?.isEnabled());
}

function setSimulationMode(enabled) {
  if (!simulationController || !simulationModeBtn || !simulationControls) return;

  simulationController.setEnabled(enabled);
  updateSimulationModeVisuals(enabled);

  if (enabled) {
    if (previewMarker) {
      previewMarker.remove();
      previewMarker = null;
    }
    if (coordsText) coordsText.innerText = "Simulation mode active: click map to place simulation";
    showToast("Simulation", t("messages.simulationEnabled", "Simulation mode enabled. Map clicks create local demo effects."), "info");
    logActivity("Simulation mode enabled", "yellow");
    return;
  }

  if (coordsText) coordsText.innerText = "Move mouse over map to pick location";
  showToast("Simulation", t("messages.simulationDisabled", "Simulation mode disabled. Real alert pinning restored."), "success");
  logActivity("Simulation mode disabled", "green");
}

function setupSimulationControls() {
  if (!simulationModeBtn || !simulationControls || !simulationController) return;

  simulationModeBtn.addEventListener("click", () => {
    const next = !isSimulationModeActive();
    setSimulationMode(next);
  });

  simStopAllBtn?.addEventListener("click", () => {
    simulationController.stopAllSimulations();
    showToast("Simulation", t("messages.simulationStopped", "All active simulations have been stopped."), "warning");
  });
}

function setupMapEvents() {
  // BUGFIX: Use single delegated listener on map container instead of attaching 
  // new listeners to each popup (which caused duplicate event handlers).
  const mapContainer = document.getElementById("map");
  if (mapContainer) {
    mapContainer.addEventListener("click", async (evt) => {
      const btn = evt.target.closest("button[data-action]");
      if (!btn) return;

      const action = btn.dataset.action;
      const alertId = btn.dataset.alertId;

      if (action === "resolve") {
        await window.resolveAlert(alertId);
      } else if (action === "delete") {
        await window.deleteAlert(alertId);
      }
    }, true); // Use capture phase to ensure we catch all clicks
  }

  map.on("mousemove", e => {
    if (isSimulationModeActive()) {
      if (coordsText) {
        coordsText.innerText = `SIM ${e.latlng.lat.toFixed(5)} | ${e.latlng.lng.toFixed(5)}`;
      }
      if (previewMarker) {
        previewMarker.remove();
        previewMarker = null;
      }
      return;
    }

    if (coordsText) {
      coordsText.innerText = `Lat ${e.latlng.lat.toFixed(5)} | Lng ${e.latlng.lng.toFixed(5)}`;
    }
    if (!selected) {
      if (!previewMarker) {
        const icon = L.divIcon({
          html: `<div class="preview-marker-icon"><div style="
            width:14px;height:14px;border-radius:50%;
            background:var(--blue);
            border:2px solid rgba(255,255,255,0.4);
            box-shadow:0 0 12px var(--blue-glow);
          "></div></div>`,
          className: "", iconSize: [14, 14], iconAnchor: [7, 7]
        });
        previewMarker = L.marker(e.latlng, { icon, interactive: false }).addTo(map);
      } else {
        previewMarker.setLatLng(e.latlng);
      }
    }
  });

  map.on("click", e => {
    if (isSimulationModeActive()) {
      const type = simDisasterType?.value || "flood";
      const severity = simSeverity?.value || "moderate";

      simulationController.createSimulation({
        latlng: e.latlng,
        type,
        severity
      });

      if (coordsText) {
        coordsText.innerText = `SIM placed at ${e.latlng.lat.toFixed(5)} , ${e.latlng.lng.toFixed(5)}`;
      }
      return;
    }

    selected = e.latlng;
    if (previewMarker) previewMarker.remove();
    const icon = L.divIcon({
      html: `<div style="
        width:18px;height:18px;border-radius:50%;background:#3b82f6;border:3px solid white;
        box-shadow:0 0 16px var(--blue-glow), 0 0 30px rgba(59,130,246,0.3);
        animation:marker-appear .4s cubic-bezier(.34,1.56,.64,1) both;
      "></div>`,
      className: "", iconSize: [18, 18], iconAnchor: [9, 9]
    });
    previewMarker = L.marker(selected, { icon })
      .addTo(map)
      .bindPopup("<b>📍 Location Selected</b><br><small>Click Publish to confirm</small>")
      .openPopup();

    if (coordsText) coordsText.innerText = `📍 ${selected.lat.toFixed(5)} , ${selected.lng.toFixed(5)}`;
    logActivity("Location pinned on map", "");
  });
}

function buildAdminPopupContent(alert, id, severity) {
  const expiryStr = alert.expiresAt
    ? new Date(alert.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "N/A";

  const alertType = translateAlertType(alert.type || "Alert");
  const severityLabel = translateSeverity(severity);
  const descriptionText = translateDynamicText(alert.description || alert.desc || "");

  return `
    <div style="min-width:170px;font-family:'Inter',sans-serif;">
      <b style="font-size:14px">${alertType}</b><br>
      <small style="color:#94a3b8">${severityLabel} · ${alert.createdBy || "system"}</small><br>
      <small style="color:#64748b">Expires: ${expiryStr}</small>
      ${descriptionText ? `<br><small style="color:#cbd5e1">${descriptionText}</small>` : ""}
      <br><br>
      <button data-action="resolve" data-alert-id="${id}"
        style="margin-right:6px;padding:4px 10px;background:#16a34a;color:#fff;
               border:none;border-radius:6px;cursor:pointer;font-size:12px">
        ✔ ${t("ui.resolve", "Resolve")}
      </button>
      <button data-action="delete" data-alert-id="${id}"
        style="padding:4px 10px;background:#dc2626;color:#fff;
               border:none;border-radius:6px;cursor:pointer;font-size:12px">
        🗑 ${t("ui.delete", "Delete")}
      </button>
    </div>`;
}

/* ── ALERTS LISTENER ──────────────────────────────────── */
async function setupAlertsListener() {
  unsubscribeAlerts = await listenForAlerts(data => {
    const currentIds = new Set(Object.keys(data));
    let hasCritical = false;

    // Remove stale markers
    Object.keys(markers).forEach(id => {
      if (!currentIds.has(id)) {
        removeMarker(markers[id]);
        delete markers[id];
      }
    });

    Object.entries(data).forEach(([id, a]) => {
      if (a.lat == null || a.lng == null) return;
      const severity = a.level || a.severity || "Low";

      if (markers[id]) {
        if (severity.toLowerCase() === "critical") hasCritical = true;
        refreshMarkerPopup(markers[id]);
        return;
      }

      markers[id] = addMarker(
        [a.lat, a.lng],
        severity,
        a,
        id,
        true,
        () => buildAdminPopupContent(a, id, severity),
        () => showNearbyResourcesForAlert({ id, ...a, severity })
      );
      if (severity.toLowerCase() === "critical") hasCritical = true;
    });

    hasCriticalActive = hasCritical;
    updateSessionStatusText();

    if (hasCritical) {
      if (alarmInd) alarmInd.classList.add("active");
      if (flash) flash.classList.add("active");
    } else {
      if (alarmInd) alarmInd.classList.remove("active");
      if (flash) flash.classList.remove("active");
    }
  });
}

/* ── ALERT ACTIONS ────────────────────────────────────── */
window.resolveAlert = async (id) => {
  if (confirm("Mark this alert as Resolved and remove it?")) {
    await resolveAlert(id);
    logActivity("Alert resolved & removed", "green");
    showToast(
      t("messages.alertResolved", "Alert Resolved"),
      t("messages.alertResolvedDesc", "Alert has been resolved and removed."),
      "success"
    );
  }
};

window.deleteAlert = async (id) => {
  if (confirm("Remove alert from database?")) {
    await deleteLiveAlert(id);
    logActivity("Alert deleted", "red");
    showToast(
      t("messages.alertRemoved", "Alert Removed"),
      t("messages.alertRemovedDesc", "Alert deleted from database."),
      "warning"
    );
  }
};

window.publish = async () => {
  if (!selected) {
    showToast(
      t("messages.noLocation", "No Location"),
      t("messages.clickMapFirst", "Click on the map to select a location first."),
      "warning"
    );
    return;
  }

  const typeVal = document.getElementById("type").value;
  const levelVal = document.getElementById("level").value;
  const descVal = document.getElementById("desc").value;

  try {
    const newAlert = {
      type: typeVal,
      severity: levelVal.toLowerCase(),
      level: levelVal,
      description: descVal,
      desc: descVal,
      lat: selected.lat,
      lng: selected.lng,
      time: new Date().toLocaleString(),
      manual: true,
      createdBy: auth.currentUser?.email || "admin"
    };

    await publishAlert(newAlert);
    await triggerNotification(newAlert);

    // Only animate success after both publish and notification dispatch complete
    animateBroadcast(true);

    if (previewMarker) { previewMarker.remove(); previewMarker = null; }
    selected = null;
    document.getElementById("desc").value = "";
    if (coordsText) coordsText.innerText = "Move mouse over map to pick location";

    const translatedType = translateAlertType(typeVal);
    const translatedSeverity = translateSeverity(levelVal);
    logActivity(`${translatedType} (${translatedSeverity}) published`, levelVal === "Critical" ? "red" : "green");
    showToast(
      t("messages.alertPublished", "Alert Published"),
      `${translatedType} — ${translatedSeverity} broadcast to all users.`,
      levelVal === "Critical" ? "critical" : "success"
    );

  } catch (e) {
    animateBroadcast(false);
    console.error("[admin.publish] Error:", e);
    showToast(
      t("messages.publishFailed", "Publish Failed"),
      t("messages.dbWriteError", "Database write error — try again."),
      "warning"
    );
  }
};

/* ── PENDING SYSTEM ───────────────────────────────────── */
function colorHex(sev) {
  const s = sev ? sev.toLowerCase() : "low";
  if (s === "low") return "var(--low)";
  if (s === "moderate") return "var(--moderate)";
  if (s === "high") return "var(--high)";
  if (s === "critical") return "var(--critical)";
  return "var(--blue)";
}

async function setupPendingListener() {
  unsubscribePendingAlerts = await listenForPendingAlerts(data => {
    latestPendingAlerts = data || {};
    renderPendingAlerts(latestPendingAlerts);
  });
}

function renderPendingAlerts(data) {
  if (!pendingBox || !pendingBadge) return;

  if (!data || Object.keys(data).length === 0) {
    pendingBox.innerHTML = `<div style="font-size:12px;color:var(--text-dim);padding:6px 0;">${t("ui.noPendingAlerts", "No pending alerts")}</div>`;
    pendingBadge.style.display = "none";
    return;
  }

  const entries = Object.entries(data);
  pendingBadge.textContent = entries.length;
  pendingBadge.style.display = "inline-flex";
  pendingBox.innerHTML = "";

  entries.forEach(([id, a]) => {
    const severity = a.level || a.severity || "Low";
    const displaySev = translateSeverity(severity);
    const severityToken = String(severity);
    const severityCssLevel = severityToken.charAt(0).toUpperCase() + severityToken.slice(1).toLowerCase();
    const c = colorHex(severity);

    const card = document.createElement("div");
    card.className = "pending-card";
    card.setAttribute("data-level", severityCssLevel);
    card.id = "pcard-" + id;

    card.innerHTML = `
      <div class="pending-card-title" style="color:${c}">${translateAlertType(a.type)} <small style="color:var(--text-muted);font-weight:400;">· ${displaySev}</small></div>
      <div class="pending-card-meta">
        ${translateDynamicText(a.desc || a.description || "")}<br>
        🔎 ${a.source || t("ui.autoDetected", "Auto-Detected")} · ${a.confidence || "--"}% confidence<br>
        🕐 ${a.detectedAt || new Date(a.createdAt).toLocaleString()}
      </div>
      <div class="pending-card-actions">
        <button class="btn-approve" onclick="window.approve('${id}')">✔ ${t("ui.approve", "Approve")}</button>
        <button class="btn-reject"  onclick="window.reject('${id}')">✕ ${t("ui.reject", "Reject")}</button>
      </div>
    `;
    pendingBox.appendChild(card);
  });
}

window.approve = async (id) => {
  const card = document.getElementById("pcard-" + id);
  if (card) {
    card.style.borderColor = "var(--low)";
    card.style.boxShadow = "0 0 12px var(--low-glow)";
    card.classList.add("approving");
  }
  setTimeout(async () => {
    try {
      const approvedAlert = await approvePendingAlert(id);
      if (!approvedAlert) {
        showToast(
          t("messages.approvalFailed", "Approval Failed"),
          t("messages.alertNotFoundPending", "Alert not found in pending list."),
          "warning"
        );
        return;
      }
      const severity = approvedAlert.level || approvedAlert.severity;
      logActivity(`Approved: ${translateAlertType(approvedAlert.type)} — ${translateSeverity(severity)}`, "green");
      showToast(
        t("messages.alertApproved", "Alert Approved"),
        `${translateAlertType(approvedAlert.type)} moved to live alerts & broadcast sent.`,
        "success"
      );
      await triggerNotification(approvedAlert);
    } catch (err) {
      console.error("[admin.approve] Error:", err);
      showToast("Approval Error", "Failed to approve alert. Check console.", "warning");
    }
  }, 460);
};

window.reject = async (id) => {
  const card = document.getElementById("pcard-" + id);
  if (card) {
    card.style.borderColor = "var(--critical)";
    card.classList.add("rejecting");
  }
  setTimeout(async () => {
    try {
      await rejectPendingAlert(id);
      logActivity("Alert rejected", "red");
      showToast(
        t("messages.alertRejected", "Alert Rejected"),
        t("messages.pendingDismissed", "Pending alert dismissed."),
        "warning"
      );
    } catch (err) {
      console.error("[admin.reject] Error:", err);
      showToast("Rejection Error", "Failed to reject alert. Check console.", "warning");
    }
  }, 360);
};