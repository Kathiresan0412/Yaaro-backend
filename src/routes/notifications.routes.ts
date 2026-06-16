import { Router } from "express";
import { prisma } from "../config/database";
import { env } from "../config/env";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.middleware";
import { serializeNotification } from "../services/notification.service";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

function currentUserId(req: AuthenticatedRequest) {
  if (!req.auth?.userId) {
    throw new Error("Authenticated user missing.");
  }

  return req.auth.userId;
}

function notificationSettings(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, boolean>
    : {};
}

notificationsRouter.get("/notifications", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: [{ read: "asc" }, { createdAt: "desc" }],
        take: 50,
      }),
      prisma.notification.count({ where: { userId, read: false } }),
    ]);

    res.json({
      success: true,
      unreadCount,
      notifications: notifications.map(serializeNotification),
    });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.patch("/notifications/read", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const result = await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });

    res.json({ success: true, updatedCount: result.count });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.patch("/notifications/:id/read", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const id = BigInt(req.params.id);
    const notification = await prisma.notification.findFirst({ where: { id, userId } });

    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found." });
    }

    const updated = await prisma.notification.update({
      where: { id: notification.id },
      data: { read: true },
    });

    res.json({ success: true, notification: serializeNotification(updated) });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.post("/push/subscribe", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const endpoint = typeof req.body.endpoint === "string" ? req.body.endpoint.trim() : "";
    const keys = req.body.keys && typeof req.body.keys === "object" ? req.body.keys as Record<string, unknown> : {};
    const p256dh = typeof keys.p256dh === "string" ? keys.p256dh : "";
    const auth = typeof keys.auth === "string" ? keys.auth : "";

    if (!endpoint || !p256dh || !auth) {
      return res.status(400).json({ success: false, message: "A valid push subscription is required." });
    }

    const subscription = await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: {
        userId,
        p256dh,
        auth,
        userAgent: req.get("user-agent")?.slice(0, 500) ?? null,
      },
      create: {
        userId,
        endpoint,
        p256dh,
        auth,
        userAgent: req.get("user-agent")?.slice(0, 500) ?? null,
      },
    });

    res.status(201).json({
      success: true,
      subscription: { id: subscription.id.toString(), endpoint: subscription.endpoint },
      publicKey: env.vapidPublicKey || null,
    });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.delete("/push/subscribe", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const endpoint = typeof req.body.endpoint === "string" ? req.body.endpoint.trim() : "";

    if (!endpoint) {
      return res.status(400).json({ success: false, message: "Endpoint is required." });
    }

    await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.get("/push/public-key", (_req, res) => {
  res.json({ success: true, publicKey: env.vapidPublicKey || null });
});

// ---- Mobile FCM device token registration ----

notificationsRouter.post("/notifications/register-device", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const fcmToken = typeof req.body.fcmToken === "string" ? req.body.fcmToken.trim() : "";
    const platform = typeof req.body.platform === "string" ? req.body.platform.trim() : "android";

    if (!fcmToken) {
      return res.status(400).json({ success: false, message: "fcmToken is required." });
    }

    // Upsert: if this token already exists, update ownership (handles reinstalls/re-logins)
    await prisma.deviceToken.upsert({
      where: { token: fcmToken },
      update: { userId, platform },
      create: { userId, token: fcmToken, platform },
    });

    res.status(201).json({ success: true });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.delete("/notifications/unregister-device", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const fcmToken = typeof req.body.fcmToken === "string" ? req.body.fcmToken.trim() : "";

    if (!fcmToken) {
      return res.status(400).json({ success: false, message: "fcmToken is required." });
    }

    await prisma.deviceToken.deleteMany({ where: { userId, token: fcmToken } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.get("/settings/notifications", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const preferences = await prisma.userPreference.upsert({
      where: { userId },
      update: {},
      create: { userId },
      select: { notificationTypes: true, emailNotifications: true },
    });

    res.json({
      success: true,
      notificationTypes: notificationSettings(preferences.notificationTypes),
      emailNotifications: notificationSettings(preferences.emailNotifications),
    });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.patch("/settings/notifications", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const notificationTypes = notificationSettings(req.body.notificationTypes ?? req.body.notification_types);
    const emailNotifications = notificationSettings(req.body.emailNotifications ?? req.body.email_notifications);
    const preferences = await prisma.userPreference.upsert({
      where: { userId },
      update: { notificationTypes, emailNotifications },
      create: { userId, notificationTypes, emailNotifications },
      select: { notificationTypes: true, emailNotifications: true },
    });

    res.json({
      success: true,
      notificationTypes: notificationSettings(preferences.notificationTypes),
      emailNotifications: notificationSettings(preferences.emailNotifications),
    });
  } catch (error) {
    next(error);
  }
});
