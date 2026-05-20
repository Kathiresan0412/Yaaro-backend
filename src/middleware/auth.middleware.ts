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

    const userId = BigInt(payload.sub);
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

    req.auth = { userId: user.id, role: user.role, email: user.email };
    return next();
  } catch (error) {
    return next(error);
  }
}
