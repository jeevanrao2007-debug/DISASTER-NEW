/* =========================================================
   api/register.js — POST /api/register
   Vercel Serverless Function
   
   Saves an FCM token (+ optional location + WhatsApp opt-in)
   Firebase Realtime Database under the permanent nodes:
     • fcm_tokens/{tokenKey}       — for push + opt-in metadata
     • whatsapp_subscribers/{key}  — optional fan-out index
   
   This replaces the old in-memory array in server.js.
   ========================================================= */

import { createHash } from "node:crypto";
import { getAdminDb } from "./_firebaseAdmin.js";
import { normalizePhoneE164 } from "./_whatsappProvider.js";

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

  const {
    token,
    email,
    location,
    whatsappNumber,
    whatsappOptIn
  } = req.body ?? {};

  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Valid FCM token is required" });
  }

  try {
    const db = getAdminDb();

    // Hash the full token so each device record gets a collision-safe key.
    const tokenKey = createHash("sha256").update(token).digest("hex");
    const normalizedWhatsApp = normalizePhoneE164(whatsappNumber || "");
    const isWhatsAppOptedIn = Boolean(whatsappOptIn) && Boolean(normalizedWhatsApp);

    if (whatsappNumber && !normalizedWhatsApp) {
      console.warn(`[/api/register] Invalid WhatsApp number rejected: ${whatsappNumber}`);
    }

    // Persist the token record
    await db.ref(`fcm_tokens/${tokenKey}`).set({
      token,
      location:   location || null,
      whatsappNumber: normalizedWhatsApp || null,
      whatsappOptIn: isWhatsAppOptedIn,
      whatsappOptedAt: isWhatsAppOptedIn ? Date.now() : null,
      registeredAt: Date.now()
    });

    // Optional denormalized subscriber list for high-volume WhatsApp fan-out.
    if (isWhatsAppOptedIn && normalizedWhatsApp) {
      const phoneKey = normalizedWhatsApp.replace(/\+/g, "");
      await db.ref(`whatsapp_subscribers/${phoneKey}`).set({
        whatsappNumber: normalizedWhatsApp,
        whatsappOptIn: true,
        subscribedAt: Date.now()
      });
    } else if (normalizedWhatsApp) {
      const phoneKey = normalizedWhatsApp.replace(/\+/g, "");
      await db.ref(`whatsapp_subscribers/${phoneKey}`).remove();
    }

    // Keep backward compatibility with old clients that still send email.
    if (email) {
      console.info("[/api/register] Email field received but ignored (email channel disabled).");
    }

    return res.status(200).json({ success: true, message: "Token registered" });
  } catch (err) {
    console.error("[/api/register] Error:", err);
    return res
      .status(500)
      .json({ error: "Failed to register token", detail: err.message });
  }
}
