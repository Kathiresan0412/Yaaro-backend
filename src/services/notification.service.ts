import sgMail from "@sendgrid/mail";
import type { Notification, Prisma } from "@prisma/client";
import webpush, { type PushSubscription as WebPushSubscription } from "web-push";
import { env } from "../config/env";
import { prisma } from "../config/database";

type NotificationEmitter = (userId: bigint, payload: SerializedNotification) => void;

let emitter: NotificationEmitter | null = null;
let sendGridConfigured = false;
let webPushConfigured = false;

export type NotificationType =
  | "new_match"
  | "new_message"
  | "liked_you"
  | "super_like"
  | "profile_view"
  | "boost_ended"
  | "match_expiry_warning"
  | "verification_approved"
  | "subscription_renewal"
  | "inactivity"
  | "broadcast";

export type SerializedNotification = {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data: Prisma.JsonValue | null;
  read: boolean;
  createdAt: string;
};

const defaultInAppPreferences = {
  new_match: true,
  new_message: true,
  liked_you: true,
  super_like: true,
  profile_view: true,
  boost_ended: true,
  match_expiry_warning: true,
  verification_approved: true,
};

const defaultEmailPreferences = {
  new_match: true,
  new_message: true,
  super_like: true,
  match_expiry_warning: true,
  verification_approved: true,
  subscription_renewal: true,
  inactivity: true,
};

function configureSendGrid() {
  if (!sendGridConfigured && env.sendgridApiKey) {
    sgMail.setApiKey(env.sendgridApiKey);
    sendGridConfigured = true;
  }
}

function configureWebPush() {
  if (!webPushConfigured && env.vapidPublicKey && env.vapidPrivateKey) {
    webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
    webPushConfigured = true;
  }
}

function enabledFromPreference(
  value: Prisma.JsonValue | null | undefined,
  type: string,
  defaults: Record<string, boolean>,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults[type] ?? true;
  }

  const setting = (value as Record<string, unknown>)[type];
  return typeof setting === "boolean" ? setting : defaults[type] ?? true;
}

function templateFor(templateId: string, data: Record<string, unknown>) {
  const appUrl = env.publicWebUrl.replace(/\/$/, "");
  const matchUrl = `${appUrl}/app/matches`;
  const messageUrl = data.matchId ? `${appUrl}/app/messages/${data.matchId}` : `${appUrl}/app/messages`;

  const templates: Record<string, { subject: string; html: string }> = {
    new_match: {
      subject: "It's a match on Yaro0",
      html: `<p>You matched with ${data.displayName || "someone new"}.</p><p><a href="${matchUrl}">Open your matches</a></p>`,
    },
    new_message: {
      subject: "You have a new message on Yaro0",
      html: `<p>${data.displayName || "Your match"} sent you a message.</p><p><a href="${messageUrl}">Open the chat</a></p>`,
    },
    super_like: {
      subject: "Someone sent you a Super Like",
      html: `<p>${data.displayName || "Someone"} sent you a Super Like.</p><p><a href="${appUrl}/app/discover">Open Yaro0</a></p>`,
    },
    match_expiry_warning: {
      subject: "Your match needs a reply",
      html: `<p>A match is waiting. Say hello before the conversation goes quiet.</p><p><a href="${matchUrl}">Open matches</a></p>`,
    },
    verification_approved: {
      subject: "Your Yaro0 profile is verified",
      html: "<p>Your verification has been approved. Your profile now shows the verified badge.</p>",
    },
    subscription_renewal: {
      subject: "Your Yaro0 subscription renewal",
      html: "<p>Your subscription renewal is coming up. Thanks for being part of Yaro0.</p>",
    },
    inactivity: {
      subject: "New people are waiting on Yaro0",
      html: `<p>You have fresh activity waiting.</p><p><a href="${appUrl}/app/discover">Open discovery</a></p>`,
    },
    weekly_recap: {
      subject: "Your weekly Yaro0 recap",
      html: `<p>You have ${data.likesCount || 0} new likes this week.</p><p><a href="${appUrl}/app/matches">See what's new</a></p>`,
    },
  };

  return templates[templateId] ?? {
    subject: "Yaro0 update",
    html: `<p>${data.body || "You have a new update on Yaro0."}</p>`,
  };
}

export function setNotificationEmitter(nextEmitter: NotificationEmitter) {
  emitter = nextEmitter;
}

export function serializeNotification(notification: Notification): SerializedNotification {
  return {
    id: notification.id.toString(),
    userId: notification.userId.toString(),
    type: notification.type,
    title: notification.title,
    body: notification.body,
    data: notification.data,
    read: notification.read,
    createdAt: notification.createdAt.toISOString(),
  };
}

export async function saveNotification(
  userId: bigint,
  type: NotificationType,
  title: string,
  body: string,
  data: Prisma.InputJsonValue = {},
) {
  const preference = await prisma.userPreference.findUnique({
    where: { userId },
    select: { notificationTypes: true },
  });

  if (!enabledFromPreference(preference?.notificationTypes, type, defaultInAppPreferences)) {
    return null;
  }

  const notification = await prisma.notification.create({
    data: { userId, type, title, body, data },
  });
  const serialized = serializeNotification(notification);
  emitter?.(userId, serialized);
  return notification;
}

export async function sendPush(userId: bigint, title: string, body: string, data: Record<string, unknown> = {}) {
  configureWebPush();

  if (!webPushConfigured) {
    return { sent: 0, skipped: true };
  }

  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });
  let sent = 0;

  await Promise.all(
    subscriptions.map(async (subscription) => {
      const pushSubscription: WebPushSubscription = {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      };

      try {
        await webpush.sendNotification(
          pushSubscription,
          JSON.stringify({ title, body, data, icon: "/brand-assets/logo.png" }),
        );
        sent += 1;
      } catch (error) {
        const statusCode = typeof error === "object" && error && "statusCode" in error
          ? Number((error as { statusCode?: number }).statusCode)
          : 0;

        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: subscription.id } }).catch(() => undefined);
        } else {
          console.warn("Push notification failed.", error);
        }
      }
    }),
  );

  return { sent, skipped: false };
}

export async function sendEmail(userId: bigint, templateId: string, data: Record<string, unknown> = {}) {
  configureSendGrid();

  if (!sendGridConfigured || !env.sendgridFromEmail) {
    return { sent: false, skipped: true };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, firstName: true, discoveryPreference: { select: { emailNotifications: true } } },
  });

  if (!user?.email) {
    return { sent: false, skipped: true };
  }

  if (!enabledFromPreference(user.discoveryPreference?.emailNotifications, templateId, defaultEmailPreferences)) {
    return { sent: false, skipped: true };
  }

  const template = templateFor(templateId, { firstName: user.firstName, ...data });
  await sgMail.send({
    to: user.email,
    from: env.sendgridFromEmail,
    subject: template.subject,
    html: template.html,
  });

  return { sent: true, skipped: false };
}

export async function notifyUser(input: {
  userId: bigint;
  type: NotificationType;
  title: string;
  body: string;
  data?: Prisma.InputJsonValue;
  push?: boolean;
  emailTemplateId?: string;
}) {
  const notification = await saveNotification(
    input.userId,
    input.type,
    input.title,
    input.body,
    input.data ?? {},
  );
  const data = input.data && typeof input.data === "object" && !Array.isArray(input.data)
    ? input.data as Record<string, unknown>
    : {};

  if (input.push) {
    sendPush(input.userId, input.title, input.body, data).catch((error) => {
      console.warn("Push notification failed.", error);
    });
  }

  if (input.emailTemplateId) {
    sendEmail(input.userId, input.emailTemplateId, data).catch((error) => {
      console.warn("Notification email failed.", error);
    });
  }

  return notification;
}
