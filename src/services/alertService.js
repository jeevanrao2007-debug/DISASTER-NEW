/* =========================================================
   src/services/alertService.js
   Handles fetching, deleting, and publishing alerts from
   Firebase Realtime Database.
   ========================================================= */

import { getDatabase, ref, onValue, remove, push, set, get }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getFirebaseApp } from "../config/firebase.js";

let db = null;

async function getDb() {
  if (!db) {
    const app = await getFirebaseApp();
    db = getDatabase(app);
  }
  return db;
}

const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Listen for ACTIVE alerts only.
 * Legacy alerts with no status field are also shown.
 */
export async function listenForAlerts(callback) {
  const currentDb = await getDb();
  const alertsRef = ref(currentDb, "alerts");
  return onValue(alertsRef, (snap) => {
    const all = snap.val() || {};
    const active = Object.fromEntries(
      Object.entries(all).filter(([, a]) =>
        !a.status || a.status === "Active"
      )
    );
    callback(active);
  });
}

/**
 * Listen for live updates to the "pending" collection.
 */
export async function listenForPendingAlerts(callback) {
  const currentDb = await getDb();
  const pendingRef = ref(currentDb, "pending");
  return onValue(pendingRef, (snap) => {
    callback(snap.val() || {});
  });
}

/**
 * Publish a new alert with full Phase 4 schema.
 * Stamps status, createdAt, and expiresAt automatically.
 */
export async function publishAlert(alertData) {
  const currentDb = await getDb();
  const alertsRef = ref(currentDb, "alerts");
  const now = Date.now();
  return push(alertsRef, {
    ...alertData,
    status: "Active",
    createdAt: alertData.createdAt || now,
    expiresAt: now + EXPIRY_MS,
  });
}

/**
 * Delete a live alert (hard delete).
 */
export async function deleteLiveAlert(id) {
  const currentDb = await getDb();
  return remove(ref(currentDb, "alerts/" + id));
}

/**
 * Approve a pending alert — moves it to live alerts with full schema.
 */
export async function approvePendingAlert(id) {
  const currentDb = await getDb();
  const snap = await get(ref(currentDb, "pending/" + id));
  if (!snap.exists()) return null;

  const now = Date.now();
  const alertData = {
    ...snap.val(),
    status: "Active",
    createdAt: snap.val().createdAt || now,
    expiresAt: now + EXPIRY_MS,
  };

  await set(ref(currentDb, "alerts/" + id), alertData);
  await remove(ref(currentDb, "pending/" + id));
  return alertData;
}

/**
 * Reject a pending alert (hard delete from pending).
 */
export async function rejectPendingAlert(id) {
  const currentDb = await getDb();
  return remove(ref(currentDb, "pending/" + id));
}

/**
 * Resolve a live alert — hard delete from DB.
 */
export async function resolveAlert(id) {
  const currentDb = await getDb();
  return remove(ref(currentDb, "alerts/" + id));
}