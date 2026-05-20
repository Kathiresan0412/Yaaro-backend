import type { AdminRole } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { prisma } from "../config/database";
import { verifyAccessToken } from "../utils/token";

export type AdminAuthenticatedRequest = Request & {
  admin?: {
    adminId: bigint;
    role: AdminRole;
    email: string;
  };
};

const roleRank: Record<AdminRole, number> = {
  analyst: 1,
  support: 2,
  moderator: 3,
  super_admin: 4,
};

function bearerToken(req: Request) {
  const header = req.headers.authorization || "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

export async function requireAdmin(
  req: AdminAuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  const token = bearerToken(req);

  if (!token || !env.adminJwtSecret) {
    return res.status(401).json({ success: false, message: "Admin authentication is required." });
  }

  const payload = verifyAccessToken(token, env.adminJwtSecret);

  if (!payload) {
    return res.status(401).json({ success: false, message: "Admin session expired." });
  }

  const admin = await prisma.admin.findUnique({
    where: { id: BigInt(payload.sub) },
    select: { id: true, email: true, role: true, isActive: true },
  });

  if (!admin || !admin.isActive) {
    return res.status(401).json({ success: false, message: "Admin account is inactive." });
  }

  req.admin = { adminId: admin.id, role: admin.role, email: admin.email };
  return next();
}

export function requireAdminRole(minimumRole: AdminRole) {
  return (req: AdminAuthenticatedRequest, res: Response, next: NextFunction) => {
    const role = req.admin?.role;

    if (!role || roleRank[role] < roleRank[minimumRole]) {
      return res.status(403).json({ success: false, message: "Insufficient admin permissions." });
    }

    return next();
  };
}
