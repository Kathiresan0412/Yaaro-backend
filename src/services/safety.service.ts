import nodemailer from "nodemailer";
import type { Prisma } from "@prisma/client";
import { env } from "../config/env";

export function orderedPair(userId: bigint, otherUserId: bigint) {
  return {
    user1Id: userId < otherUserId ? userId : otherUserId,
    user2Id: userId < otherUserId ? otherUserId : userId,
  };
}

export async function notifyModerationTeam(report: {
  id: bigint;
  reporterId: bigint;
  reportedId: bigint;
  reason: string;
  description: string | null;
}) {
  const subject = `Yaaro0 report #${report.id.toString()}: ${report.reason}`;
  const text = [
    `Report: ${report.id.toString()}`,
    `Reporter: ${report.reporterId.toString()}`,
    `Reported user: ${report.reportedId.toString()}`,
    `Reason: ${report.reason}`,
    `Description: ${report.description || "No description provided."}`,
  ].join("\n");

  if (!env.smtpHost || !env.smtpUser || !env.smtpPassword || !env.mailFrom || !env.moderationAdminEmail) {
    console.log(`[moderation] ${subject}\n${text}`);
    return { sent: false, reason: "smtp-not-configured" as const };
  }

  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPassword,
    },
  });

  await transporter.sendMail({
    from: env.mailFrom,
    to: env.moderationAdminEmail,
    subject,
    text,
  });

  return { sent: true as const };
}

export function deactivatePairData(
  tx: Prisma.TransactionClient,
  userId: bigint,
  otherUserId: bigint,
) {
  const { user1Id, user2Id } = orderedPair(userId, otherUserId);

  return Promise.all([
    tx.match.updateMany({
      where: { user1Id, user2Id, isActive: true },
      data: { isActive: false },
    }),
    tx.conversation.updateMany({
      where: {
        isActive: true,
        OR: [
          { user1Id, user2Id },
          { user1Id: user2Id, user2Id: user1Id },
        ],
      },
      data: { isActive: false },
    }),
  ]);
}
