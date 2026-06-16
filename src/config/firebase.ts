import admin from "firebase-admin";

/**
 * Initialize Firebase Admin SDK.
 * Uses Application Default Credentials (ADC) — set GOOGLE_APPLICATION_CREDENTIALS
 * env var to path of the service account JSON, or deploy on GCP/Cloud Run where
 * ADC is auto-configured.
 *
 * For development, you can also set FIREBASE_SERVICE_ACCOUNT_JSON env var to
 * the JSON string of the service account key.
 */
let firebaseApp: admin.app.App | null = null;

export function getFirebaseAdmin(): admin.app.App | null {
  if (firebaseApp) return firebaseApp;

  try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    if (serviceAccountJson) {
      const serviceAccount = JSON.parse(serviceAccountJson);
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    } else {
      // Use Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS)
      firebaseApp = admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
    }

    console.log("[Firebase Admin] Initialized successfully.");
    return firebaseApp;
  } catch (error) {
    console.warn("[Firebase Admin] Initialization failed — FCM push disabled:", error);
    return null;
  }
}

/**
 * Send an FCM data message to a specific device token.
 * Uses data-only messages so the app handles display (critical for call UI).
 */
export async function sendFcmToDevice(
  fcmToken: string,
  data: Record<string, string>,
  options?: { priority?: "high" | "normal" },
): Promise<boolean> {
  const app = getFirebaseAdmin();
  if (!app) return false;

  try {
    await app.messaging().send({
      token: fcmToken,
      data,
      android: {
        priority: options?.priority === "normal" ? "normal" : "high",
        ttl: 60000, // 60 seconds — calls should be answered quickly
      },
      apns: {
        headers: {
          "apns-priority": "10",
          "apns-push-type": "voip",
        },
        payload: {
          aps: {
            "content-available": 1,
            sound: "default",
          },
        },
      },
    });
    return true;
  } catch (error: unknown) {
    const errorCode = typeof error === "object" && error && "code" in error
      ? (error as { code?: string }).code
      : "";

    // Token is no longer valid — caller should clean it up
    if (
      errorCode === "messaging/invalid-registration-token" ||
      errorCode === "messaging/registration-token-not-registered"
    ) {
      console.warn(`[FCM] Token invalid/unregistered: ${fcmToken.slice(0, 20)}...`);
      return false;
    }

    console.error("[FCM] Send failed:", error);
    return false;
  }
}

/**
 * Send FCM data messages to multiple device tokens for a user.
 * Returns the list of tokens that failed (so they can be cleaned up).
 */
export async function sendFcmToTokens(
  tokens: string[],
  data: Record<string, string>,
): Promise<string[]> {
  const app = getFirebaseAdmin();
  if (!app || tokens.length === 0) return [];

  const failedTokens: string[] = [];

  const response = await app.messaging().sendEachForMulticast({
    tokens,
    data,
    android: {
      priority: "high",
      ttl: 60000,
    },
    apns: {
      headers: {
        "apns-priority": "10",
      },
      payload: {
        aps: {
          "content-available": 1,
          sound: "default",
        },
      },
    },
  });

  response.responses.forEach((resp, idx) => {
    if (!resp.success) {
      const code = resp.error?.code ?? "";
      if (
        code === "messaging/invalid-registration-token" ||
        code === "messaging/registration-token-not-registered"
      ) {
        failedTokens.push(tokens[idx]);
      }
    }
  });

  return failedTokens;
}
