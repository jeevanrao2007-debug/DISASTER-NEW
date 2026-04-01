/* =========================================================
   src/ui/mapModule.js
   Handles Leaflet map initialization, severity colors, and
   animated marker creation.
   ========================================================= */

function color(severity) {
  if (severity === "low") return "#22c55e";
  if (severity === "moderate") return "#facc15";
  if (severity === "high") return "#fb923c";
  if (severity === "critical") return "#ef4444";
  return "#60a5fa";
}

let mapInstance;

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
 * @param {Array}   latlng       - [lat, lng]
 * @param {string}  severity     - "low" | "moderate" | "high" | "critical"
 * @param {Object}  data         - Alert payload for popup
 * @param {string}  id           - Alert ID
 * @param {boolean} isAdmin      - Show admin controls in default popup
 * @param {string|null} customPopup - If provided, overrides the default popup HTML
 */
export function addMarker(latlng, severity, data, id, isAdmin = false, customPopup = null) {
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
  const displaySev = sev.charAt(0).toUpperCase() + sev.slice(1);

  let popupHtml;

  if (customPopup) {
    popupHtml = customPopup;
  } else {
    popupHtml = `
      <div style="min-width:180px;font-family:'Inter',sans-serif;">
        <b style="font-size:15px;color:${c}">${data.type || 'Alert'}</b><br>
        Severity: <b style="color:${c}">${displaySev}</b><br>
        ${data.description || data.desc ? `Info: ${data.description || data.desc}<br>` : ""}
        <small style="color:#64748b">${
          typeof data.createdAt === "number"
            ? new Date(data.createdAt).toLocaleString()
            : data.createdAt || data.time || data.detectedAt || ""
        }</small>
    `;
    if (isAdmin) {
      popupHtml += `<br><br><button onclick="window.deleteAlert('${id}')">🗑 Remove Alert</button>`;
    }
    popupHtml += `</div>`;
  }

  m.bindPopup(popupHtml);
  return m;
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