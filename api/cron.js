/* =========================================================
   api/cron.js - GET /api/cron
   Vercel Cron Job - runs daily at 00:00 UTC.
   Hard-deletes any alert where expiresAt < Date.now()
   ========================================================= */

import { getAdminDb } from "./_firebaseAdmin.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers["x-cron-secret"] !== cronSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const db = getAdminDb();
    const snap = await db.ref("alerts").once("value");
    const all = snap.val() || {};
    const now = Date.now();

    const expiredKeys = Object.entries(all)
      .filter(([, a]) => a.expiresAt && a.expiresAt < now)
      .map(([id]) => id);

    if (expiredKeys.length === 0) {
      return res.status(200).json({ message: "No expired alerts", deleted: 0 });
    }

    const updates = {};
    expiredKeys.forEach((id) => {
      updates[`alerts/${id}`] = null;
    });
    await db.ref().update(updates);

    console.log(`[cron] Deleted ${expiredKeys.length} expired alert(s)`);
    return res.status(200).json({
      message: "Expired alerts cleaned up",
      deleted: expiredKeys.length,
      ids: expiredKeys
    });
  } catch (err) {
    console.error("[cron] Error:", err);
    return res.status(500).json({ error: err.message });
  }
}