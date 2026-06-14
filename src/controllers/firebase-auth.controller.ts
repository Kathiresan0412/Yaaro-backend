import type { Request, Response } from "express";
import { getFirebaseAdmin } from "../config/firebase";
import { prisma } from "../config/database";
import { createAccessToken } from "../utils/token";
import { env } from "../config/env";
import { randomBytes } from "node:crypto";

const userSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  emailVerified: true,
  onboardingCompleted: true,
  role: true,
  isActive: true,
  isBanned: true,
  status: true,
} as const;

type SelectedUser = {
  id: bigint;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  emailVerified: boolean;
  onboardingCompleted: boolean;
  role: string;
  isActive: boolean;
  isBanned: boolean;
  status: string;
};

/**
 * POST /api/auth/firebase
 *
 * Bridge endpoint: The mobile app authenticates via Firebase (Google, Phone, Email)
 * and then sends the Firebase ID token here. We verify it, find or create the user
 * in our PostgreSQL database, and return our own JWT for subsequent API calls.
 *
 * Body: { idToken: string }
 * Returns: { success, accessToken, refreshToken, user, redirectTo }
 */
export async function firebaseLogin(req: Request, res: Response) {
  const idToken = typeof req.body.idToken === "string" ? req.body.idToken.trim() : "";

  if (!idToken) {
    return res.status(400).json({ success: false, message: "Firebase ID token is required." });
  }

  if (!env.jwtSecret) {
    return res.status(500).json({ success: false, message: "Server configuration error." });
  }

  let decodedToken;
  try {
    const auth = getFirebaseAdmin();
    decodedToken = await auth.verifyIdToken(idToken);
  } catch (error) {
    console.error("Firebase token verification failed:", error);
    return res.status(401).json({ success: false, message: "Invalid or expired Firebase token." });
  }

  const firebaseUid = decodedToken.uid;
  const email = decodedToken.email?.toLowerCase() || null;
  const phone = decodedToken.phone_number || null;
  const displayName = decodedToken.name || "";
  const provider = decodedToken.firebase?.sign_in_provider || "unknown";

  // Parse name into first/last
  const nameParts = displayName.split(" ");
  const firstName = nameParts[0] || "Yaaro0";
  const lastName = nameParts.slice(1).join(" ") || "Member";

  try {
    let user: SelectedUser | null = null;

    // 1. Try to find user by Firebase UID (fastest, most reliable)
    user = await prisma.user.findUnique({
      where: { firebaseUid },
      select: userSelect,
    });

    // 2. If not found by UID, try to find by email (link existing account)
    if (!user && email) {
      const existingByEmail = await prisma.user.findUnique({
        where: { email },
        select: userSelect,
      });

      if (existingByEmail) {
        // Link the Firebase UID to existing account
        await prisma.user.update({
          where: { id: existingByEmail.id },
          data: {
            firebaseUid,
            emailVerified: true,
            ...(provider !== "password" ? { oauthProvider: provider } : {}),
          },
        });
        user = existingByEmail;
      }
    }

    // 3. If not found by email, try by phone
    if (!user && phone) {
      const existingByPhone = await prisma.user.findUnique({
        where: { phone },
        select: userSelect,
      });

      if (existingByPhone) {
        await prisma.user.update({
          where: { id: existingByPhone.id },
          data: {
            firebaseUid,
            phoneVerifiedAt: new Date(),
          },
        });
        user = existingByPhone;
      }
    }

    // 4. If still no user found, create a new one
    if (!user) {
      user = await prisma.user.create({
        data: {
          firebaseUid,
          email,
          phone,
          firstName,
          lastName,
          emailVerified: !!email,
          phoneVerifiedAt: phone ? new Date() : null,
          oauthProvider: provider !== "password" ? provider : null,
          oauthId: firebaseUid,
          onboardingCompleted: false,
        },
        select: userSelect,
      });
    }

    // 5. Check if account is active
    if (!user.isActive || user.isBanned || user.status !== "active") {
      return res.status(403).json({ success: false, message: "Account is suspended or banned." });
    }

    // 6. Create session (JWT + refresh token)
    const refreshToken = randomBytes(32).toString("base64url");
    const accessToken = createAccessToken(
      {
        sub: user.id.toString(),
        role: user.role,
        email: user.email,
        onboardingCompleted: user.onboardingCompleted,
      },
      env.jwtSecret,
    );

    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000), // 180 days
      },
    });

    // 7. Update last active
    await prisma.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date(), lastSeenAt: new Date() },
    });

    return res.json({
      success: true,
      message: "Authenticated successfully.",
      accessToken,
      refreshToken,
      user: {
        id: user.id.toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        emailVerified: user.emailVerified,
        onboardingCompleted: user.onboardingCompleted,
        role: user.role,
      },
      redirectTo: user.onboardingCompleted ? "/app/discover" : "/onboarding",
    });
  } catch (error) {
    console.error("Firebase login error:", error);
    return res.status(500).json({ success: false, message: "An error occurred during authentication." });
  }
}
