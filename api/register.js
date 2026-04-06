/* =========================================================
   api/register.js — POST /api/register
   Vercel Serverless Function
   
   Saves an FCM token (+ optional email + location) to
   Firebase Realtime Database under the permanent nodes:
     • fcm_tokens/{tokenKey}    — for push notifications
     • subscribers/{emailKey}   — for email list
   
   This replaces the old in-memory array in server.js.
   ========================================================= */

import { createHash } from "node:crypto";
import { getAdminDb } from "./_firebaseAdmin.js";

// Email validation regex (RFC 5322 simplified)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  if (!email || typeof email !== "string") return false;
  return EMAIL_REGEX.test(email.trim());
}

// CORS headers shared with all API routes
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { token, email, location } = req.body ?? {};

  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Valid FCM token is required" });
  }

  try {
    const db = getAdminDb();

    // Hash the full token so each device record gets a collision-safe key.
    const tokenKey = createHash("sha256").update(token).digest("hex");

    // Persist the token record
    await db.ref(`fcm_tokens/${tokenKey}`).set({
      token,
      email:      email    || null,
      location:   location || null,
      registeredAt: Date.now()
    });

    // Persist email separately for bulk-email fan-out
    if (email && isValidEmail(email)) {
      const emailKey = email.toLowerCase().replace(/[.@+]/g, "_");
      await db.ref(`subscribers/${emailKey}`).set({
        email: email.toLowerCase(),
        subscribedAt: Date.now()
      });
    } else if (email) {
      console.warn(`[/api/register] Invalid email format rejected: ${email}`);
    }

    return res.status(200).json({ success: true, message: "Token registered" });
  } catch (err) {
    console.error("[/api/register] Error:", err);
    return res
      .status(500)
      .json({ error: "Failed to register token", detail: err.message });
  }
}
