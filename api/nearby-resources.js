/* =========================================================
   api/nearby-resources.js — POST /api/nearby-resources
   Fetch nearby emergency resources via Google Places API.
   ========================================================= */

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RESULTS = 5;
const DEFAULT_RADIUS_METERS = 5000;
const MIN_RADIUS_METERS = 500;
const MAX_RADIUS_METERS = 10000;

const API_ENDPOINT = "https://maps.googleapis.com/maps/api/place/nearbysearch/json";

const cache = globalThis.__nearbyResourcesCache || new Map();
globalThis.__nearbyResourcesCache = cache;

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampRadius(value) {
  const n = toNumber(value) ?? DEFAULT_RADIUS_METERS;
  return Math.max(MIN_RADIUS_METERS, Math.min(MAX_RADIUS_METERS, Math.round(n)));
}

function cacheKey(lat, lng, radius) {
  return `${lat.toFixed(4)}:${lng.toFixed(4)}:${radius}`;
}

function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dP = ((lat2 - lat1) * Math.PI) / 180;
  const dL = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(dP / 2) * Math.sin(dP / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dL / 2) * Math.sin(dL / 2);

  return Math.round(R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))));
}

function normalizeKind(kind) {
  if (kind === "hospital") return "hospital";
  if (kind === "police") return "police";
  return "shelter";
}

function toPublicPlace(place, kind, lat, lng) {
  const location = place?.geometry?.location || {};
  const pLat = toNumber(location.lat);
  const pLng = toNumber(location.lng);

  if (pLat == null || pLng == null) return null;

  const distanceMeters = haversineDistanceMeters(lat, lng, pLat, pLng);

  return {
    id: place.place_id,
    name: place.name || "Unknown",
    type: normalizeKind(kind),
    vicinity: place.vicinity || place.formatted_address || "Address unavailable",
    lat: pLat,
    lng: pLng,
    distanceMeters,
    distanceKm: Number((distanceMeters / 1000).toFixed(2))
  };
}

async function fetchNearbyByKind({ lat, lng, radius, apiKey, type, keyword, kind }) {
  const params = new URLSearchParams({
    key: apiKey,
    location: `${lat},${lng}`,
    radius: String(radius),
    type
  });

  if (keyword) params.set("keyword", keyword);

  const url = `${API_ENDPOINT}?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Google Places request failed (${response.status})`);
  }

  const json = await response.json();
  if (!json || (json.status !== "OK" && json.status !== "ZERO_RESULTS")) {
    throw new Error(`Google Places status: ${json?.status || "UNKNOWN"}`);
  }

  const results = Array.isArray(json.results) ? json.results : [];
  return results
    .map((entry) => toPublicPlace(entry, kind, lat, lng))
    .filter(Boolean);
}

function mergeAndRank(...groups) {
  const deduped = new Map();

  groups.flat().forEach((entry) => {
    if (!entry || !entry.id) return;

    const existing = deduped.get(entry.id);
    if (!existing || entry.distanceMeters < existing.distanceMeters) {
      deduped.set(entry.id, entry);
    }
  });

  return [...deduped.values()]
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, MAX_RESULTS)
    .map(({ id, distanceMeters, ...safe }) => safe);
}

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  let body = req.body || {};
  if (typeof req.body === "string") {
    try {
      body = JSON.parse(req.body || "{}");
    } catch {
      return res.status(400).json({
        success: false,
        places: [],
        error: "Invalid JSON body"
      });
    }
  }

  const lat = toNumber(body.lat);
  const lng = toNumber(body.lng);
  const radius = clampRadius(body.radius);

  if (lat == null || lng == null) {
    return res.status(400).json({
      success: false,
      error: "Valid latitude and longitude are required"
    });
  }

  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({
      success: false,
      error: "Latitude/longitude out of range"
    });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      success: false,
      places: [],
      error: "Nearby resources service is not configured"
    });
  }

  const key = cacheKey(lat, lng, radius);
  const cached = cache.get(key);

  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return res.status(200).json({
      success: true,
      places: cached.places,
      cached: true
    });
  }

  try {
    const [hospitals, policeStations, shelters] = await Promise.all([
      fetchNearbyByKind({ lat, lng, radius, apiKey, type: "hospital", kind: "hospital" }),
      fetchNearbyByKind({ lat, lng, radius, apiKey, type: "police", kind: "police" }),
      fetchNearbyByKind({ lat, lng, radius, apiKey, type: "lodging", keyword: "shelter", kind: "shelter" })
    ]);

    const places = mergeAndRank(hospitals, policeStations, shelters);

    cache.set(key, {
      createdAt: Date.now(),
      places
    });

    return res.status(200).json({
      success: true,
      places,
      cached: false
    });
  } catch (err) {
    console.error("[nearby-resources] Error:", err);
    return res.status(502).json({
      success: false,
      places: [],
      error: "Failed to fetch nearby resources"
    });
  }
}
