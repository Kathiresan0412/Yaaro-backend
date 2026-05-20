import { Router } from "express";
import type { AdminRole, PhotoStatus, Prisma, ReportStatus, UserStatus } from "@prisma/client";
import { prisma } from "../config/database";
import { env } from "../config/env";
import { requireAdmin, requireAdminRole, type AdminAuthenticatedRequest } from "../middleware/admin-auth.middleware";
import { verifyPassword } from "../utils/password";
import { createAccessToken } from "../utils/token";
import { saveNotification, sendPush } from "../services/notification.service";

export const adminRouter = Router();

const userStatuses = new Set<UserStatus>(["active", "suspended", "banned", "deleted"]);
const reportStatuses = new Set<ReportStatus>(["pending", "reviewed", "action_taken", "dismissed"]);
const photoStatuses = new Set<PhotoStatus>(["pending", "approved", "rejected"]);

function parseBigInt(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    return null;
  }

  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function pageOptions(query: { page?: unknown; limit?: unknown }) {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit ?? 25) || 25));
  return { page, limit, skip: (page - 1) * limit };
}

function cleanString(value: unknown, max = 500) {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function serializeUser(user: {
  id: bigint;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  status: UserStatus;
  isActive: boolean;
  isBanned: boolean;
  suspendUntil?: Date | null;
  emailVerified: boolean;
  onboardingCompleted: boolean;
  createdAt: Date;
  lastActiveAt: Date | null;
  profile?: { gender: string; isVerified: boolean; country: string; city: string | null } | null;
  onboardingProfile?: { displayName: string | null } | null;
  subscriptions?: { id: bigint; endsAt: Date; plan: { name: string; slug: string } }[];
}) {
  const subscription = user.subscriptions?.[0] ?? null;

  return {
    id: user.id.toString(),
    email: user.email,
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: user.onboardingProfile?.displayName ?? [user.firstName, user.lastName].filter(Boolean).join(" "),
    status: user.status,
    isActive: user.isActive,
    isBanned: user.isBanned,
    suspendUntil: user.suspendUntil?.toISOString() ?? null,
    emailVerified: user.emailVerified,
    onboardingCompleted: user.onboardingCompleted,
    gender: user.profile?.gender ?? null,
    isVerified: user.profile?.isVerified ?? false,
    country: user.profile?.country ?? null,
    city: user.profile?.city ?? null,
    premium: subscription ? { id: subscription.id.toString(), plan: subscription.plan, endsAt: subscription.endsAt.toISOString() } : null,
    createdAt: user.createdAt.toISOString(),
    lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
  };
}

function settingValue(setting: { value: string | null; type: string }) {
  if (setting.type === "integer") {
    return Number(setting.value ?? 0);
  }
  if (setting.type === "boolean") {
    return setting.value === "true";
  }
  if (setting.type === "json") {
    try {
      return JSON.parse(setting.value ?? "null");
    } catch {
      return null;
    }
  }
  return setting.value ?? "";
}

async function logAudit(
  req: AdminAuthenticatedRequest,
  action: string,
  targetType: string,
  targetId: string | null,
  description: string,
  metadata: Prisma.InputJsonValue = {},
) {
  await prisma.adminAuditLog.create({
    data: {
      adminId: req.admin?.adminId,
      action,
      targetType,
      targetId,
      description,
      metadata,
      ipAddress: req.ip,
    },
  });
}

adminRouter.post("/auth/login", async (req, res, next) => {
  try {
    const email = cleanString(req.body.email, 255)?.toLowerCase();
    const password = cleanString(req.body.password, 255);

    if (!email || !password || !env.adminJwtSecret) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    const admin = await prisma.admin.findUnique({ where: { email } });

    if (!admin || !admin.isActive || !verifyPassword(password, admin.passwordHash)) {
      return res.status(401).json({ success: false, message: "Invalid admin credentials." });
    }

    const token = createAccessToken(
      { sub: admin.id.toString(), role: admin.role, email: admin.email },
      env.adminJwtSecret,
    );

    await prisma.adminAuditLog.create({
      data: {
        adminId: admin.id,
        action: "admin.login",
        targetType: "admin",
        targetId: admin.id.toString(),
        description: "Admin signed in",
        ipAddress: req.ip,
      },
    });

    return res.json({
      success: true,
      token,
      admin: {
        id: admin.id.toString(),
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (error) {
    return next(error);
  }
});

adminRouter.use(requireAdmin);

adminRouter.get("/dashboard", async (_req, res, next) => {
  try {
    const today = startOfToday();
    const sevenDaysAgo = dateDaysAgo(7);
    const thirtyDaysAgo = dateDaysAgo(30);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [
      totalUsers,
      active7d,
      active30d,
      newToday,
      newWeek,
      totalMatches,
      messagesToday,
      pendingReports,
      verifiedUsers,
      premiumUsers,
      revenue,
      dailySignups,
      genderRows,
      dailyActiveRows,
    ] = await Promise.all([
      prisma.user.count({ where: { role: "user" } }),
      prisma.user.count({ where: { role: "user", lastActiveAt: { gte: sevenDaysAgo } } }),
      prisma.user.count({ where: { role: "user", lastActiveAt: { gte: thirtyDaysAgo } } }),
      prisma.user.count({ where: { role: "user", createdAt: { gte: today } } }),
      prisma.user.count({ where: { role: "user", createdAt: { gte: sevenDaysAgo } } }),
      prisma.match.count(),
      prisma.message.count({ where: { createdAt: { gte: today } } }),
      prisma.report.count({ where: { status: "pending" } }),
      prisma.profile.count({ where: { isVerified: true } }),
      prisma.subscription.count({ where: { status: "active", endsAt: { gt: new Date() } } }),
      prisma.payment.aggregate({
        where: { status: "completed", paidAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
        SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::bigint AS count
        FROM users
        WHERE role = 'user' AND created_at >= ${thirtyDaysAgo}
        GROUP BY day
        ORDER BY day ASC
      `,
      prisma.profile.groupBy({ by: ["gender"], _count: { gender: true } }),
      prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
        SELECT date_trunc('day', last_active_at)::date AS day, COUNT(*)::bigint AS count
        FROM users
        WHERE role = 'user' AND last_active_at >= ${thirtyDaysAgo}
        GROUP BY day
        ORDER BY day ASC
      `,
    ]);

    res.json({
      success: true,
      dashboard: {
        totalUsers,
        active7d,
        active30d,
        newToday,
        newWeek,
        totalMatches,
        messagesToday,
        pendingReports,
        verifiedUsers,
        premiumUsers,
        revenueMonth: Number(revenue._sum.amount ?? 0),
        dailySignups: dailySignups.map((row) => ({ date: row.day.toISOString().slice(0, 10), count: Number(row.count) })),
        genderBreakdown: genderRows.map((row) => ({ gender: row.gender, count: row._count.gender })),
        dailyActiveUsers: dailyActiveRows.map((row) => ({ date: row.day.toISOString().slice(0, 10), count: Number(row.count) })),
      },
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/users", async (req, res, next) => {
  try {
    const { page, limit, skip } = pageOptions(req.query);
    const now = new Date();
    const where: Prisma.UserWhereInput = { role: "user" };
    const profileWhere: Prisma.ProfileWhereInput = {};
    const search = cleanString(req.query.search, 120);

    if (typeof req.query.status === "string" && userStatuses.has(req.query.status as UserStatus)) {
      where.status = req.query.status as UserStatus;
    }
    if (typeof req.query.gender === "string") {
      profileWhere.gender = req.query.gender as Prisma.EnumGenderFilter<"Profile">;
    }
    if (typeof req.query.verified === "string") {
      profileWhere.isVerified = req.query.verified === "true";
    }
    if (typeof req.query.premium === "string") {
      const premiumWhere = { some: { status: "active" as const, endsAt: { gt: now } } };
      where.subscriptions = req.query.premium === "true" ? premiumWhere : { none: premiumWhere.some };
    }
    if (search) {
      where.OR = [
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { onboardingProfile: { is: { displayName: { contains: search, mode: "insensitive" } } } },
      ];
    }
    if (Object.keys(profileWhere).length > 0) {
      where.profile = { is: profileWhere };
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          profile: { select: { gender: true, isVerified: true, country: true, city: true } },
          onboardingProfile: { select: { displayName: true } },
          subscriptions: {
            where: { status: "active", endsAt: { gt: now } },
            take: 1,
            orderBy: { endsAt: "desc" },
            include: { plan: { select: { name: true, slug: true } } },
          },
        },
      }),
    ]);

    res.json({ success: true, page, limit, total, users: users.map(serializeUser) });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/users/:id", async (req, res, next) => {
  try {
    const id = parseBigInt(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Invalid user id." });
    }

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        profile: true,
        onboardingProfile: true,
        hobbies: true,
        onboardingPhotos: { orderBy: [{ isPrimary: "desc" }, { orderIndex: "asc" }] },
        photos: { orderBy: [{ isPrimary: "desc" }, { displayOrder: "asc" }] },
        location: true,
        discoveryPreference: true,
        subscriptions: { include: { plan: true }, orderBy: { endsAt: "desc" } },
        payments: { orderBy: { createdAt: "desc" }, take: 20 },
        reportsMade: { orderBy: { createdAt: "desc" }, take: 20 },
        reportsReceived: { orderBy: { createdAt: "desc" }, take: 20 },
        verifications: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    res.json({
      success: true,
      user: {
        ...serializeUser({ ...user, subscriptions: user.subscriptions }),
        profile: user.profile,
        onboardingProfile: user.onboardingProfile,
        hobbies: user.hobbies.map((hobby) => hobby.hobby),
        onboardingPhotos: user.onboardingPhotos.map((photo) => ({ ...photo, id: photo.id.toString(), userId: photo.userId.toString(), createdAt: photo.createdAt.toISOString() })),
        photos: user.photos.map((photo) => ({ ...photo, id: photo.id.toString(), userId: photo.userId.toString(), reviewedBy: photo.reviewedBy?.toString() ?? null, createdAt: photo.createdAt.toISOString(), updatedAt: photo.updatedAt.toISOString(), reviewedAt: photo.reviewedAt?.toISOString() ?? null })),
        location: user.location,
        preferences: user.discoveryPreference,
        subscriptions: user.subscriptions.map((sub) => ({ ...sub, id: sub.id.toString(), userId: sub.userId.toString(), planId: sub.planId.toString(), startsAt: sub.startsAt.toISOString(), endsAt: sub.endsAt.toISOString(), createdAt: sub.createdAt.toISOString(), updatedAt: sub.updatedAt.toISOString(), cancelledAt: sub.cancelledAt?.toISOString() ?? null })),
        payments: user.payments.map((payment) => ({ ...payment, id: payment.id.toString(), userId: payment.userId.toString(), planId: payment.planId.toString(), subscriptionId: payment.subscriptionId?.toString() ?? null, amount: Number(payment.amount), createdAt: payment.createdAt.toISOString(), updatedAt: payment.updatedAt.toISOString(), paidAt: payment.paidAt?.toISOString() ?? null })),
        reportsMade: user.reportsMade.map((report) => ({ ...report, id: report.id.toString(), reporterId: report.reporterId.toString(), reportedId: report.reportedId.toString(), reviewedBy: report.reviewedBy?.toString() ?? null, createdAt: report.createdAt.toISOString(), reviewedAt: report.reviewedAt?.toISOString() ?? null })),
        reportsReceived: user.reportsReceived.map((report) => ({ ...report, id: report.id.toString(), reporterId: report.reporterId.toString(), reportedId: report.reportedId.toString(), reviewedBy: report.reviewedBy?.toString() ?? null, createdAt: report.createdAt.toISOString(), reviewedAt: report.reviewedAt?.toISOString() ?? null })),
        verifications: user.verifications.map((verification) => ({ ...verification, id: verification.id.toString(), userId: verification.userId.toString(), reviewedBy: verification.reviewedBy?.toString() ?? null, createdAt: verification.createdAt.toISOString(), updatedAt: verification.updatedAt.toISOString(), reviewedAt: verification.reviewedAt?.toISOString() ?? null, photoVerifiedAt: verification.photoVerifiedAt?.toISOString() ?? null, idVerifiedAt: verification.idVerifiedAt?.toISOString() ?? null })),
      },
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/users/:id/status", requireAdminRole("moderator"), async (req: AdminAuthenticatedRequest, res, next) => {
  try {
    const id = parseBigInt(req.params.id);
    const status = cleanString(req.body.status, 40) as UserStatus | null;
    const suspendUntilRaw = cleanString(req.body.suspendUntil ?? req.body.suspend_until, 80);
    const reason = cleanString(req.body.reason, 500);

    if (!id || !status || !userStatuses.has(status)) {
      return res.status(400).json({ success: false, message: "Valid user id and status are required." });
    }

    const suspendUntil = status === "suspended" && suspendUntilRaw ? new Date(suspendUntilRaw) : null;
    if (status === "suspended" && (!suspendUntil || Number.isNaN(suspendUntil.getTime()))) {
      return res.status(400).json({ success: false, message: "suspendUntil is required for suspended users." });
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        status,
        suspendUntil,
        isActive: status !== "deleted",
        isBanned: status === "banned",
        banReason: status === "banned" ? reason : null,
      },
      select: { id: true, status: true, isActive: true, isBanned: true, suspendUntil: true },
    });

    await logAudit(req, "user.status.update", "user", user.id.toString(), `Set user status to ${status}`, { status, reason, suspendUntil: suspendUntil?.toISOString() ?? null });

    res.json({ success: true, user: { ...user, id: user.id.toString(), suspendUntil: user.suspendUntil?.toISOString() ?? null } });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/reports", async (req, res, next) => {
  try {
    const { page, limit, skip } = pageOptions(req.query);
    const status = typeof req.query.status === "string" && reportStatuses.has(req.query.status as ReportStatus)
      ? req.query.status as ReportStatus
      : undefined;
    const where: Prisma.ReportWhereInput = status ? { status } : {};

    const [total, reports] = await Promise.all([
      prisma.report.count({ where }),
      prisma.report.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ status: "asc" }, { createdAt: "asc" }],
        include: {
          reporter: { select: { id: true, email: true, firstName: true, lastName: true } },
          reported: { select: { id: true, email: true, firstName: true, lastName: true, status: true } },
        },
      }),
    ]);

    res.json({
      success: true,
      page,
      limit,
      total,
      reports: reports.map((report) => ({
        ...report,
        id: report.id.toString(),
        reporterId: report.reporterId.toString(),
        reportedId: report.reportedId.toString(),
        reviewedBy: report.reviewedBy?.toString() ?? null,
        createdAt: report.createdAt.toISOString(),
        reviewedAt: report.reviewedAt?.toISOString() ?? null,
        reporter: { ...report.reporter, id: report.reporter.id.toString() },
        reported: { ...report.reported, id: report.reported.id.toString() },
      })),
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/reports/:id", requireAdminRole("moderator"), async (req: AdminAuthenticatedRequest, res, next) => {
  try {
    const id = parseBigInt(req.params.id);
    const status = cleanString(req.body.status, 40) as ReportStatus | null;
    const actionTaken = cleanString(req.body.actionTaken ?? req.body.action_taken ?? req.body.action, 255);

    if (!id || !status || !reportStatuses.has(status)) {
      return res.status(400).json({ success: false, message: "Valid report id and status are required." });
    }

    const report = await prisma.$transaction(async (tx) => {
      const updated = await tx.report.update({
        where: { id },
        data: {
          status,
          actionTaken,
          reviewedAt: new Date(),
        },
      });

      if (actionTaken === "ban") {
        await tx.user.update({
          where: { id: updated.reportedId },
          data: { status: "banned", isBanned: true, banReason: `Report #${updated.id.toString()}` },
        });
      }

      return updated;
    });

    await logAudit(req, "report.review", "report", report.id.toString(), `Reviewed report with status ${status}`, { status, actionTaken });
    res.json({ success: true, report: { ...report, id: report.id.toString(), reporterId: report.reporterId.toString(), reportedId: report.reportedId.toString(), reviewedBy: report.reviewedBy?.toString() ?? null, createdAt: report.createdAt.toISOString(), reviewedAt: report.reviewedAt?.toISOString() ?? null } });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/photos/pending", async (req, res, next) => {
  try {
    const { page, limit, skip } = pageOptions(req.query);
    const [onboardingPhotos, profilePhotos] = await Promise.all([
      prisma.userPhoto.findMany({
        where: { status: "pending" },
        skip,
        take: limit,
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      }),
      prisma.profilePhoto.findMany({
        where: { status: "pending" },
        skip,
        take: limit,
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      }),
    ]);

    res.json({
      success: true,
      photos: [
        ...onboardingPhotos.map((photo) => ({
          id: photo.id.toString(),
          source: "onboarding",
          userId: photo.userId.toString(),
          url: photo.url,
          status: photo.status,
          createdAt: photo.createdAt.toISOString(),
          user: { ...photo.user, id: photo.user.id.toString() },
        })),
        ...profilePhotos.map((photo) => ({
          id: photo.id.toString(),
          source: "profile",
          userId: photo.userId.toString(),
          url: photo.photoUrl,
          thumbnailUrl: photo.thumbnailUrl,
          status: photo.status,
          createdAt: photo.createdAt.toISOString(),
          user: { ...photo.user, id: photo.user.id.toString() },
        })),
      ].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, limit),
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/photos/:id", requireAdminRole("moderator"), async (req: AdminAuthenticatedRequest, res, next) => {
  try {
    const id = parseBigInt(req.params.id);
    const status = cleanString(req.body.status, 40) as PhotoStatus | null;
    const source = cleanString(req.body.source, 40) ?? "profile";
    const rejectionReason = cleanString(req.body.rejectionReason ?? req.body.rejection_reason, 255);

    if (!id || !status || !photoStatuses.has(status) || status === "pending") {
      return res.status(400).json({ success: false, message: "Valid photo id and moderation status are required." });
    }

    const photo = source === "onboarding"
      ? await prisma.userPhoto.update({ where: { id }, data: { status }, select: { id: true, userId: true, status: true } })
      : await prisma.profilePhoto.update({
        where: { id },
        data: { status, rejectionReason, reviewedAt: new Date() },
        select: { id: true, userId: true, status: true },
      });

    await logAudit(req, "photo.moderate", "photo", `${source}:${photo.id.toString()}`, `Set photo status to ${status}`, { status, source, rejectionReason });
    res.json({ success: true, photo: { ...photo, id: photo.id.toString(), userId: photo.userId.toString() } });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/settings", async (_req, res, next) => {
  try {
    const settings = await prisma.setting.findMany({ orderBy: { key: "asc" } });
    res.json({
      success: true,
      settings: settings.map((setting) => ({
        id: setting.id.toString(),
        key: setting.key,
        value: settingValue(setting),
        rawValue: setting.value,
        type: setting.type,
        description: setting.description,
        updatedAt: setting.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.put("/settings", requireAdminRole("super_admin"), async (req: AdminAuthenticatedRequest, res, next) => {
  try {
    const entries = Array.isArray(req.body.settings) ? req.body.settings : Object.entries(req.body).map(([key, value]) => ({ key, value }));
    const saved = [];

    for (const entry of entries) {
      const key = cleanString(entry.key, 255);
      if (!key) {
        continue;
      }
      const value = entry.value;
      const type = typeof value === "boolean" ? "boolean" : Number.isInteger(value) ? "integer" : typeof value === "object" ? "json" : "string";
      const rawValue = type === "json" ? JSON.stringify(value) : String(value);

      saved.push(await prisma.setting.upsert({
        where: { key },
        update: { value: rawValue, type },
        create: { key, value: rawValue, type },
      }));
    }

    await logAudit(req, "settings.update", "settings", null, "Updated app settings", { keys: saved.map((setting) => setting.key) });
    res.json({ success: true, settings: saved.map((setting) => ({ key: setting.key, value: settingValue(setting), type: setting.type })) });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/broadcast", requireAdminRole("moderator"), async (req: AdminAuthenticatedRequest, res, next) => {
  try {
    const title = cleanString(req.body.title, 160) ?? "Yaaro0 update";
    const body = cleanString(req.body.body ?? req.body.message, 500);
    const audience = cleanString(req.body.audience, 40) ?? "all";
    const country = cleanString(req.body.country, 120);
    const push = req.body.push !== false;

    if (!body) {
      return res.status(400).json({ success: false, message: "Broadcast message is required." });
    }

    const where: Prisma.UserWhereInput = { role: "user", status: "active", isActive: true, isBanned: false };
    if (audience === "premium") {
      where.subscriptions = { some: { status: "active", endsAt: { gt: new Date() } } };
    } else if (audience === "free") {
      where.subscriptions = { none: { status: "active", endsAt: { gt: new Date() } } };
    }
    if (country) {
      where.profile = { is: { country } };
    }

    const users = await prisma.user.findMany({ where, select: { id: true }, take: 5000 });
    let pushSent = 0;

    await Promise.all(users.map(async (user) => {
      await saveNotification(user.id, "broadcast", title, body, { audience, country });
      if (push) {
        const result = await sendPush(user.id, title, body, { type: "broadcast" });
        pushSent += result.sent;
      }
    }));

    await logAudit(req, "broadcast.send", "broadcast", null, `Sent broadcast to ${users.length} users`, { audience, country, push });
    res.json({ success: true, matchedUsers: users.length, pushSent });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/audit-log", async (req, res, next) => {
  try {
    const { page, limit, skip } = pageOptions(req.query);
    const [total, logs] = await Promise.all([
      prisma.adminAuditLog.count(),
      prisma.adminAuditLog.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: { admin: { select: { id: true, email: true, role: true } } },
      }),
    ]);

    res.json({
      success: true,
      page,
      limit,
      total,
      logs: logs.map((log) => ({
        ...log,
        id: log.id.toString(),
        adminId: log.adminId?.toString() ?? null,
        createdAt: log.createdAt.toISOString(),
        admin: log.admin ? { ...log.admin, id: log.admin.id.toString() } : null,
      })),
    });
  } catch (error) {
    next(error);
  }
});
