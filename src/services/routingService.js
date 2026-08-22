/**
 * Free Open-Source Routing Service (OSRM)
 * Generates turn-by-turn road routes, distance (km), and travel duration (min)
 * 100% free with zero API keys or costs.
 */

import { haversineKm } from "../../helpers/geo.js";

// Public OSRM endpoints (free and open-source)
const OSRM_DRIVING_ENDPOINT = "https://router.project-osrm.org/route/v1/driving";
const OSRM_WALKING_ENDPOINT = "https://router.project-osrm.org/route/v1/walking";

/**
 * Calculates a route from origin to destination.
 * @param {Object} params
 * @param {number} params.originLat
 * @param {number} params.originLng
 * @param {number} params.destLat
 * @param {number} params.destLng
 * @param {'driving'|'walking'} [params.mode='driving']
 * @returns {Promise<Object>}
 */
export async function calculateRoute({
  originLat,
  originLng,
  destLat,
  destLng,
  mode = "driving"
}) {
  const oLat = Number(originLat);
  const oLng = Number(originLng);
  const dLat = Number(destLat);
  const dLng = Number(destLng);

  if (!Number.isFinite(oLat) || !Number.isFinite(oLng) || !Number.isFinite(dLat) || !Number.isFinite(dLng)) {
    throw new Error("Invalid start or destination coordinates.");
  }

  const endpoint = mode === "walking" ? OSRM_WALKING_ENDPOINT : OSRM_DRIVING_ENDPOINT;
  const url = `${endpoint}/${oLng},${oLat};${dLng},${dLat}?overview=full&geometries=geojson&steps=true`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Routing server responded with status: ${response.status}`);
    }

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      throw new Error("No route found between these locations.");
    }

    const primaryRoute = data.routes[0];
    const distanceKm = Number((primaryRoute.distance / 1000).toFixed(2));
    const durationMinutes = Math.max(1, Math.round(primaryRoute.duration / 60));

    // Coordinates in OSRM GeoJSON are [lng, lat] -> convert to Leaflet [lat, lng]
    const latLngCoordinates = (primaryRoute.geometry?.coordinates || []).map(([lng, lat]) => [lat, lng]);

    return {
      success: true,
      mode,
      distanceKm,
      durationMinutes,
      coordinates: latLngCoordinates,
      summary: primaryRoute.legs?.[0]?.summary || "",
      isStraightLineFallback: false
    };
  } catch (err) {
    console.warn("[routingService] OSRM query failed or timed out, falling back to direct path:", err.message);

    // Fallback: calculate straight-line geodesic distance and approximate driving time (assuming 35 km/h avg)
    const directKm = Number(haversineKm(oLat, oLng, dLat, dLng).toFixed(2));
    const estMinutes = mode === "walking"
      ? Math.max(1, Math.round((directKm / 4.5) * 60))
      : Math.max(1, Math.round((directKm / 35) * 60));

    return {
      success: true,
      mode,
      distanceKm: directKm,
      durationMinutes: estMinutes,
      coordinates: [
        [oLat, oLng],
        [dLat, dLng]
      ],
      summary: "Direct distance (estimate)",
      isStraightLineFallback: true
    };
  }
}

/**
 * Generates a deep link to Google Maps for hands-free turn-by-turn navigation.
 */
export function getGoogleMapsDirectionsUrl(originLat, originLng, destLat, destLng) {
  return `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${destLat},${destLng}&travelmode=driving`;
}
