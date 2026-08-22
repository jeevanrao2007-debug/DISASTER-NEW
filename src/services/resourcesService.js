const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map();

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cacheKey(lat, lng, radius) {
  return `${lat.toFixed(3)}:${lng.toFixed(3)}:${radius}`;
}

function getNearbyResourcesUrl() {
  const url = globalThis?.DISASTER_ALERT_FUNCTIONS?.nearbyResources;
  if (!url) {
    throw new Error("Nearby resources function URL is not configured");
  }

  return url;
}

export async function fetchNearbyResources({ lat, lng, radius = 5000 } = {}) {
  const parsedLat = toNumber(lat);
  const parsedLng = toNumber(lng);
  const parsedRadius = toNumber(radius) || 5000;

  if (parsedLat == null || parsedLng == null) {
    return {
      success: false,
      places: [],
      error: "Invalid coordinates"
    };
  }

  const key = cacheKey(parsedLat, parsedLng, parsedRadius);
  const cached = cache.get(key);

  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return {
      success: true,
      places: cached.places,
      cached: true
    };
  }

  try {
    const response = await fetch(getNearbyResourcesUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lat: parsedLat,
        lng: parsedLng,
        radius: parsedRadius
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success) {
      return {
        success: false,
        places: [],
        error: data.error || "Nearby resources unavailable"
      };
    }

    const places = Array.isArray(data.places) ? data.places : [];

    cache.set(key, {
      createdAt: Date.now(),
      places
    });

    return {
      success: true,
      places,
      cached: Boolean(data.cached)
    };
  } catch (error) {
    return {
      success: false,
      places: [],
      error: "Network error while loading nearby resources"
    };
  }
}
