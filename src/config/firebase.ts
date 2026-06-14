import { initializeApp, cert, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { env } from "./env";

/**
 * Firebase Admin SDK initialization.
 *
 * Supports two modes:
 * 1. Service account JSON file (FIREBASE_SERVICE_ACCOUNT_PATH env var)
 * 2. Application Default Credentials (when running on GCP/Cloud Run)
 *
 * The Admin SDK is used to verify Firebase ID tokens sent from the mobile app
 * so we can map Firebase users to our PostgreSQL user records.
 */

let firebaseApp: App | undefined;
let firebaseAuth: Auth | undefined;

export function getFirebaseAdmin(): Auth {
  if (firebaseAuth) return firebaseAuth;

  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (serviceAccountJson) {
    // Parse inline JSON (useful for Docker/secrets managers)
    const serviceAccount = JSON.parse(serviceAccountJson);
    firebaseApp = initializeApp({
      credential: cert(serviceAccount),
    });
  } else if (serviceAccountPath) {
    // Load from file path
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const serviceAccount = require(serviceAccountPath);
    firebaseApp = initializeApp({
      credential: cert(serviceAccount),
    });
  } else {
    // Use Application Default Credentials (GCP environments)
    firebaseApp = initializeApp();
  }

  firebaseAuth = getAuth(firebaseApp);
  return firebaseAuth;
}
