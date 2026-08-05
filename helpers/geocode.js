/**
 * Reverse geocodes latitude and longitude coordinates into a human-readable location name
 * using OpenStreetMap's Nominatim API.
 * Includes a timeout safeguard (default 3.5s) and graceful fallback to raw coordinates.
 *
 * @param {number|string} lat
 * @param {number|string} lng
 * @param {number} [timeoutMs=3500]
 * @returns {Promise<string>}
 */
export async function reverseGeocode(lat, lng, timeoutMs = 5000) {
  const numLat = Number(lat);
  const numLng = Number(lng);

  if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) {
    return `${lat}, ${lng}`;
  }

  const fallback = `${numLat.toFixed(4)}, ${numLng.toFixed(4)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${numLat}&lon=${numLng}&zoom=10&addressdetails=1`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "DisasterAlertSystem/1.0 (contact: otcwwe1212@gmail.com)"
      }
    });

    if (!response.ok) {
      return fallback;
    }

    const data = await response.json();
    const addr = data.address || {};
    const area = addr.suburb || addr.neighbourhood || addr.city_district || "";
    const city = addr.city || addr.town || addr.village || "";
    const state = addr.state || "";
    const country = addr.country || "";

    const placeName = [area, city, state, country].filter(Boolean).join(", ");
    return placeName || fallback;
  } catch (error) {
    console.warn(`[reverseGeocode] Geocoding failed or timed out for (${numLat}, ${numLng}):`, error.message);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
