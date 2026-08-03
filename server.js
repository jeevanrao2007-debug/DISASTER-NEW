import express from "express";
import cors from "cors";
import * as SibApiV3Sdk from "@getbrevo/brevo";
import { getAdminDb, verifyFirebaseAuthToken } from "./helpers/firebaseAdmin.js";
import { haversineKm } from "./helpers/geo.js";

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Brevo (formerly Sendinblue) Transactional Email Client
// Free tier allows sending to ANY verified recipient — no domain ownership required.
// ---------------------------------------------------------------------------
const brevoEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();
brevoEmailApi.setApiKey(
  SibApiV3Sdk.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY || ""
);
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || "";
const BREVO_SENDER_NAME = "Disaster Alerts";

// Middleware
app.use(cors());
app.use(express.json());

// Root / Healthcheck route
app.get("/", (req, res) => {
  res.send("Disaster Alert System Express Backend is running.");
});

// Helper for register email normalization
function normalizeEmail(email) {
  if (typeof email !== "string") {
    return null;
  }
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

// POST /register
app.post("/register", async (req, res) => {
  const { email } = req.body || {};
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    res.status(400).json({ success: false, error: "A valid email address is required" });
    return;
  }

  try {
    const db = getAdminDb();
    
    // Prevent duplicate emails
    const snapshot = await db.ref("subscribers")
      .orderByChild("email")
      .equalTo(normalizedEmail)
      .once("value");

    if (snapshot.exists()) {
      res.status(400).json({ success: false, error: "This email is already subscribed" });
      return;
    }

    const newSubRef = db.ref("subscribers").push();
    const record = {
      email: normalizedEmail,
      createdAt: Date.now()
    };

    await newSubRef.set(record);

    res.status(200).json({
      success: true,
      message: "Subscribed successfully",
      record
    });
  } catch (error) {
    console.error("[register] Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to subscribe"
    });
  }
});

// Helper for alert normalization
function normalizeAlertPayload(input = {}) {
  const type = String(input.type || "Disaster").trim();
  const severity = String(input.severity || input.level || "moderate").trim().toLowerCase();
  const level = String(input.level || input.severity || "Moderate").trim();
  
  const lat = input.lat != null ? Number(input.lat) : null;
  const lng = input.lng != null ? Number(input.lng) : null;
  const hasCoordinates = lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng);
  
  const location = String(input.location || (hasCoordinates ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : "your area")).trim();
  const description = String(input.description || input.desc || "").trim();
  const createdAt = Number.isFinite(Number(input.createdAt)) ? Number(input.createdAt) : Date.now();

  return {
    type,
    severity,
    level,
    location,
    description,
    createdAt
  };
}

// POST /dispatchAlert
app.post("/dispatchAlert", async (req, res) => {
  try {
    console.log("[dispatchAlert] Function invoked, verifying auth...");
    const decodedToken = await verifyFirebaseAuthToken(req.headers.authorization || "");
    console.log("[dispatchAlert] Auth verified for:", decodedToken.email || decodedToken.uid);
    const alert = normalizeAlertPayload(req.body || {});
    console.log("[dispatchAlert] Alert payload:", JSON.stringify(alert));

    if (!alert.type) {
      res.status(400).json({ success: false, error: "Alert type is required" });
      return;
    }

    const db = getAdminDb();
    console.log("[dispatchAlert] Loading subscribers from database...");
    const snapshot = await db.ref("subscribers").once("value");
    const rawData = snapshot.val();
    console.log("[dispatchAlert] Raw subscribers data:", JSON.stringify(rawData));
    const subscribers = Object.values(rawData || {});

    const recipients = [...new Set(
      subscribers
        .map((s) => (typeof s === "string" ? s : String(s?.email || "")).trim().toLowerCase())
        .filter(Boolean)
    )];

    console.log("[dispatchAlert] Unique recipients:", recipients.length, recipients);

    if (recipients.length === 0) {
      res.status(200).json({
        success: true,
        dispatchedBy: decodedToken.email || decodedToken.uid || "unknown",
        alert,
        message: "No subscribers to email.",
        sent: 0,
        failed: 0
      });
      return;
    }

    // Validate each recipient address before attempting to send — a malformed
    // entry in the DB (e.g. accidental whitespace or partial save) should be
    // skipped and logged rather than crashing the whole batch.
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const validRecipients = [];
    const invalidRecipients = [];
    for (const email of recipients) {
      if (EMAIL_RE.test(email)) {
        validRecipients.push(email);
      } else {
        invalidRecipients.push(email);
      }
    }

    if (invalidRecipients.length > 0) {
      console.warn("[dispatchAlert] Skipping malformed recipient addresses:", invalidRecipients);
    }

    if (validRecipients.length === 0) {
      res.status(200).json({
        success: true,
        dispatchedBy: decodedToken.email || decodedToken.uid || "unknown",
        alert,
        message: "No valid subscriber addresses to email.",
        sent: 0,
        failed: 0,
        skipped: invalidRecipients.length
      });
      return;
    }

    const emailSubject = `🚨 ${alert.type} Alert`;
    const emailBody = `Disaster Alert\n\nType:\n${alert.type}\n\nSeverity:\n${alert.level}\n\nLocation:\n${alert.location}\n\nDescription:\n${alert.description}\n\nStay safe.`;
    const emailHtml = `
      <div style="font-family: sans-serif; line-height: 1.6; color: #111; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #d97706; margin-bottom: 8px;">🚨 ${alert.type} Alert</h2>
        <p><strong>Severity:</strong> ${alert.level}</p>
        <p><strong>Location:</strong> ${alert.location}</p>
        <p><strong>Description:</strong> ${alert.description}</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p style="font-size: 0.9em; color: #6b7280;">Stay safe,<br>Disaster Alert System</p>
      </div>
    `;

    console.log("[dispatchAlert] Sending emails via Brevo to", validRecipients.length, "valid recipients...");
    const settled = await Promise.allSettled(
      validRecipients.map((recipientEmail) =>
        brevoEmailApi.sendTransacEmail({
          sender: { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME },
          to: [{ email: recipientEmail }],
          subject: emailSubject,
          htmlContent: emailHtml,
          textContent: emailBody
        })
      )
    );

    let sent = 0;
    let failed = 0;
    const errors = [];

    settled.forEach((result, idx) => {
      if (result.status === "fulfilled") {
        sent++;
      } else {
        failed++;
        const errMsg = result.reason?.message || String(result.reason);
        console.error(`[dispatchAlert] Failed to send to ${validRecipients[idx]}:`, errMsg);
        errors.push({ email: validRecipients[idx], error: errMsg });
      }
    });

    console.log(`[dispatchAlert] Brevo email results: sent=${sent}, failed=${failed}, skipped=${invalidRecipients.length}`);

    if (sent === 0 && failed > 0) {
      res.status(502).json({
        success: false,
        error: `Failed to deliver emails via Brevo: ${errors[0]?.error || "API failure"}`,
        sent,
        failed,
        skipped: invalidRecipients.length,
        errors
      });
      return;
    }

    res.status(200).json({
      success: true,
      dispatchedBy: decodedToken.email || decodedToken.uid || "unknown",
      alert,
      sent,
      failed,
      skipped: invalidRecipients.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    const status = /Authorization|token/i.test(error.message) ? 401 : 500;
    console.error("[dispatchAlert] Error:", error);
    res.status(status).json({
      success: false,
      error: status === 401 ? error.message : "Failed to dispatch alert"
    });
  }
});

// Helper for aiAdvisor
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";

function buildPrompt({ type, severity, description, lat, lng }) {
  const location = (lat != null && lng != null)
    ? `near coordinates ${lat}, ${lng}`
    : "at an unspecified location";

  return `You are an expert emergency response AI advisor for a real-time disaster monitoring system.

A disaster alert has been triggered with the following details:
- Disaster Type: ${type || "Unknown Disaster"}
- Severity Level: ${severity || "moderate"}
- Description: ${description || "No additional details"}
- Location: ${location}

Based on this information, provide a structured safety advisory. Use this exact format with these section headers and emoji prefixes. Keep each section concise (2-3 bullet points max):

🚨 SITUATION OVERVIEW
Brief 1-2 sentence summary of the threat.

🛡️ IMMEDIATE ACTIONS
- Numbered steps people should take RIGHT NOW

📦 EMERGENCY KIT ESSENTIALS
- Items people should grab or have ready

📍 EVACUATION GUIDANCE
- Whether to evacuate or shelter in place
- Safe zones and routes to consider

📞 EMERGENCY CONTACTS
- List relevant emergency service numbers (India: 112, NDRF: 011-24363260, etc.)

⚠️ THINGS TO AVOID
- Common mistakes people make during this disaster

💡 RECOVERY TIPS
- What to do after the immediate danger passes

Keep the response practical, actionable, and under 400 words. Do not use markdown headers. Use plain text with the emoji prefixes shown above as section dividers. Write for a general public audience.`;
}

// POST /aiAdvisor
app.post("/aiAdvisor", async (req, res) => {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    res.status(503).json({
      success: false,
      error: "AI Advisor is not configured"
    });
    return;
  }

  const { type, severity, description, lat, lng } = req.body || {};

  if (!type || typeof type !== "string") {
    res.status(400).json({
      success: false,
      error: "Missing disaster type"
    });
    return;
  }

  try {
    const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: buildPrompt({ type, severity, description, lat, lng })
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          topP: 0.9,
          topK: 40,
          maxOutputTokens: 800
        },
        safetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ]
      })
    });

    if (!geminiResponse.ok) {
      console.error("[aiAdvisor] Gemini API error:", geminiResponse.status, await geminiResponse.text());
      res.status(502).json({
        success: false,
        error: "AI service returned an error"
      });
      return;
    }

    const payload = await geminiResponse.json();
    const advice = payload?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!advice) {
      res.status(502).json({
        success: false,
        error: "AI service returned an empty response"
      });
      return;
    }

    res.status(200).json({
      success: true,
      advice,
      model: "gemini-2.5-flash-lite"
    });
  } catch (error) {
    console.error("[aiAdvisor] Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to generate safety advice"
    });
  }
});

// Helpers for nearbyResources
const GOOGLE_PLACES_ENDPOINT = "https://maps.googleapis.com/maps/api/place/nearbysearch/json";
const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_RADIUS_METERS = 5000;
const MIN_RADIUS_METERS = 500;
const MAX_RADIUS_METERS = 10000;
const MAX_RESULTS = 5;

const nearbyResourcesCache = new Map();

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampRadius(value) {
  const parsed = toNumber(value) ?? DEFAULT_RADIUS_METERS;
  return Math.max(MIN_RADIUS_METERS, Math.min(MAX_RADIUS_METERS, Math.round(parsed)));
}

function cacheKey(lat, lng, radius) {
  return `${lat.toFixed(4)}:${lng.toFixed(4)}:${radius}`;
}

function normalizeKind(kind) {
  if (kind === "hospital") {
    return "hospital";
  }
  if (kind === "police") {
    return "police";
  }
  return "shelter";
}

function toPublicPlace(place, kind, lat, lng) {
  const location = place?.geometry?.location || {};
  const placeLat = toNumber(location.lat);
  const placeLng = toNumber(location.lng);

  if (placeLat == null || placeLng == null) {
    return null;
  }

  const distanceKm = haversineKm(lat, lng, placeLat, placeLng);
  const distanceMeters = Math.round(distanceKm * 1000);

  return {
    id: place.place_id,
    name: place.name || "Unknown",
    type: normalizeKind(kind),
    vicinity: place.vicinity || place.formatted_address || "Address unavailable",
    lat: placeLat,
    lng: placeLng,
    distanceMeters,
    distanceKm: Number(distanceKm.toFixed(2))
  };
}

async function fetchNearbyByKind({ lat, lng, radius, apiKey, type, keyword, kind }) {
  const params = new URLSearchParams({
    key: apiKey,
    location: `${lat},${lng}`,
    radius: String(radius),
    type
  });

  if (keyword) {
    params.set("keyword", keyword);
  }

  const result = await fetch(`${GOOGLE_PLACES_ENDPOINT}?${params.toString()}`);

  if (!result.ok) {
    throw new Error(`Google Places request failed (${result.status})`);
  }

  const payload = await result.json();
  if (payload.status !== "OK" && payload.status !== "ZERO_RESULTS") {
    throw new Error(`Google Places status: ${payload.status || "UNKNOWN"}`);
  }

  return (payload.results || [])
    .map((entry) => toPublicPlace(entry, kind, lat, lng))
    .filter(Boolean);
}

function mergeAndRank(...groups) {
  const deduped = new Map();

  groups.flat().forEach((entry) => {
    if (!entry?.id) {
      return;
    }

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

// POST /nearbyResources
app.post("/nearbyResources", async (req, res) => {
  const lat = toNumber(req.body?.lat);
  const lng = toNumber(req.body?.lng);
  const radius = clampRadius(req.body?.radius);

  if (lat == null || lng == null) {
    res.status(400).json({
      success: false,
      places: [],
      error: "Valid latitude and longitude are required"
    });
    return;
  }

  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    res.status(400).json({
      success: false,
      places: [],
      error: "Latitude/longitude out of range"
    });
    return;
  }

  const apiKey = (process.env.GOOGLE_PLACES_API_KEY || "").trim();
  if (!apiKey) {
    res.status(503).json({
      success: false,
      places: [],
      error: "Nearby resources service is not configured"
    });
    return;
  }

  const key = cacheKey(lat, lng, radius);
  const cached = nearbyResourcesCache.get(key);

  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    res.status(200).json({
      success: true,
      places: cached.places,
      cached: true
    });
    return;
  }

  try {
    const [hospitals, policeStations, shelters] = await Promise.all([
      fetchNearbyByKind({ lat, lng, radius, apiKey, type: "hospital", kind: "hospital" }),
      fetchNearbyByKind({ lat, lng, radius, apiKey, type: "police", kind: "police" }),
      fetchNearbyByKind({ lat, lng, radius, apiKey, type: "lodging", keyword: "shelter", kind: "shelter" })
    ]);

    const places = mergeAndRank(hospitals, policeStations, shelters);

    nearbyResourcesCache.set(key, {
      createdAt: Date.now(),
      places
    });

    res.status(200).json({
      success: true,
      places,
      cached: false
    });
  } catch (error) {
    console.error("[nearbyResources] Error:", error);
    res.status(502).json({
      success: false,
      places: [],
      error: "Failed to fetch nearby resources"
    });
  }
});

// Helpers for detector
const USGS_FEED_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson";
const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000;

function normalizeSeverity(magnitude) {
  if (magnitude >= 6.5) {
    return { severity: "critical", level: "Critical" };
  }
  if (magnitude >= 5.5) {
    return { severity: "high", level: "High" };
  }
  return { severity: "moderate", level: "Moderate" };
}

function toPendingAlert(feature) {
  const magnitude = Number(feature?.properties?.mag || 0);
  const id = String(feature?.id || "").trim();
  const coordinates = feature?.geometry?.coordinates || [];
  const lng = Number(coordinates[0]);
  const lat = Number(coordinates[1]);

  if (!id || !Number.isFinite(magnitude) || magnitude <= 4.5) {
    return null;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const createdAt = Number(feature?.properties?.time) || Date.now();
  const { severity, level } = normalizeSeverity(magnitude);
  const place = String(feature?.properties?.place || "Unknown location").trim();
  const updatedAt = Number(feature?.properties?.updated) || createdAt;

  return {
    id,
    type: "Earthquake",
    severity,
    level,
    description: `Magnitude ${magnitude.toFixed(1)} earthquake near ${place}`,
    desc: `Magnitude ${magnitude.toFixed(1)} earthquake near ${place}`,
    lat,
    lng,
    source: "USGS Earthquake Feed",
    confidence: Math.min(99, Math.max(70, Math.round(magnitude * 15))),
    auto: true,
    status: "Pending",
    createdAt,
    detectedAt: new Date(createdAt).toISOString(),
    updatedAt,
    expiresAt: createdAt + DEFAULT_EXPIRY_MS,
    externalId: id,
    metadata: {
      magnitude,
      place,
      usgsUrl: feature?.properties?.url || null
    }
  };
}

// POST /detector
app.post("/detector", async (req, res) => {
  const authHeader = (req.headers["authorization"] || "").trim();
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const usgsResponse = await fetch(USGS_FEED_URL, {
      headers: {
        "Content-Type": "application/json"
      }
    });

    if (!usgsResponse.ok) {
      throw new Error(`USGS feed request failed with status ${usgsResponse.status}`);
    }

    const payload = await usgsResponse.json();
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const db = getAdminDb();
    const pendingRef = db.ref("pending");
    const pendingSnapshot = await pendingRef.once("value");
    const existingPending = pendingSnapshot.val() || {};
    const updates = {};
    let created = 0;

    for (const feature of features) {
      const alert = toPendingAlert(feature);
      if (!alert) {
        continue;
      }
      if (existingPending[alert.id]) {
        continue;
      }
      updates[`pending/${alert.id}`] = alert;
      created += 1;
    }

    if (created > 0) {
      await db.ref().update(updates);
    }

    res.status(200).json({
      success: true,
      message: `Added ${created} earthquake alerts to pending`,
      created
    });
  } catch (error) {
    console.error("[detector] Error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to check earthquake feed"
    });
  }
});

// ---------------------------------------------------------------------------
// GET /health/email
// On-demand Brevo API key connectivity check — call this after deploying to Render
// to confirm BREVO_API_KEY is correctly set in the dashboard.
// Protected by CRON_SECRET so it isn't publicly accessible.
// ---------------------------------------------------------------------------
app.get("/health/email", async (req, res) => {
  const authHeader = (req.headers["authorization"] || "").trim();
  const cronSecret = (process.env.CRON_SECRET || "").trim();

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ success: false, error: "Unauthorized" });
    return;
  }

  const apiKey = (process.env.BREVO_API_KEY || "").trim();
  if (!apiKey) {
    res.status(500).json({
      success: false,
      error: "BREVO_API_KEY is missing from environment variables"
    });
    return;
  }

  const senderEmail = (process.env.BREVO_SENDER_EMAIL || "").trim();
  if (!senderEmail) {
    res.status(500).json({
      success: false,
      error: "BREVO_SENDER_EMAIL is missing from environment variables"
    });
    return;
  }

  try {
    // Verify the API key by calling Brevo's account info endpoint
    const accountApi = new SibApiV3Sdk.AccountApi();
    accountApi.setApiKey(SibApiV3Sdk.AccountApiApiKeys.apiKey, apiKey);
    const accountInfo = await accountApi.getAccount();

    console.log("[health/email] Brevo API key verified OK for:", accountInfo?.body?.email);
    res.status(200).json({
      success: true,
      message: "✅ Brevo API key verified successfully",
      account: accountInfo?.body?.email || "(unknown)",
      senderEmail,
      keyPrefix: apiKey.substring(0, 8) + "..."
    });
  } catch (error) {
    console.error("[health/email] Brevo verification failed:", error.message || error);
    res.status(502).json({
      success: false,
      error: `Brevo API verification failed: ${error.message || String(error)}`
    });
  }
});

// POST /cleanup
app.post("/cleanup", async (req, res) => {
  const authHeader = (req.headers["authorization"] || "").trim();
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const db = getAdminDb();
    const snapshot = await db.ref("alerts").once("value");
    const alerts = snapshot.val() || {};
    const now = Date.now();
    const updates = {};
    let deleted = 0;

    Object.entries(alerts).forEach(([id, alert]) => {
      const expiresAt = Number(alert?.expiresAt);
      if (Number.isFinite(expiresAt) && expiresAt <= now) {
        updates[`alerts/${id}`] = null;
        deleted += 1;
      }
    });

    if (deleted > 0) {
      await db.ref().update(updates);
    }

    console.log(`[cleanup] Deleted ${deleted} expired alerts`);
    res.status(200).json({
      success: true,
      message: `Deleted ${deleted} expired alerts`,
      deleted
    });
  } catch (error) {
    console.error("[cleanup] Error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Failed to cleanup expired alerts"
    });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
