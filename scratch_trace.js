import './helpers/config.js';

import { getAdminDb } from './helpers/firebaseAdmin.js';
import { toIncidentPayload } from './helpers/syncService.js';

async function checkLive() {
  const db = getAdminDb();
  const snapshot = await db.ref('/alerts').once('value');
  const val = snapshot.val() || {};
  const entries = Object.entries(val);

  console.log('=== 1. FIREBASE RTDB /alerts SNAPSHOT ===');
  console.log('Total Raw Alerts Count:', entries.length);
  entries.forEach(([key, alert], idx) => {
    console.log(`\nAlert #${idx + 1}:`);
    console.log('  Firebase Child Key:', key);
    console.log('  Title:', alert.title);
    console.log('  Type:', alert.type);
    console.log('  Severity / Level:', alert.severity || alert.level);
    console.log('  Location Address:', typeof alert.location === 'object' ? JSON.stringify(alert.location) : alert.location);
    console.log('  Coordinates:', (alert.latitude || alert.lat || alert.location?.latitude || alert.location?.lat), (alert.longitude || alert.lng || alert.location?.longitude || alert.location?.lng));
    console.log('  Created / Updated:', alert.createdAt, alert.updatedAt);
  });

  console.log('\n=== 2. TRANSFORMATION VERIFICATION ===');
  const transformed = [];
  entries.forEach(([key, alert]) => {
    const inc = toIncidentPayload(key, alert);
    if (inc) transformed.push(inc);
  });
  console.log('Transformed Alert Count:', transformed.length);
  console.log('Transformed externalIds:', transformed.map(t => t.externalId));
  console.log('Transformed Payload Summary:\n', JSON.stringify({
    source: 'TEAM_ALPHA',
    alertCount: transformed.length,
    externalIds: transformed.map(t => t.externalId)
  }, null, 2));

  console.log('\n=== 3. FULL TRANSFORMED INCIDENTS ARRAY ===');
  console.log(JSON.stringify(transformed, null, 2));

  process.exit(0);
}

checkLive().catch(err => {
  console.error('Error during checkLive:', err);
  process.exit(1);
});
