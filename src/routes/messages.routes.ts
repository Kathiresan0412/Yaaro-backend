import { Router } from "express";
import multer from "multer";
import type { MessageType } from "@prisma/client";
import { prisma } from "../config/database";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.middleware";
import {
  createMessage,
  findAccessibleMessage,
  getConversationForMatch,
  markConversationRead,
  serializeMessage,
  setMessageReaction,
} from "../services/messaging.service";
import {
  isSupportedAudioUploadSource,
  isSupportedImageUploadSource,
  uploadChatMedia,
} from "../services/media.service";
import { assertSafeText } from "../services/content-safety.service";
import { notifyModerationTeam } from "../services/safety.service";
import { notifyUser, sendEmail } from "../services/notification.service";
import { isUserInMatchRoom } from "../socket";

export const messagesRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

messagesRouter.use(requireAuth);

function currentUserId(req: AuthenticatedRequest) {
  if (!req.auth?.userId) {
    throw new Error("Authenticated user missing.");
  }

  return req.auth.userId;
}

function parseLimit(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 1), 50) : 30;
}

function parseMessageType(value: unknown): MessageType | null {
  if (value === "text" || value === "photo" || value === "gif" || value === "voice" || value === "image") {
    return value;
  }

  return null;
}

function dataUriFromFile(file: Express.Multer.File) {
  return `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
}

function notificationBodyForMessage(type: MessageType, content: string) {
  if (type === "photo" || type === "image") {
    return "You received a photo.";
  }

  if (type === "gif") {
    return "You received a GIF.";
  }

  if (type === "voice") {
    return "You received a voice message.";
  }

  return content.slice(0, 120);
}

function scheduleUnreadMessageEmail(input: { userId: bigint; messageId: bigint; matchId: bigint; senderId: bigint }) {
  setTimeout(async () => {
    const message = await prisma.message.findFirst({
      where: { id: input.messageId, isRead: false },
      select: { id: true },
    });

    if (!message) {
      return;
    }

    await sendEmail(input.userId, "new_message", {
      matchId: input.matchId.toString(),
      senderId: input.senderId.toString(),
    });
  }, 5 * 60 * 1000).unref();
}

messagesRouter.get("/messages/:matchId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const matchId = BigInt(req.params.matchId);
    const limit = parseLimit(req.query.limit);
    const cursor = typeof req.query.cursor === "string" && req.query.cursor ? BigInt(req.query.cursor) : null;
    const conversation = await getConversationForMatch(userId, matchId);

    if (!conversation) {
      return res.status(404).json({ success: false, message: "Match not found." });
    }

    const messages = await prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        ...(cursor ? { id: { lt: cursor } } : {}),
        OR: [
          { senderId: userId, isDeletedBySender: false },
          { senderId: { not: userId }, isDeletedByReceiver: false },
        ],
      },
      orderBy: { id: "desc" },
      take: limit + 1,
      include: { conversation: { select: { matchId: true } } },
    });

    const page = messages.slice(0, limit);
    const nextCursor = messages.length > limit ? page[page.length - 1]?.id.toString() ?? null : null;

    res.json({
      success: true,
      messages: page.map((message) => serializeMessage(message, userId)),
      nextCursor,
    });
  } catch (error) {
    next(error);
  }
});

messagesRouter.post("/messages/:matchId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const matchId = BigInt(req.params.matchId);
    const type = parseMessageType(req.body.type || req.body.message_type || "text");
    const content = typeof req.body.content === "string" ? req.body.content.trim() : "";
    const mediaInput =
      typeof req.body.mediaUrl === "string"
        ? req.body.mediaUrl
        : typeof req.body.media_url === "string"
          ? req.body.media_url
          : typeof req.body.gifUrl === "string"
            ? req.body.gifUrl
            : typeof req.body.gif_url === "string"
              ? req.body.gif_url
              : "";

    if (!type) {
      return res.status(400).json({ success: false, message: "Message type is invalid." });
    }

    if (type === "text" && !content) {
      return res.status(400).json({ success: false, message: "Message text is required." });
    }

    if (type === "text") {
      assertSafeText(content, "Message");
    }

    if ((type === "photo" || type === "image") && (!mediaInput || !isSupportedImageUploadSource(mediaInput))) {
      return res.status(400).json({ success: false, message: "A valid photo URL or image upload is required." });
    }

    if (type === "gif" && !/^https?:\/\//i.test(mediaInput)) {
      return res.status(400).json({ success: false, message: "A GIF URL is required." });
    }

    const mediaUrl =
      type === "photo" || type === "image"
        ? (await uploadChatMedia(mediaInput, userId, "image")).secure_url
        : type === "gif"
          ? mediaInput
          : null;
    const created = await createMessage({
      userId,
      matchId,
      type,
      content,
      mediaUrl,
    });

    if (!created) {
      return res.status(404).json({ success: false, message: "Match not found." });
    }

    const receiverId = created.conversation.user1Id === userId ? created.conversation.user2Id : created.conversation.user1Id;
    if (!isUserInMatchRoom(receiverId, created.conversation.matchId)) {
      await notifyUser({
        userId: receiverId,
        type: "new_message",
        title: "New message",
        body: notificationBodyForMessage(type, content),
        data: {
          matchId: created.conversation.matchId.toString(),
          senderId: userId.toString(),
          url: `/app/messages/${created.conversation.matchId.toString()}`,
        },
        push: true,
      });
    }
    scheduleUnreadMessageEmail({
      userId: receiverId,
      messageId: created.message.id,
      matchId: created.conversation.matchId,
      senderId: userId,
    });

    res.status(201).json({ success: true, message: serializeMessage(created.message, userId) });
  } catch (error) {
    next(error);
  }
});

messagesRouter.post(
  "/messages/:matchId/voice",
  upload.single("voice"),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = currentUserId(req);
      const matchId = BigInt(req.params.matchId);
      const bodySource = typeof req.body.audioData === "string" ? req.body.audioData : "";
      const source = req.file ? dataUriFromFile(req.file) : bodySource;
      const durationSeconds = Number.isFinite(Number(req.body.durationSeconds))
        ? Math.max(0, Math.round(Number(req.body.durationSeconds)))
        : null;

      if (!source || !isSupportedAudioUploadSource(source)) {
        return res.status(400).json({ success: false, message: "A valid voice note is required." });
      }

      const uploadResult = await uploadChatMedia(source, userId, "auto");
      const created = await createMessage({
        userId,
        matchId,
        type: "voice",
        mediaUrl: uploadResult.secure_url,
        durationSeconds,
      });

      if (!created) {
        return res.status(404).json({ success: false, message: "Match not found." });
      }

      const receiverId = created.conversation.user1Id === userId ? created.conversation.user2Id : created.conversation.user1Id;
      if (!isUserInMatchRoom(receiverId, created.conversation.matchId)) {
        await notifyUser({
          userId: receiverId,
          type: "new_message",
          title: "New voice message",
          body: "You received a voice message.",
          data: {
            matchId: created.conversation.matchId.toString(),
            senderId: userId.toString(),
            url: `/app/messages/${created.conversation.matchId.toString()}`,
          },
          push: true,
        });
      }
      scheduleUnreadMessageEmail({
        userId: receiverId,
        messageId: created.message.id,
        matchId: created.conversation.matchId,
        senderId: userId,
      });

      res.status(201).json({ success: true, message: serializeMessage(created.message, userId) });
    } catch (error) {
      next(error);
    }
  },
);

messagesRouter.delete("/messages/:messageId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const messageId = BigInt(req.params.messageId);
    const message = await findAccessibleMessage(messageId, userId);

    if (!message) {
      return res.status(404).json({ success: false, message: "Message not found." });
    }

    const data =
      message.senderId === userId ? { isDeletedBySender: true } : { isDeletedByReceiver: true };
    const updated = await prisma.message.update({
      where: { id: message.id },
      data,
      include: { conversation: { select: { matchId: true } } },
    });

    res.json({ success: true, message: serializeMessage(updated, userId) });
  } catch (error) {
    next(error);
  }
});

messagesRouter.post("/messages/:messageId/react", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const messageId = BigInt(req.params.messageId);
    const emoji = typeof req.body.emoji === "string" ? req.body.emoji : "";
    const updated = await setMessageReaction(messageId, userId, emoji);

    if (!updated) {
      return res.status(404).json({ success: false, message: "Message not found." });
    }

    res.json({ success: true, message: serializeMessage(updated, userId) });
  } catch (error) {
    next(error);
  }
});

messagesRouter.post("/messages/:messageId/read", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const messageId = BigInt(req.params.messageId);
    const message = await findAccessibleMessage(messageId, userId);

    if (!message) {
      return res.status(404).json({ success: false, message: "Message not found." });
    }

    const readAt = await markConversationRead(message.conversation, userId, message.id);
    res.json({ success: true, messageId: message.id.toString(), readAt: readAt.toISOString() });
  } catch (error) {
    next(error);
  }
});

messagesRouter.post("/messages/:messageId/report", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const messageId = BigInt(req.params.messageId);
    const reason = typeof req.body.reason === "string" ? req.body.reason.slice(0, 120) : "other";
    const description = typeof req.body.description === "string" ? req.body.description.trim().slice(0, 2000) : null;
    const message = await findAccessibleMessage(messageId, userId);

    if (!message) {
      return res.status(404).json({ success: false, message: "Message not found." });
    }

    const reportedId =
      message.senderId === userId
        ? message.conversation.user1Id === userId
          ? message.conversation.user2Id
          : message.conversation.user1Id
        : message.senderId;
    const reportReason = reason === "harassment" || reason === "spam" || reason === "scam" ? reason : "other";

    const report = await prisma.$transaction(async (tx) => {
      await tx.message.update({
        where: { id: message.id },
        data: { reportedAt: new Date(), reportedById: userId, reportReason: reason },
      });

      return tx.report.create({
        data: {
          reporterId: userId,
          reportedId,
          reason: reportReason,
          description: description || `Message report for message ${message.id.toString()}: ${reason}`,
        },
      });
    });

    notifyModerationTeam(report).catch((error) => {
      console.warn("Moderation report email failed.", error);
    });

    res.json({ success: true, reportId: report.id.toString() });
  } catch (error) {
    next(error);
  }
});
