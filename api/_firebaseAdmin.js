/* =========================================================
   api/_firebaseAdmin.js
   Shared Firebase Admin SDK initialization for Vercel
   serverless functions. Guards against re-initialization.
   Also provides auth verification helpers for secured
   serverless routes.
   ========================================================= */

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getDatabase }  from "firebase-admin/database";
import { getMessaging } from "firebase-admin/messaging";
import { getAuth }      from "firebase-admin/auth";

function initAdmin() {
  if (getApps().length > 0) return; // already initialized

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT env var is missing");

  initializeApp({
    credential: cert(JSON.parse(raw)),
    databaseURL:
      process.env.FIREBASE_DATABASE_URL ||
      "https://disaster-alert-50aae-default-rtdb.firebaseio.com"
  });
}

export function getAdminDb() {
  initAdmin();
  return getDatabase();
}

export function getAdminMessaging() {
  initAdmin();
  return getMessaging();
}

export function getAdminAuth() {
  initAdmin();
  return getAuth();
}

/**
 * Verify Firebase ID token from Authorization Bearer header.
 * Returns decoded token with user info, or throws error if invalid.
 * 
 * @param {string} authHeader - Value of Authorization header (e.g., "Bearer <token>")
 * @returns {Promise<Object>} Decoded token { uid, email, custom claims, etc. }
 * @throws {Error} If token is missing, malformed, or invalid
 */
export async function verifyFirebaseToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Missing or invalid Authorization header. Expected: Bearer <token>");
  }

  const token = authHeader.replace("Bearer ", "");
  const auth = getAdminAuth();
  
  try {
    const decodedToken = await auth.verifyIdToken(token);
    return decodedToken;
  } catch (err) {
    throw new Error(`Invalid Firebase ID token: ${err.message}`);
  }
}

