/* =========================================================
   src/ui/resourcesPanel.js
   Nearby emergency resources side panel UI.
   ========================================================= */

import { fetchNearbyResources } from "../services/resourcesService.js";
import { onLanguageChange, t, translateAlertType } from "../i18n/languageManager.js";

const PANEL_ID = "nearbyResourcesPanel";
let latestRequestToken = 0;
let panelState = { mode: "idle", alertTypeRaw: "Alert", message: "", places: [] };

function iconFor(type) {
  if (type === "hospital") return "🏥";
  if (type === "police") return "🚔";
  if (type === "shelter") return "🏠";
  return "📍";
}

function labelFor(type) {
  if (type === "hospital") return t("ui.nearbyHospital", "Hospital");
  if (type === "police") return t("ui.nearbyPolice", "Police");
  if (type === "shelter") return t("ui.nearbyShelter", "Shelter");
  return t("ui.nearbyResource", "Resource");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function ensurePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (panel) return panel;

  panel = document.createElement("aside");
  panel.id = PANEL_ID;
  panel.className = "nearby-panel";
  panel.innerHTML = `
    <div class="nearby-panel-header">
      <div>
        <h3>${t("ui.nearbyHelp", "Nearby Help")}</h3>
        <p id="nearbyResourcesMeta">${t("ui.nearbySelectPrompt", "Select an alert marker")}</p>
      </div>
      <button class="nearby-close" type="button" aria-label="Close nearby resources panel">x</button>
    </div>
    <div id="nearbyResourcesBody" class="nearby-panel-body">
      <div class="nearby-placeholder">${t("ui.nearbySelectPrompt", "Select an alert marker")}</div>
    </div>
  `;

  document.body.appendChild(panel);

  panel.querySelector(".nearby-close")?.addEventListener("click", () => {
    hideResourcesPanel();
  });

  return panel;
}

function setPanelOpen(open) {
  const panel = ensurePanel();
  panel.classList.toggle("open", Boolean(open));
}

function setBodyHtml(html) {
  const panel = ensurePanel();
  const body = panel.querySelector("#nearbyResourcesBody");
  if (body) body.innerHTML = html;
}

function setMetaText(text) {
  const panel = ensurePanel();
  const meta = panel.querySelector("#nearbyResourcesMeta");
  if (meta) meta.textContent = text;
}

export function hideResourcesPanel() {
  setPanelOpen(false);
}

export function showResourcesPanelLoading(alert) {
  const alertTypeRaw = alert?.type || "Alert";
  const alertType = translateAlertType(alertTypeRaw);
  panelState = { mode: "loading", alertTypeRaw, message: "", places: [] };
  setMetaText(`${alertType} ${t("ui.selected", "selected")}`);
  setBodyHtml(`
    <div class="nearby-state loading">
      <div class="nearby-spinner"></div>
      <span>${t("ui.nearbyLoading", "Loading nearby resources...")}</span>
    </div>
  `);
  setPanelOpen(true);
}

export function showResourcesPanelError(message = "Unable to load nearby resources right now.") {
  panelState = { ...panelState, mode: "error", message, places: [] };
  setBodyHtml(`
    <div class="nearby-state error">
      <strong>${t("ui.nearbyUnavailable", "Service unavailable")}</strong>
      <p>${escapeHtml(message)}</p>
    </div>
  `);
  setPanelOpen(true);
}

export function showResourcesPanelData(places = []) {
  panelState = { ...panelState, mode: "data", places };
  if (!places.length) {
    setBodyHtml(`
      <div class="nearby-state empty">
        <strong>${t("ui.nearbyEmpty", "No resources found")}</strong>
        <p>${t("ui.nearbyEmptyMsg", "Try another alert location or check again shortly.")}</p>
      </div>
    `);
    setPanelOpen(true);
    return;
  }

  const cards = places
    .slice(0, 5)
    .map((place) => {
      const icon = iconFor(place.type);
      const type = labelFor(place.type);
      const name = escapeHtml(place.name);
      const vicinity = escapeHtml(place.vicinity || "Address unavailable");
      const distance = Number(place.distanceKm || 0).toFixed(2);

      return `
        <article class="nearby-card">
          <div class="nearby-icon" aria-hidden="true">${icon}</div>
          <div class="nearby-content">
            <div class="nearby-top-row">
              <strong>${name}</strong>
              <span class="nearby-distance">${distance} km</span>
            </div>
            <div class="nearby-type">${type}</div>
            <div class="nearby-vicinity">${vicinity}</div>
          </div>
        </article>
      `;
    })
    .join("");

  setBodyHtml(cards);
  setPanelOpen(true);
}

function rerenderState() {
  if (panelState.mode === "loading") {
    showResourcesPanelLoading({ type: panelState.alertTypeRaw });
    return;
  }

  if (panelState.mode === "error") {
    showResourcesPanelError(panelState.message || t("ui.nearbyUnavailableMsg", "Unable to load nearby resources right now."));
    return;
  }

  if (panelState.mode === "data") {
    showResourcesPanelData(panelState.places || []);
  }
}

onLanguageChange(() => {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;

  const header = panel.querySelector(".nearby-panel-header h3");
  if (header) header.textContent = t("ui.nearbyHelp", "Nearby Help");

  if (panelState.mode === "idle") {
    setMetaText(t("ui.nearbySelectPrompt", "Select an alert marker"));
  } else {
    setMetaText(`${translateAlertType(panelState.alertTypeRaw || "Alert")} ${t("ui.selected", "selected")}`);
  }

  rerenderState();
});

export async function showNearbyResourcesForAlert(alert = {}) {
  const lat = Number(alert.lat);
  const lng = Number(alert.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return;
  }

  showResourcesPanelLoading(alert);
  const requestToken = ++latestRequestToken;

  const result = await fetchNearbyResources({ lat, lng, radius: 5000 });

  if (requestToken !== latestRequestToken) {
    return;
  }

  if (!result.success) {
    showResourcesPanelError(result.error || "Could not fetch nearby resources.");
    return;
  }

  showResourcesPanelData(result.places || []);
}
