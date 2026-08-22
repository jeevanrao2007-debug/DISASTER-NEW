/**
 * Floating Navigation Route HUD
 * Displays live navigation details, ETA, distance, and 1-tap external directions.
 */

import { getGoogleMapsDirectionsUrl } from "../services/routingService.js";

const HUD_ID = "emergencyRouteHud";
let currentRouteState = null;
let onModeChangeCallback = null;
let onCloseCallback = null;

function iconFor(type) {
  if (type === "hospital") return "🏥";
  if (type === "police") return "🚔";
  if (type === "shelter") return "🏠";
  return "📍";
}

function ensureHud() {
  let hud = document.getElementById(HUD_ID);
  if (hud) return hud;

  hud = document.createElement("div");
  hud.id = HUD_ID;
  hud.className = "route-hud";
  document.body.appendChild(hud);
  return hud;
}

export function setRouteHudCallbacks({ onModeChange, onClose }) {
  onModeChangeCallback = onModeChange;
  onCloseCallback = onClose;
}

export function showRouteHud({
  destination,
  routeResult,
  userCoords
}) {
  const hud = ensureHud();
  currentRouteState = { destination, routeResult, userCoords };

  const icon = iconFor(destination.type);
  const name = destination.name || "Emergency Resource";
  const vicinity = destination.vicinity || "";
  const distance = routeResult.distanceKm;
  const duration = routeResult.durationMinutes;
  const mode = routeResult.mode || "driving";

  const googleMapsUrl = getGoogleMapsDirectionsUrl(
    userCoords.lat,
    userCoords.lng,
    destination.lat,
    destination.lng
  );

  hud.innerHTML = `
    <div class="route-hud-card">
      <div class="route-hud-main">
        <div class="route-hud-icon">${icon}</div>
        <div class="route-hud-info">
          <div class="route-hud-dest-row">
            <h4 class="route-hud-name" title="${name}">${name}</h4>
            <span class="route-hud-badge ${mode}">${distance} km &middot; ${duration} min</span>
          </div>
          <div class="route-hud-address">${vicinity}</div>
        </div>
      </div>

      <div class="route-hud-actions">
        <div class="route-hud-mode-group">
          <button class="route-mode-btn ${mode === 'driving' ? 'active' : ''}" data-mode="driving" title="Driving Route">
            🚗 Drive
          </button>
          <button class="route-mode-btn ${mode === 'walking' ? 'active' : ''}" data-mode="walking" title="Walking Route">
            🚶 Walk
          </button>
        </div>

        <a href="${googleMapsUrl}" target="_blank" rel="noopener noreferrer" class="route-nav-btn" title="Open Google Maps App">
          ↗ Google Maps
        </a>

        <button class="route-hud-close" id="routeHudCloseBtn" aria-label="Clear Route" title="Clear Route">
          ✕
        </button>
      </div>
    </div>
  `;

  // Attach event listeners
  hud.querySelectorAll(".route-mode-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const selectedMode = e.currentTarget.dataset.mode;
      if (selectedMode && selectedMode !== mode && onModeChangeCallback) {
        onModeChangeCallback(selectedMode, currentRouteState);
      }
    });
  });

  hud.querySelector("#routeHudCloseBtn")?.addEventListener("click", () => {
    hideRouteHud();
    if (onCloseCallback) {
      onCloseCallback();
    }
  });

  hud.classList.add("visible");
}

export function hideRouteHud() {
  const hud = document.getElementById(HUD_ID);
  if (hud) {
    hud.classList.remove("visible");
  }
  currentRouteState = null;
}
