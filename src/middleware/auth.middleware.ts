import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { prisma } from "../config/database";
import { verifyAccessToken } from "../utils/token";

export type AuthenticatedRequest = Request & {
  auth?: {
    userId: bigint;
    role: string;
    email: string | null;
  };
};

/**
 * In-memory auth cache to avoid a DB round-trip on every request.
 * Entries expire after 60 seconds so banned/deactivated users are caught within a minute.
 */
const authCache = new Map<string, { data: { id: bigint; email: string | null; role: string }; expiresAt: number }>();
const AUTH_CACHE_TTL_MS = 60_000;
const AUTH_CACHE_MAX = 2000;

function getCachedUser(userId: string) {
  const entry = authCache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    authCache.delete(userId);
    return null;
  }
  return entry.data;
}

function setCachedUser(userId: string, data: { id: bigint; email: string | null; role: string }) {
  // Evict oldest if at capacity
  if (authCache.size >= AUTH_CACHE_MAX) {
    const firstKey = authCache.keys().next().value;
    if (firstKey) authCache.delete(firstKey);
  }
  authCache.set(userId, { data, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
}

/** Call this when a user is banned/deactivated to immediately remove from cache */
export function evictAuthCache(userId: bigint | string) {
  authCache.delete(userId.toString());
}

function getBearerToken(req: Request) {
  const header = req.headers.authorization || "";

  if (!header.toLowerCase().startsWith("bearer ")) {
    return "";
  }

  return header.slice(7).trim();
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const token = getBearerToken(req);

    if (!token || !env.jwtSecret) {
      return res.status(401).json({ success: false, message: "Authentication is required." });
    }

    const payload = verifyAccessToken(token, env.jwtSecret);

    if (!payload) {
      return res.status(401).json({ success: false, message: "Session expired." });
    }

    if (!/^\d+$/.test(payload.sub)) {
      return res.status(401).json({ success: false, message: "Session expired." });
    }

    const userIdStr = payload.sub;

    // Check in-memory cache first – avoids DB call on every request
    const cached = getCachedUser(userIdStr);
    if (cached) {
      req.auth = { userId: cached.id, role: cached.role, email: cached.email };
      return next();
    }

    // Cache miss – hit DB
    const userId = BigInt(userIdStr);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        isActive: true,
        isBanned: true,
      },
    });

    if (!user || !user.isActive || user.isBanned || user.status !== "active") {
      return res.status(401).json({ success: false, message: "Account is not active." });
    }

    // Cache the result
    setCachedUser(userIdStr, { id: user.id, email: user.email, role: user.role });

    req.auth = { userId: user.id, role: user.role, email: user.email };
    return next();
  } catch (error) {
    return next(error);
  }
}
