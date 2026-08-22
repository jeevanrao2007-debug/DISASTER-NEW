import { initializeApp, getApps, cert, applicationDefault } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";

let adminApp = null;

function parseFirebaseConfig() {
  if (!process.env.FIREBASE_CONFIG) {
    return {};
  }

  try {
    return JSON.parse(process.env.FIREBASE_CONFIG);
  } catch {
    return {};
  }
}

function getDatabaseUrl(projectId) {
  return process.env.FIREBASE_DATABASE_URL ||
    parseFirebaseConfig().databaseURL ||
    (projectId ? `https://${projectId}-default-rtdb.firebaseio.com` : undefined);
}

function initializeFirebaseAdmin() {
  if (adminApp) {
    return adminApp;
  }

  const activeApps = getApps();
  if (activeApps.length > 0) {
    adminApp = activeApps[0];
    return adminApp;
  }

  const firebaseConfig = parseFirebaseConfig();
  const projectId =
    process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    firebaseConfig.projectId ||
    null;
  const databaseURL = getDatabaseUrl(projectId);
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccount) {
    const serviceAccountObj = JSON.parse(serviceAccount);
    if (serviceAccountObj.private_key) {
      serviceAccountObj.private_key = serviceAccountObj.private_key.replace(/\\n/g, '\n');
    }
    adminApp = initializeApp({
      credential: cert(serviceAccountObj),
      ...(databaseURL ? { databaseURL } : {})
    });
    return adminApp;
  }

  adminApp = initializeApp({
    credential: applicationDefault(),
    ...(databaseURL ? { databaseURL } : {})
  });

  return adminApp;
}

export function getAdminApp() {
  return initializeFirebaseAdmin();
}

export function getAdminDb() {
  return getDatabase(initializeFirebaseAdmin());
}

export function getAdminAuth() {
  return getAuth(initializeFirebaseAdmin());
}

export function getAdminMessaging() {
  return getMessaging(initializeFirebaseAdmin());
}

export { getAdminMessaging as getMessaging };

export async function verifyFirebaseAuthToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Missing or invalid Authorization header");
  }

  const idToken = authHeader.slice("Bearer ".length).trim();
  if (!idToken) {
    throw new Error("Missing Firebase ID token");
  }

  return getAdminAuth().verifyIdToken(idToken);
}
