import { getDatabase, ref, onValue, remove, push, set, get }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getFirebaseApp } from "../config/firebase.js";

const EXPIRY_MS = 24 * 60 * 60 * 1000;

let db = null;

async function getDb() {
  if (!db) {
    const app = await getFirebaseApp();
    db = getDatabase(app);
  }
  return db;
}

function normalizeSeverity(value) {
  const normalized = String(value || "moderate").trim().toLowerCase();
  return ["low", "moderate", "high", "critical"].includes(normalized)
    ? normalized
    : "moderate";
}

function capitalize(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function normalizeAlertRecord(alert = {}, fallbackCreatedAt = Date.now()) {
  const severity = normalizeSeverity(alert.severity || alert.level);
  const level = capitalize(alert.level || severity) || "Moderate";
  const createdAt = Number.isFinite(Number(alert.createdAt))
    ? Number(alert.createdAt)
    : fallbackCreatedAt;
  const expiresAt = Number.isFinite(Number(alert.expiresAt))
    ? Number(alert.expiresAt)
    : createdAt + EXPIRY_MS;

  return {
    ...alert,
    severity,
    level,
    description: String(alert.description || alert.desc || "").trim(),
    desc: String(alert.desc || alert.description || "").trim(),
    createdAt,
    expiresAt,
    status: alert.status || "Active"
  };
}

export async function listenForAlerts(callback) {
  const currentDb = await getDb();
  const alertsRef = ref(currentDb, "alerts");
  return onValue(alertsRef, (snap) => {
    const all = snap.val() || {};
    const now = Date.now();
    const active = Object.fromEntries(
      Object.entries(all)
        .map(([id, alert]) => [id, normalizeAlertRecord(alert)])
        .filter(([, alert]) =>
          (!alert.status || alert.status === "Active") &&
          (!alert.expiresAt || alert.expiresAt > now)
        )
    );

    callback(active);
  });
}

export async function listenForPendingAlerts(callback) {
  const currentDb = await getDb();
  const pendingRef = ref(currentDb, "pending");
  return onValue(pendingRef, (snap) => {
    const pending = snap.val() || {};
    callback(
      Object.fromEntries(
        Object.entries(pending).map(([id, alert]) => [id, normalizeAlertRecord(alert)])
      )
    );
  });
}

export async function publishAlert(alertData) {
  const currentDb = await getDb();
  const alertsRef = ref(currentDb, "alerts");
  const now = Date.now();
  return push(alertsRef, normalizeAlertRecord(alertData, now));
}

export async function deleteLiveAlert(id) {
  const currentDb = await getDb();
  return remove(ref(currentDb, `alerts/${id}`));
}

export async function approvePendingAlert(id) {
  const currentDb = await getDb();
  const pendingRef = ref(currentDb, `pending/${id}`);
  const snap = await get(pendingRef);
  if (!snap.exists()) return null;

  const normalized = normalizeAlertRecord(snap.val(), Date.now());
  await set(ref(currentDb, `alerts/${id}`), normalized);
  await remove(pendingRef);
  return normalized;
}

export async function rejectPendingAlert(id) {
  const currentDb = await getDb();
  return remove(ref(currentDb, `pending/${id}`));
}

export async function resolveAlert(id) {
  const currentDb = await getDb();
  return remove(ref(currentDb, `alerts/${id}`));
}
