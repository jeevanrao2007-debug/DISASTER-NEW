/* =========================================================
   src/ui/resourcesPanel.js
   Nearby emergency resources side panel UI with free live routing.
   ========================================================= */

import { fetchNearbyResources } from "../services/resourcesService.js";
import { calculateRoute, getGoogleMapsDirectionsUrl } from "../services/routingService.js";
import { drawRoute, clearRoute, getUserLocation, flyToMarker } from "./mapModule.js";
import { showRouteHud, hideRouteHud, setRouteHudCallbacks } from "./routeHud.js";
import { showToast } from "./toastModule.js";
import { onLanguageChange, t, translateAlertType } from "../i18n/languageManager.js";

const PANEL_ID = "nearbyResourcesPanel";
let latestRequestToken = 0;
let panelState = { mode: "idle", alertTypeRaw: "Alert", message: "", places: [] };
let activePlace = null;
let activeMode = "driving";

// Wire callbacks for the floating Route HUD
setRouteHudCallbacks({
  onModeChange: async (newMode, state) => {
    if (state?.destination) {
      activeMode = newMode;
      await navigateToPlace(state.destination, newMode, true);
    }
  },
  onClose: () => {
    clearRoute();
    activePlace = null;
    document.querySelectorAll(".nearby-card.active").forEach((el) => el.classList.remove("active"));
  }
});

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
      <button class="nearby-close" type="button" aria-label="Close nearby resources panel">✕</button>
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

/**
 * Initiates free live routing from user's GPS position to the specified resource facility.
 */
export async function navigateToPlace(place, mode = "driving", keepPanel = false) {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) {
    showToast("Routing Error", "Invalid facility coordinates.", "warning");
    return;
  }

  activePlace = place;
  activeMode = mode;

  // Highlight card in panel
  document.querySelectorAll(".nearby-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.id === place.id);
  });

  showToast("Calculating Route", `Finding ${mode} route to ${place.name}...`, "info");

  try {
    const userCoords = await getUserLocation();

    const routeResult = await calculateRoute({
      originLat: userCoords.lat,
      originLng: userCoords.lng,
      destLat: place.lat,
      destLng: place.lng,
      mode
    });

    drawRoute({
      coordinates: routeResult.coordinates,
      destination: place,
      mode
    });

    showRouteHud({
      destination: place,
      routeResult,
      userCoords
    });

    showToast(
      `Route Ready: ${place.name}`,
      `${routeResult.distanceKm} km · ${routeResult.durationMinutes} min ${mode}`,
      "success"
    );

    // On mobile screens, collapse panel so user can see map clearly
    if (window.innerWidth < 768 && !keepPanel) {
      hideResourcesPanel();
    }
  } catch (err) {
    console.error("[resourcesPanel] Navigation failed:", err);
    showToast(
      "Location Needed",
      "Please allow location access to calculate directions from where you are.",
      "warning"
    );
  }
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
    .slice(0, 6)
    .map((place) => {
      const icon = iconFor(place.type);
      const type = labelFor(place.type);
      const name = escapeHtml(place.name);
      const vicinity = escapeHtml(place.vicinity || "Address unavailable");
      const distance = Number(place.distanceKm || 0).toFixed(2);
      const placeJson = escapeHtml(JSON.stringify(place));

      return `
        <article class="nearby-card" data-id="${escapeHtml(place.id)}" data-place='${placeJson}'>
          <div class="nearby-icon" aria-hidden="true">${icon}</div>
          <div class="nearby-content">
            <div class="nearby-top-row">
              <strong class="nearby-title">${name}</strong>
              <span class="nearby-distance">${distance} km</span>
            </div>
            <div class="nearby-type">${type}</div>
            <div class="nearby-vicinity">${vicinity}</div>

            <div class="nearby-actions">
              <button class="nearby-action-btn primary nearby-route-trigger" title="Show shortest driving path from your location">
                ⚡ Shortest Route
              </button>
              <button class="nearby-action-btn secondary nearby-focus-trigger" title="Center on map">
                📍 Locate
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  setBodyHtml(cards);
  setPanelOpen(true);

  // Attach card event handlers
  const panel = ensurePanel();
  panel.querySelectorAll(".nearby-card").forEach((card) => {
    const rawData = card.getAttribute("data-place");
    if (!rawData) return;
    const place = JSON.parse(rawData);

    // Route trigger
    card.querySelector(".nearby-route-trigger")?.addEventListener("click", (e) => {
      e.stopPropagation();
      navigateToPlace(place, "driving");
    });

    // Locate trigger
    card.querySelector(".nearby-focus-trigger")?.addEventListener("click", (e) => {
      e.stopPropagation();
      flyToMarker([place.lat, place.lng], 15);
    });

    // Whole card click triggers route
    card.addEventListener("click", () => {
      navigateToPlace(place, "driving");
    });
  });
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
