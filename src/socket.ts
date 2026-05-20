import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type { MessageType } from "@prisma/client";
import { env } from "./config/env";
import { prisma } from "./config/database";
import { verifyAccessToken } from "./utils/token";
import {
  createMessage,
  findAccessibleMessage,
  getConversationForMatch,
  markConversationRead,
  serializeMessage,
  setMessageReaction,
} from "./services/messaging.service";
import { hasUnsafeContent } from "./services/content-safety.service";
import { notifyUser, sendEmail, setNotificationEmitter } from "./services/notification.service";

type Ack = (payload: Record<string, unknown>) => void;

const onlineUsers = new Map<string, number>();
const activeMatchRooms = new Map<string, Set<string>>();

function roomForMatch(matchId: bigint | string) {
  return `match:${matchId.toString()}`;
}

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

function parseMessageType(value: unknown): MessageType {
  return value === "photo" || value === "gif" || value === "voice" || value === "image" ? value : "text";
}

export function isUserInMatchRoom(userId: bigint, matchId: bigint) {
  return activeMatchRooms.get(userId.toString())?.has(matchId.toString()) ?? false;
}

function addActiveMatchRoom(userId: bigint, matchId: bigint) {
  const userKey = userId.toString();
  const rooms = activeMatchRooms.get(userKey) ?? new Set<string>();
  rooms.add(matchId.toString());
  activeMatchRooms.set(userKey, rooms);
}

function removeActiveMatchRoom(userId: bigint, matchId: bigint) {
  const rooms = activeMatchRooms.get(userId.toString());

  if (!rooms) {
    return;
  }

  rooms.delete(matchId.toString());

  if (rooms.size === 0) {
    activeMatchRooms.delete(userId.toString());
  }
}

function clearActiveMatchRooms(userId: bigint) {
  activeMatchRooms.delete(userId.toString());
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

export function attachSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: true,
      credentials: true,
    },
  });
  setNotificationEmitter((userId, payload) => {
    io.to(`user:${userId.toString()}`).emit("notification", payload);
  });

  io.use(async (socket, next) => {
    const token =
      typeof socket.handshake.auth.token === "string"
        ? socket.handshake.auth.token
        : typeof socket.handshake.query.token === "string"
          ? socket.handshake.query.token
          : "";
    const payload = env.jwtSecret ? verifyAccessToken(token, env.jwtSecret) : null;

    if (!payload) {
      return next(new Error("Authentication is required."));
    }

    const userId = BigInt(payload.sub);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, isActive: true, isBanned: true },
    });

    if (!user || !user.isActive || user.isBanned || user.status !== "active") {
      return next(new Error("Account is not active."));
    }

    socket.data.userId = user.id;
    return next();
  });

  io.on("connection", async (socket) => {
    const userId = socket.data.userId as bigint;
    const userKey = userId.toString();
    onlineUsers.set(userKey, (onlineUsers.get(userKey) ?? 0) + 1);
    socket.join(`user:${userKey}`);

    await prisma.user.update({ where: { id: userId }, data: { lastActiveAt: new Date() } }).catch(() => undefined);
    io.emit("presence_update", { userId: userKey, isOnline: true });

    socket.on("join_match", async (payload: { matchId?: string }, ack?: Ack) => {
      const matchId = parseBigInt(payload?.matchId);

      if (!matchId) {
        ack?.({ success: false, message: "Match id is invalid." });
        return;
      }

      const conversation = await getConversationForMatch(userId, matchId);

      if (!conversation) {
        ack?.({ success: false, message: "Match not found." });
        return;
      }

      socket.join(roomForMatch(matchId));
      addActiveMatchRoom(userId, matchId);
      const otherUserId = conversation.user1Id === userId ? conversation.user2Id : conversation.user1Id;
      ack?.({
        success: true,
        matchId: matchId.toString(),
        otherUserId: otherUserId.toString(),
        isOnline: onlineUsers.has(otherUserId.toString()),
      });
    });

    socket.on("leave_match", (payload: { matchId?: string }) => {
      const matchId = parseBigInt(payload?.matchId);

      if (matchId) {
        socket.leave(roomForMatch(matchId));
        removeActiveMatchRoom(userId, matchId);
      }
    });

    socket.on(
      "send_message",
      async (
        payload: {
          matchId?: string;
          content?: string;
          type?: string;
          mediaUrl?: string;
          durationSeconds?: number;
        },
        ack?: Ack,
      ) => {
        const matchId = parseBigInt(payload?.matchId);
        const type = parseMessageType(payload?.type);
        const content = typeof payload?.content === "string" ? payload.content.trim() : "";
        const mediaUrl = typeof payload?.mediaUrl === "string" ? payload.mediaUrl : null;

        if (!matchId) {
          ack?.({ success: false, message: "Match id is invalid." });
          return;
        }

        if (type === "text" && !content) {
          ack?.({ success: false, message: "Message text is required." });
          return;
        }

        if (type === "text" && hasUnsafeContent(content)) {
          ack?.({ success: false, status: 422, message: "Message contains language that is not allowed." });
          return;
        }

        const created = await createMessage({
          userId,
          matchId,
          type,
          content,
          mediaUrl,
          durationSeconds: Number.isFinite(payload?.durationSeconds) ? payload.durationSeconds ?? null : null,
        });

        if (!created) {
          ack?.({ success: false, message: "Match not found." });
          return;
        }

        const serializedForSender = serializeMessage(created.message, userId);
        const receiverId = created.conversation.user1Id === userId ? created.conversation.user2Id : created.conversation.user1Id;
        io.to(`user:${userKey}`).emit("new_message", serializedForSender);
        io.to(`user:${receiverId.toString()}`).emit("new_message", serializeMessage(created.message, receiverId));

        if (!isUserInMatchRoom(receiverId, matchId)) {
          await notifyUser({
            userId: receiverId,
            type: "new_message",
            title: "New message",
            body: content ? content.slice(0, 120) : "You received a new message.",
            data: { matchId: matchId.toString(), senderId: userKey, url: `/app/messages/${matchId.toString()}` },
            push: true,
          });
        }
        scheduleUnreadMessageEmail({
          userId: receiverId,
          messageId: created.message.id,
          matchId,
          senderId: userId,
        });

        ack?.({ success: true, message: serializedForSender });
      },
    );

    socket.on("mark_read", async (payload: { matchId?: string; messageId?: string }, ack?: Ack) => {
      const matchId = parseBigInt(payload?.matchId);
      const messageId = parseBigInt(payload?.messageId);

      if (!matchId) {
        ack?.({ success: false, message: "Match id is invalid." });
        return;
      }

      const conversation = await getConversationForMatch(userId, matchId);

      if (!conversation) {
        ack?.({ success: false, message: "Match not found." });
        return;
      }

      const readAt = await markConversationRead(conversation, userId, messageId ?? undefined);
      io.to(roomForMatch(matchId)).emit("message_read", {
        matchId: matchId.toString(),
        messageId: messageId?.toString() ?? null,
        readerId: userKey,
        readAt: readAt.toISOString(),
      });
      ack?.({ success: true, readAt: readAt.toISOString() });
    });

    socket.on("react_message", async (payload: { messageId?: string; emoji?: string }, ack?: Ack) => {
      const messageId = parseBigInt(payload?.messageId);
      const emoji = typeof payload?.emoji === "string" ? payload.emoji : "";

      if (!messageId) {
        ack?.({ success: false, message: "Message id is invalid." });
        return;
      }

      const updated = await setMessageReaction(messageId, userId, emoji);

      if (!updated) {
        ack?.({ success: false, message: "Message not found." });
        return;
      }

      const eventPayload = {
        messageId: updated.id.toString(),
        matchId: updated.conversation.matchId.toString(),
        userId: userKey,
        emoji,
        message: serializeMessage(updated, userId),
      };
      io.to(roomForMatch(updated.conversation.matchId)).emit("message_reaction", eventPayload);
      ack?.({ success: true, ...eventPayload });
    });

    socket.on("delete_message", async (payload: { messageId?: string }, ack?: Ack) => {
      const messageId = parseBigInt(payload?.messageId);

      if (!messageId) {
        ack?.({ success: false, message: "Message id is invalid." });
        return;
      }

      const message = await findAccessibleMessage(messageId, userId);

      if (!message) {
        ack?.({ success: false, message: "Message not found." });
        return;
      }

      const updated = await prisma.message.update({
        where: { id: message.id },
        data: message.senderId === userId ? { isDeletedBySender: true } : { isDeletedByReceiver: true },
        include: { conversation: { select: { matchId: true } } },
      });

      socket.emit("message_deleted", serializeMessage(updated, userId));
      ack?.({ success: true, message: serializeMessage(updated, userId) });
    });

    socket.on("disconnect", async () => {
      const count = Math.max((onlineUsers.get(userKey) ?? 1) - 1, 0);

      if (count > 0) {
        onlineUsers.set(userKey, count);
        return;
      }

      onlineUsers.delete(userKey);
      clearActiveMatchRooms(userId);
      await prisma.user.update({ where: { id: userId }, data: { lastActiveAt: new Date() } }).catch(() => undefined);
      io.emit("presence_update", { userId: userKey, isOnline: false });
    });
  });

  return io;
}
