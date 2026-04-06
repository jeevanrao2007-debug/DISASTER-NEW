/* =========================================================
   api/runtime-config.js — GET /api/runtime-config
   Vercel Serverless Function
   
   Public endpoint that returns runtime Firebase client
   configuration. Only safe, non-secret fields are exposed.
   
   Response includes:
   - Firebase config (apiKey, authDomain, databaseURL, etc.)
   - VAPID key for FCM
   
   Secrets NOT returned:
   - FIREBASE_SERVICE_ACCOUNT (admin credential)
   - GMAIL credentials
   - ALERT_API_KEY
   ========================================================= */

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // Cache for 1 hour to reduce env var lookups
  res.setHeader("Cache-Control", "public, max-age=3600");
}

function validateRequired(value, name) {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export default async function handler(req, res) {
  setCors(res);
  
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Validate all required Firebase client config is present
    const config = {
      apiKey:            validateRequired(process.env.VITE_FIREBASE_API_KEY, "VITE_FIREBASE_API_KEY"),
      authDomain:        validateRequired(process.env.VITE_FIREBASE_AUTH_DOMAIN, "VITE_FIREBASE_AUTH_DOMAIN"),
      databaseURL:       validateRequired(process.env.VITE_FIREBASE_DATABASE_URL, "VITE_FIREBASE_DATABASE_URL"),
      projectId:         validateRequired(process.env.VITE_FIREBASE_PROJECT_ID, "VITE_FIREBASE_PROJECT_ID"),
      storageBucket:     validateRequired(process.env.VITE_FIREBASE_STORAGE_BUCKET, "VITE_FIREBASE_STORAGE_BUCKET"),
      messagingSenderId: validateRequired(process.env.VITE_FIREBASE_MESSAGING_SENDER_ID, "VITE_FIREBASE_MESSAGING_SENDER_ID"),
      appId:             validateRequired(process.env.VITE_FIREBASE_APP_ID, "VITE_FIREBASE_APP_ID"),
      vapidKey:          validateRequired(process.env.VITE_FIREBASE_VAPID_KEY, "VITE_FIREBASE_VAPID_KEY")
    };

    return res.status(200).json({
      success: true,
      config
    });
  } catch (err) {
    console.error("[/api/runtime-config] Error:", err.message);
    return res.status(500).json({
      error: "Failed to load runtime config",
      detail: err.message
    });
  }
}
