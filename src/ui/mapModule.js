/* =========================================================
   src/ui/mapModule.js
   Handles Leaflet map initialization, severity colors,
   animated markers, user GPS location, and free route rendering.
   ========================================================= */

import { t, translateAlertType, translateSeverity, translateDynamicText } from "../i18n/languageManager.js";

function color(severity) {
  if (severity === "low") return "#22c55e";
  if (severity === "moderate") return "#facc15";
  if (severity === "high") return "#fb923c";
  if (severity === "critical") return "#ef4444";
  return "#60a5fa";
}

let mapInstance;
let userMarker = null;
let destinationMarker = null;
let activeRouteGlowLayer = null;
let activeRouteMainLayer = null;
let lastKnownUserLocation = null;

function formatTime(data = {}) {
  return typeof data.createdAt === "number"
    ? new Date(data.createdAt).toLocaleString()
    : data.createdAt || data.time || data.detectedAt || "";
}

function buildDefaultPopup({ data, id, isAdmin, sev, colorHex }) {
  const infoText = translateDynamicText(data.description || data.desc || "");

  let popupHtml = `
    <div style="min-width:180px;font-family:'Inter',sans-serif;">
      <b style="font-size:15px;color:${colorHex}">${translateAlertType(data.type || "Alert")}</b><br>
      ${t("ui.severity", "Severity")}: <b style="color:${colorHex}">${translateSeverity(sev)}</b><br>
      ${infoText ? `${t("ui.info", "Info")}: ${infoText}<br>` : ""}
      <small style="color:#64748b">${formatTime(data)}</small>
  `;

  // AI Advisor button — available for all users
  const aiData = JSON.stringify({
    type: data.type || "Disaster",
    severity: sev,
    desc: data.desc || data.description || "",
    lat: data.lat,
    lng: data.lng
  }).replace(/"/g, "&quot;");

  popupHtml += `<br><button class="popup-ai-btn" onclick='window._aiRequestAdvice && window._aiRequestAdvice(JSON.parse(this.dataset.alert))' data-alert="${aiData}">✦ Ask AI Safety Advisor</button>`;

  if (isAdmin) {
    popupHtml += `<br><button data-action="delete" data-alert-id="${id}" style="padding:4px 10px;background:#dc2626;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;margin-top:6px;">🗑 Remove Alert</button>`;
  }

  popupHtml += "</div>";
  return popupHtml;
}

export function initMap(containerId = "map", center = [13.0827, 80.2707], zoom = 12) {
  mapInstance = L.map(containerId, { zoomControl: true }).setView(center, zoom);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: "© OpenStreetMap Contributors"
  }).addTo(mapInstance);

  setTimeout(() => mapInstance.invalidateSize(), 300);
  return mapInstance;
}

export function getMap() {
  return mapInstance;
}

/**
 * Creates and updates the human-like figure pointer for the user's current position.
 */
export function setUserLocationMarker(lat, lng) {
  if (!mapInstance) return null;
  lastKnownUserLocation = { lat: Number(lat), lng: Number(lng) };

  const html = `
    <div class="human-pointer-marker" title="Your Live Location">
      <div class="human-radar-pulse"></div>
      <div class="human-radar-pulse-2"></div>
      <div class="human-figure-wrapper">
        <div class="human-you-tag">YOU</div>
        <div class="human-figure-avatar">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
            <!-- Humanoid Head -->
            <circle cx="12" cy="5" r="3" fill="#38bdf8" stroke="#ffffff" stroke-width="1.5" />
            <!-- Humanoid Torso & Arms -->
            <path d="M7 21v-5a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v5" fill="#0284c7" stroke="#38bdf8" stroke-width="2" />
            <!-- Humanoid Legs -->
            <path d="M10 16v5M14 16v5" stroke="#ffffff" stroke-width="2" stroke-linecap="round" />
          </svg>
        </div>
        <div class="human-ground-pin"></div>
      </div>
    </div>
  `;

  const icon = L.divIcon({
    html,
    className: "human-gps-icon-wrapper",
    iconSize: [44, 56],
    iconAnchor: [22, 54],
    popupAnchor: [0, -52]
  });

  if (userMarker) {
    userMarker.setLatLng([lat, lng]);
  } else {
    userMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 }).addTo(mapInstance);
    userMarker.bindPopup(`
      <div style="font-family:'Inter',sans-serif;text-align:center;padding:6px 8px;min-width:130px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#38bdf8;text-transform:uppercase;margin-bottom:2px;">
          🧍 YOU ARE HERE
        </div>
        <div style="font-size:12px;font-weight:600;color:#f8fafc;">
          Current Location
        </div>
        <span style="font-size:10.5px;color:#94a3b8;font-family:'JetBrains Mono',monospace;">
          ${lat.toFixed(4)}, ${lng.toFixed(4)}
        </span>
      </div>
    `);
  }

  return userMarker;
}

/**
 * Returns the cached or current GPS location of the user.
 */
export function getUserLocation() {
  return new Promise((resolve, reject) => {
    if (lastKnownUserLocation) {
      resolve(lastKnownUserLocation);
      return;
    }

    if (!("geolocation" in navigator)) {
      reject(new Error("Geolocation not supported"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocationMarker(coords.lat, coords.lng);
        resolve(coords);
      },
      (err) => {
        reject(err);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}

/**
 * Centers and zooms map onto user's location.
 */
export async function locateUserAndCenter() {
  try {
    const coords = await getUserLocation();
    if (coords && mapInstance) {
      mapInstance.flyTo([coords.lat, coords.lng], 14, { animate: true, duration: 1.2 });
      if (userMarker) {
        userMarker.openPopup();
      }
      return coords;
    }
  } catch (e) {
    console.warn("[mapModule] Could not locate user:", e.message);
    throw e;
  }
}

/**
 * Draws a high-visibility route polyline on the Leaflet map from origin to destination.
 */
export function drawRoute({ coordinates, destination, mode = "driving" }) {
  if (!mapInstance || !Array.isArray(coordinates) || coordinates.length < 2) return;

  clearRoute();

  const isWalking = mode === "walking";
  const glowColor = isWalking ? "#10b981" : "#38bdf8";
  const mainColor = isWalking ? "#34d399" : "#0284c7";

  // Base wider glowing polyline
  activeRouteGlowLayer = L.polyline(coordinates, {
    color: glowColor,
    weight: 8,
    opacity: 0.45,
    lineCap: "round",
    lineJoin: "round",
    className: "route-poly-glow"
  }).addTo(mapInstance);

  // Core sharp polyline
  activeRouteMainLayer = L.polyline(coordinates, {
    color: mainColor,
    weight: 4.5,
    opacity: 0.95,
    dashArray: isWalking ? "6, 8" : undefined,
    lineCap: "round",
    lineJoin: "round",
    className: "route-poly-main"
  }).addTo(mapInstance);

  // Add destination marker with icon
  if (destination && Number.isFinite(destination.lat) && Number.isFinite(destination.lng)) {
    const typeIcon = destination.type === "hospital" ? "🏥" : destination.type === "police" ? "🚔" : "🏠";
    const destHtml = `
      <div class="dest-route-pin" title="${destination.name || 'Destination'}">
        <div class="dest-route-icon">${typeIcon}</div>
      </div>
    `;

    const destDivIcon = L.divIcon({
      html: destHtml,
      className: "dest-pin-wrapper",
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      popupAnchor: [0, -36]
    });

    destinationMarker = L.marker([destination.lat, destination.lng], {
      icon: destDivIcon,
      zIndexOffset: 990
    }).addTo(mapInstance);

    destinationMarker.bindPopup(`
      <div style="font-family:'Inter',sans-serif;min-width:140px;">
        <b style="color:#38bdf8;">${destination.name || 'Emergency Resource'}</b><br>
        <span style="font-size:11px;color:#94a3b8;">${destination.vicinity || ''}</span>
      </div>
    `);
  }

  // Smoothly fit map bounds to display the whole route
  const bounds = L.latLngBounds(coordinates);
  mapInstance.fitBounds(bounds, {
    paddingTopLeft: [50, 50],
    paddingBottomRight: [50, 180], // extra bottom padding for floating route HUD
    maxZoom: 16
  });
}

/**
 * Removes active navigation route lines and destination pin from the map.
 */
export function clearRoute() {
  if (activeRouteGlowLayer && mapInstance) {
    mapInstance.removeLayer(activeRouteGlowLayer);
    activeRouteGlowLayer = null;
  }
  if (activeRouteMainLayer && mapInstance) {
    mapInstance.removeLayer(activeRouteMainLayer);
    activeRouteMainLayer = null;
  }
  if (destinationMarker && mapInstance) {
    mapInstance.removeLayer(destinationMarker);
    destinationMarker = null;
  }
}

/**
 * @param {Array}   latlng       - [lat, lng]
 * @param {string}  severity     - "low" | "moderate" | "high" | "critical"
 * @param {Object}  data         - Alert payload for popup
 * @param {string}  id           - Alert ID
 * @param {boolean} isAdmin      - Show admin controls in default popup
 * @param {string|null} customPopup - If provided, overrides the default popup HTML
 * @param {Function|null} onMarkerSelect - Optional callback triggered on marker click
 */
export function addMarker(
  latlng,
  severity,
  data,
  id,
  isAdmin = false,
  customPopup = null,
  onMarkerSelect = null
) {
  if (!mapInstance) throw new Error("Map not initialized. Call initMap first.");

  const sev = severity ? severity.toLowerCase() : "low";
  const c = color(sev);

  let ringAnim = "";
  if (sev === "low") ringAnim = "animation:pulse-low 2.4s ease-in-out infinite;";
  else if (sev === "moderate") ringAnim = "animation:ring-moderate 1.8s ease-out infinite;";
  else if (sev === "high") ringAnim = "animation:ripple-high 1.4s ease-out infinite;";
  else if (sev === "critical") ringAnim = "animation:radar-critical 1s ease-out infinite;";

  let ring2 = "";
  if (sev === "high" || sev === "critical") {
    const delay = sev === "critical" ? "animation-delay:.4s;" : "animation-delay:.35s;";
    ring2 = `<div style="
      position:absolute;top:50%;left:50%;
      width:26px;height:26px;
      border-radius:50%;
      border:2px solid ${c};
      transform:translate(-50%,-50%);
      ${ringAnim}${delay}
      box-shadow:0 0 12px ${c}66;
    "></div>`;
  }

  const html = `
    <div style="position:relative;width:26px;height:26px;animation:marker-appear .5s cubic-bezier(.34,1.56,.64,1) both;">
      <div style="
        position:absolute;top:50%;left:50%;
        width:26px;height:26px;
        border-radius:50%;
        border:2px solid ${c};
        transform:translate(-50%,-50%);
        ${ringAnim}
        box-shadow:0 0 14px ${c}55;
      "></div>
      ${ring2}
      <div style="
        position:absolute;top:50%;left:50%;
        width:12px;height:12px;
        border-radius:50%;
        background:${c};
        transform:translate(-50%,-50%);
        box-shadow:0 0 10px ${c}, 0 0 20px ${c}88;
        border:2px solid rgba(255,255,255,0.3);
      "></div>
    </div>
  `;

  const icon = L.divIcon({
    html,
    className: "",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -16]
  });

  const m = L.marker(latlng, { icon }).addTo(mapInstance);

  const popupResolver = typeof customPopup === "function"
    ? customPopup
    : () => (customPopup || buildDefaultPopup({ data, id, isAdmin, sev, colorHex: c }));

  m.__popupResolver = popupResolver;
  m.bindPopup(popupResolver());

  if (typeof onMarkerSelect === "function") {
    m.on("click", () => {
      try {
        onMarkerSelect({
          id,
          data,
          latlng,
          severity: sev,
          marker: m
        });
      } catch (err) {
        console.warn("[mapModule] Marker select callback failed:", err);
      }
    });
  }

  return m;
}

export function refreshMarkerPopup(marker) {
  if (!marker || typeof marker.__popupResolver !== "function") return;
  marker.setPopupContent(marker.__popupResolver());
}

export function removeMarker(marker) {
  if (!mapInstance || !marker) return;
  const el = marker.getElement();
  if (el) {
    el.style.transition = "opacity .5s, transform .5s";
    el.style.opacity = "0";
    el.style.transform = "scale(0)";
    setTimeout(() => mapInstance.removeLayer(marker), 510);
  } else {
    mapInstance.removeLayer(marker);
  }
}

export function flyToMarker(latlng, zoom = 13, duration = 1.2) {
  if (!mapInstance) return;
  mapInstance.flyTo(latlng, zoom, { animate: true, duration });
}

export function fitMapBounds(boundsParams, padding = [60, 60]) {
  if (!mapInstance || boundsParams.length === 0) return;
  mapInstance.fitBounds(boundsParams, { padding });
}