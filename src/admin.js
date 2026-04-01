/* =========================================================
   src/admin.js
   Entry point for the admin dashboard (admin.html).
   ========================================================= */

import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { app } from "./config/firebase.js";
import { initMap, addMarker, removeMarker } from "./ui/mapModule.js";
import { showToast } from "./ui/toastModule.js";
import {
  listenForAlerts, listenForPendingAlerts, publishAlert,
  deleteLiveAlert, approvePendingAlert, rejectPendingAlert,
  resolveAlert
} from "./services/alertService.js";
import { triggerNotification } from "./services/notificationService.js";

const auth = getAuth(app);
let map;
let selected = null;
let previewMarker = null;
let markers = {};

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

/* ── AUTH GUARD ───────────────────────────────────────── */
onAuthStateChanged(auth, user => {
  if (!user) { location = "login.html"; return; }
  document.body.style.display = "block";
  logActivity(`Authenticated as ${user.email || "admin"}`, "green");
  setupInit();
});

window.logout = () => signOut(auth).then(() => location = "login.html");

/* ── ACTIVITY LOG ─────────────────────────────────────── */
function logActivity(text, dotClass = "") {
  if (!adminActivityList) return;
  while (adminActivityList.children.length >= 8) adminActivityList.lastChild.remove();
  const li = document.createElement("li");
  li.className = "activity-item";
  li.innerHTML = `<div class="ai-dot ${dotClass}"></div><span>${text}</span>`;
  adminActivityList.insertBefore(li, adminActivityList.firstChild);
}

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
      pubStatusText.textContent = "Alert published & broadcast sent ✔";
      pubStatusText.style.color = "var(--low)";
    } else {
      publishBtn.textContent = "⚠ Failed";
      publishBtn.style.background = "linear-gradient(135deg,#b91c1c,#7f1d1d)";
    }
    setTimeout(() => {
      publishBtn.disabled = false;
      publishBtn.textContent = "🚨 Publish Alert";
      publishBtn.style.background = "";
      broadcastBar.style.width = "0%";
    }, 2200);
  }, 550);
}

/* ── SETUP ────────────────────────────────────────────── */
function setupInit() {
  map = initMap('map', [13.0827, 80.2707], 11);
  setupMapEvents();
  setupAlertsListener();
  setupPendingListener();
}

function setupMapEvents() {
  map.on("mousemove", e => {
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

/* ── ALERTS LISTENER ──────────────────────────────────── */
function setupAlertsListener() {
  listenForAlerts(data => {
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
        return;
      }

      // Build custom popup with Resolve + Delete buttons and expiry info
      const expiryStr = a.expiresAt
        ? new Date(a.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "N/A";

      const popupContent = `
        <div style="min-width:170px;font-family:'Inter',sans-serif;">
          <b style="font-size:14px">${a.type || "Alert"}</b><br>
          <small style="color:#94a3b8">${severity} · ${a.createdBy || "system"}</small><br>
          <small style="color:#64748b">Expires: ${expiryStr}</small>
          ${a.description || a.desc ? `<br><small style="color:#cbd5e1">${a.description || a.desc}</small>` : ""}
          <br><br>
          <button onclick="window.resolveAlert('${id}')"
            style="margin-right:6px;padding:4px 10px;background:#16a34a;color:#fff;
                   border:none;border-radius:6px;cursor:pointer;font-size:12px">
            ✔ Resolve
          </button>
          <button onclick="window.deleteAlert('${id}')"
            style="padding:4px 10px;background:#dc2626;color:#fff;
                   border:none;border-radius:6px;cursor:pointer;font-size:12px">
            🗑 Delete
          </button>
        </div>`;

      markers[id] = addMarker([a.lat, a.lng], severity, a, id, true, popupContent);
      if (severity.toLowerCase() === "critical") hasCritical = true;
    });

    if (hasCritical) {
      if (alarmInd) alarmInd.classList.add("active");
      if (flash) flash.classList.add("active");
      if (sysStatus) sysStatus.textContent = "⚠ CRITICAL ACTIVE";
    } else {
      if (alarmInd) alarmInd.classList.remove("active");
      if (flash) flash.classList.remove("active");
      if (sysStatus) sysStatus.textContent = "SECURE SESSION";
    }
  });
}

/* ── ALERT ACTIONS ────────────────────────────────────── */
window.resolveAlert = async (id) => {
  if (confirm("Mark this alert as Resolved and remove it?")) {
    await resolveAlert(id);
    logActivity("Alert resolved & removed", "green");
    showToast("Alert Resolved", "Alert has been resolved and removed.", "success");
  }
};

window.deleteAlert = async (id) => {
  if (confirm("Remove alert from database?")) {
    await deleteLiveAlert(id);
    logActivity("Alert deleted", "red");
    showToast("Alert Removed", "Alert deleted from database.", "warning");
  }
};

window.publish = async () => {
  if (!selected) {
    showToast("No Location", "Click on the map to select a location first.", "warning");
    return;
  }

  const typeVal = document.getElementById("type").value;
  const levelVal = document.getElementById("level").value;
  const descVal = document.getElementById("desc").value;

  animateBroadcast(true);

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
    triggerNotification(newAlert);

    if (previewMarker) { previewMarker.remove(); previewMarker = null; }
    selected = null;
    document.getElementById("desc").value = "";
    if (coordsText) coordsText.innerText = "Move mouse over map to pick location";

    logActivity(`${typeVal} (${levelVal}) published`, levelVal === "Critical" ? "red" : "green");
    showToast("Alert Published", `${typeVal} — ${levelVal} broadcast to all users.`, levelVal === "Critical" ? "critical" : "success");

  } catch (e) {
    animateBroadcast(false);
    showToast("Publish Failed", "Database write error — try again.", "warning");
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

function setupPendingListener() {
  listenForPendingAlerts(data => {
    if (!pendingBox || !pendingBadge) return;

    if (!data || Object.keys(data).length === 0) {
      pendingBox.innerHTML = `<div style="font-size:12px;color:var(--text-dim);padding:6px 0;">No pending alerts</div>`;
      pendingBadge.style.display = "none";
      return;
    }

    const entries = Object.entries(data);
    pendingBadge.textContent = entries.length;
    pendingBadge.style.display = "inline-flex";
    pendingBox.innerHTML = "";

    entries.forEach(([id, a]) => {
      const severity = a.level || a.severity || "Low";
      const displaySev = severity.charAt(0).toUpperCase() + severity.slice(1);
      const c = colorHex(severity);

      const card = document.createElement("div");
      card.className = "pending-card";
      card.setAttribute("data-level", displaySev);
      card.id = "pcard-" + id;

      card.innerHTML = `
        <div class="pending-card-title" style="color:${c}">${a.type} <small style="color:var(--text-muted);font-weight:400;">· ${displaySev}</small></div>
        <div class="pending-card-meta">
          ${a.desc || a.description || ""}<br>
          🔎 ${a.source || "Auto-detected"} · ${a.confidence || "--"}% confidence<br>
          🕐 ${a.detectedAt || new Date(a.createdAt).toLocaleString()}
        </div>
        <div class="pending-card-actions">
          <button class="btn-approve" onclick="window.approve('${id}')">✔ Approve</button>
          <button class="btn-reject"  onclick="window.reject('${id}')">✕ Reject</button>
        </div>
      `;
      pendingBox.appendChild(card);
    });
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
    const approvedAlert = await approvePendingAlert(id);
    if (!approvedAlert) return;
    const severity = approvedAlert.level || approvedAlert.severity;
    logActivity(`Approved: ${approvedAlert.type} — ${severity}`, "green");
    showToast("Alert Approved", `${approvedAlert.type} moved to live alerts & broadcast sent.`, "success");
    triggerNotification(approvedAlert);
  }, 460);
};

window.reject = async (id) => {
  const card = document.getElementById("pcard-" + id);
  if (card) {
    card.style.borderColor = "var(--critical)";
    card.classList.add("rejecting");
  }
  setTimeout(async () => {
    await rejectPendingAlert(id);
    logActivity("Alert rejected", "red");
    showToast("Alert Rejected", "Pending alert dismissed.", "warning");
  }, 360);
};