/* =========================================================
   api/_firebaseAdmin.js
   Shared Firebase Admin SDK initialization for Vercel
   serverless functions. Guards against re-initialization.
   ========================================================= */

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getDatabase }  from "firebase-admin/database";
import { getMessaging } from "firebase-admin/messaging";

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
