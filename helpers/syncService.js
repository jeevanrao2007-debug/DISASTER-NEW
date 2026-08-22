import { getAdminDb } from './firebaseAdmin.js';
import { config } from './config.js';

const FULL_SYNC_PATH = '/api/v1/incidents/sync/full';
const FULL_SYNC_TIMEOUT_MS = 30000;
const FULL_SYNC_DEBOUNCE_MS = 750;
const RETRY_INTERVAL_MS = 3000;
const SOURCE = 'TEAM_ALPHA';

const VALID_HAZARD_TYPES = new Set([
  'FLOOD', 'CYCLONE', 'FIRE', 'URBAN_FIRE', 'ACCIDENT',
  'LANDSLIDE', 'EARTHQUAKE', 'HAZMAT', 'OTHER'
]);
const VALID_SEVERITIES = new Set([
  'LOW', 'MODERATE', 'MEDIUM', 'HIGH', 'CRITICAL', 'EXTREME'
]);

let syncTimer = null;
let retryTimerStarted = false;
let isSyncInFlight = false;
let pendingResync = false;
let lastSyncFailed = false;
let listenerAttached = false;

function normalizeType(raw) {
  if (!raw) return 'OTHER';
  const upper = String(raw).toUpperCase().trim().replace(/\s+/g, '_');
  return VALID_HAZARD_TYPES.has(upper) ? upper : 'OTHER';
}

function normalizeSeverity(rawSeverity, rawLevel) {
  for (const candidate of [rawSeverity, rawLevel]) {
    if (!candidate) continue;
    const upper = String(candidate).toUpperCase().trim();
    if (VALID_SEVERITIES.has(upper)) return upper;
  }
  return 'MODERATE';
}

function toIsoDate(rawValue, fallbackMs = Date.now()) {
  const timestamp = Number(rawValue);
  if (Number.isFinite(timestamp)) {
    return new Date(timestamp).toISOString();
  }

  const parsed = new Date(rawValue || fallbackMs);
  if (Number.isNaN(parsed.getTime())) {
    return new Date(fallbackMs).toISOString();
  }

  return parsed.toISOString();
}

const EXPIRY_MS = 24 * 60 * 60 * 1000;

export function toIncidentPayload(alertId, alertVal) {
  // Check active status and expiration (matching TEAM ALPHA alertService.js)
  const now = Date.now();
  const rawCreatedAt = Number(alertVal?.createdAt || alertVal?.time);
  const createdAtMs = Number.isFinite(rawCreatedAt) ? rawCreatedAt : now;
  const rawExpiresAt = Number(alertVal?.expiresAt);
  const expiresAtMs = Number.isFinite(rawExpiresAt) ? rawExpiresAt : (createdAtMs + EXPIRY_MS);
  const status = String(alertVal?.status || 'Active').trim().toLowerCase();

  if (status !== 'active') {
    console.log(`[SyncService] Skipping alert '${alertId}': status is not Active (status=${alertVal?.status})`);
    return null;
  }

  if (expiresAtMs <= now) {
    console.log(`[SyncService] Skipping alert '${alertId}': alert expired (created=${new Date(createdAtMs).toISOString()}, expires=${new Date(expiresAtMs).toISOString()})`);
    return null;
  }

  const rawLat = alertVal?.lat ?? alertVal?.latitude ?? alertVal?.location?.lat ?? alertVal?.location?.latitude;
  const rawLng = alertVal?.lng ?? alertVal?.longitude ?? alertVal?.location?.lng ?? alertVal?.location?.longitude;

  const lat = Number.parseFloat(rawLat);
  const lng = Number.parseFloat(rawLng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    console.warn(`[SyncService] Skipping alert '${alertId}': invalid coordinates (lat=${rawLat}, lng=${rawLng})`);
    return null;
  }

  const type = normalizeType(alertVal?.type);
  const severity = normalizeSeverity(alertVal?.severity, alertVal?.level);
  const createdAt = toIsoDate(alertVal?.createdAt || alertVal?.time || Date.now());
  const updatedAt = toIsoDate(alertVal?.updatedAt || alertVal?.createdAt || alertVal?.time || Date.now());
  const title = String(alertVal?.title || alertVal?.type || 'Disaster Alert').trim() || 'Disaster Alert';

  let address = '';
  if (typeof alertVal?.location === 'object' && alertVal?.location !== null) {
    address = String(alertVal.location.address || alertVal.location.name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`).trim();
  } else if (typeof alertVal?.location === 'string') {
    address = alertVal.location.trim();
  }
  if (!address) {
    address = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }

  return {
    externalId: alertId,
    title,
    type,
    severity,
    status: 'REPORTED',
    latitude: lat,
    longitude: lng,
    address,
    description: String(alertVal?.description || alertVal?.desc || '').trim(),
    source: SOURCE,
    createdAt,
    updatedAt,
    environment: 'REAL'
  };
}

async function markSyncState(alertIds, state) {
  if (!Array.isArray(alertIds) || alertIds.length === 0) {
    return;
  }

  const db = getAdminDb();
  const updates = {};
  for (const alertId of alertIds) {
    updates[`sync_status/${alertId}`] = {
      ...(state || {}),
      source: SOURCE
    };
  }

  await db.ref().update(updates);
}

async function loadAlertsSnapshot() {
  const db = getAdminDb();
  const snapshot = await db.ref('alerts').once('value');
  return snapshot.val() || {};
}

async function sendFullSyncPayload(payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FULL_SYNC_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.crisismeshApiUrl}${FULL_SYNC_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.crisisIntegrationKey}`,
        'X-Request-ID': `team-alpha-full-sync-${Date.now()}`,
        'X-Correlation-ID': `team-alpha-full-sync-${Date.now()}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const responseText = await response.text();
    let responseJson = null;
    try {
      responseJson = responseText ? JSON.parse(responseText) : null;
    } catch {
      responseJson = { raw: responseText };
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseText || 'Unknown sync error'}`);
    }

    return responseJson || {};
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function performFullSync(reason = 'manual') {
  if (!config.enableCrisisIntegration) {
    return;
  }

  if (isSyncInFlight) {
    pendingResync = true;
    return;
  }

  isSyncInFlight = true;
  pendingResync = false;

  try {
    console.log(`[SyncService] Starting full TEAM ALPHA sync (${reason})`);

    // 1. Read COMPLETE /alerts snapshot and log
    const alerts = await loadAlertsSnapshot();
    const entries = Object.entries(alerts);
    console.log(`[SyncService] Read COMPLETE /alerts snapshot: totalRawAlertCount=${entries.length}`);
    for (const [childKey, alertVal] of entries) {
      const alertTitle = alertVal?.title || alertVal?.type || 'Disaster Alert';
      const alertType = alertVal?.type || 'UNKNOWN';
      const alertSeverity = alertVal?.severity || alertVal?.level || 'UNKNOWN';
      console.log(`[SyncService] RTDB Child Key: ${childKey} | Title: "${alertTitle}" | Type: ${alertType} | Severity: ${alertSeverity}`);
    }

    // 2. Transform EVERY Firebase child into outgoing payload
    const incidents = entries
      .map(([alertId, alertVal]) => toIncidentPayload(alertId, alertVal))
      .filter(Boolean);
    const alertIds = incidents.map((incident) => incident.externalId);

    console.log(`[SyncService] Transformation verification: sourceCount=${entries.length}, transformedCount=${incidents.length}`);
    for (const inc of incidents) {
      console.log(`[SyncService] Outgoing alert: externalId=${inc.externalId} | title="${inc.title}" | type=${inc.type} | severity=${inc.severity}`);
    }

    const attemptTime = Date.now();
    await markSyncState(alertIds, {
      status: 'PENDING',
      lastAttemptAt: attemptTime,
      lastError: null
    });

    // 3. Before POST /api/v1/incidents/sync/full, log exact payload summary
    const payloadSummary = {
      source: SOURCE,
      alertCount: incidents.length,
      externalIds: alertIds
    };
    console.log('[SyncService] Outgoing payload summary:', JSON.stringify(payloadSummary, null, 2));

    const payload = {
      source: SOURCE,
      incidents
    };

    const result = await sendFullSyncPayload(payload);
    lastSyncFailed = false;

    await markSyncState(alertIds, {
      status: 'SYNCED',
      lastAttemptAt: attemptTime,
      lastSyncedAt: Date.now(),
      lastError: null,
      lastResult: {
        received: result?.received ?? incidents.length,
        created: result?.created ?? 0,
        updated: result?.updated ?? 0,
        deleted: result?.deleted ?? 0,
        unchanged: result?.unchanged ?? 0
      }
    });

    console.log(
      `[SyncService] Full sync complete. received=${result?.received ?? incidents.length} ` +
      `created=${result?.created ?? 0} updated=${result?.updated ?? 0} ` +
      `deleted=${result?.deleted ?? 0} unchanged=${result?.unchanged ?? 0}`
    );
  } catch (error) {
    lastSyncFailed = true;
    console.error(`[SyncService] Full sync failed (${reason}):`, error?.message || error);
  } finally {
    isSyncInFlight = false;

    if (pendingResync) {
      scheduleFullSync('queued-change', FULL_SYNC_DEBOUNCE_MS);
    }
  }
}

function scheduleFullSync(reason, delayMs = FULL_SYNC_DEBOUNCE_MS) {
  if (!config.enableCrisisIntegration) {
    return;
  }

  if (syncTimer) {
    clearTimeout(syncTimer);
  }

  syncTimer = setTimeout(() => {
    syncTimer = null;
    performFullSync(reason).catch((error) => {
      console.error('[SyncService] Unhandled full sync error:', error?.message || error);
    });
  }, delayMs);
}

function startRetryLoop() {
  if (retryTimerStarted) {
    return;
  }

  retryTimerStarted = true;
  setInterval(() => {
    if (lastSyncFailed && !isSyncInFlight) {
      scheduleFullSync('retry-after-failure', 0);
    }
  }, RETRY_INTERVAL_MS);
}

export function initAlertSyncListener() {
  if (!config.enableCrisisIntegration) {
    console.log('[SyncService] CrisisMesh integration is disabled. Listeners will not start.');
    return;
  }

  if (listenerAttached) {
    console.log('[SyncService] Listener already attached. Skipping duplicate initialization.');
    return;
  }

  listenerAttached = true;
  console.log('[SyncService] Starting full-state TEAM ALPHA synchronization listener...');
  console.log(`[SyncService] Target: ${config.crisismeshApiUrl}${FULL_SYNC_PATH}`);

  const db = getAdminDb();
  const alertsRef = db.ref('alerts');
  let lastSnapshotHash = '';
  alertsRef.on('value', (snapshot) => {
    const raw = snapshot.val() || {};
    const serialized = JSON.stringify(raw);

    if (serialized === lastSnapshotHash) {
      return;
    }

    lastSnapshotHash = serialized;
    scheduleFullSync('alerts-value-change', 0);
  });

  startRetryLoop();
  scheduleFullSync('startup-initial-sync', 0);
}

export async function triggerFullAlertSync(reason = 'manual') {
  await performFullSync(reason);
}
