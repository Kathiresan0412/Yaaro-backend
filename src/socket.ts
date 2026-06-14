import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type { MessageType } from "@prisma/client";
import { env } from "./config/env";
import { prisma } from "./config/database";
import { verifyAccessToken } from "./utils/token";
import {
  createMessage,
  findAccessibleMessage,
  getConversationByIdOrMatchId,
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

function emitMessageToUser(
  io: Server,
  userId: bigint | string,
  message: ReturnType<typeof serializeMessage>,
) {
  const room = `user:${userId.toString()}`;
  io.to(room).emit("new_message", message);
  io.to(room).emit("receive_message", message);
}

function scheduleUnreadMessageEmail(input: { userId: bigint; messageId: bigint; matchId: bigint; senderId: bigint }) {
  setTimeout(async () => {
    try {
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
    } catch (error) {
      console.error("Error sending scheduled unread message email (socket):", error);
    }
  }, 5 * 60 * 1000).unref();
}

function safeAsyncHandler(handler: (...args: any[]) => Promise<void>) {
  return async (...args: any[]) => {
    try {
      await handler(...args);
    } catch (error) {
      console.error("Socket handler error:", error);
      const ack = args[args.length - 1];
      if (typeof ack === "function") {
        try {
          ack({ success: false, message: "Internal server error." });
        } catch {}
      }
    }
  };
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

    socket.on("join_match", safeAsyncHandler(async (payload: { matchId?: string }, ack?: Ack) => {
      const matchId = parseBigInt(payload?.matchId);

      if (!matchId) {
        ack?.({ success: false, message: "Match id is invalid." });
        return;
      }

      const conversation = await getConversationByIdOrMatchId(userId, matchId);

      if (!conversation) {
        ack?.({ success: false, message: "Match not found." });
        return;
      }

      // Always join the room keyed by the actual matchId from the conversation
      const realMatchId = conversation.matchId;
      socket.join(roomForMatch(realMatchId));
      addActiveMatchRoom(userId, realMatchId);
      const otherUserId = conversation.user1Id === userId ? conversation.user2Id : conversation.user1Id;
      ack?.({
        success: true,
        matchId: realMatchId.toString(),
        otherUserId: otherUserId.toString(),
        isOnline: onlineUsers.has(otherUserId.toString()),
      });
    }));

    socket.on("leave_match", safeAsyncHandler(async (payload: { matchId?: string }) => {
      const matchId = parseBigInt(payload?.matchId);

      if (matchId) {
        // Resolve to actual matchId in case a conversationId was passed
        const conversation = await getConversationByIdOrMatchId(userId, matchId);
        const realMatchId = conversation?.matchId ?? matchId;
        socket.leave(roomForMatch(realMatchId));
        removeActiveMatchRoom(userId, realMatchId);
      }
    }));

    socket.on(
      "send_message",
      safeAsyncHandler(async (
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

        let created: Awaited<ReturnType<typeof createMessage>>;
        try {
          created = await createMessage({
            userId,
            matchId,
            type,
            content,
            mediaUrl,
            durationSeconds: Number.isFinite(payload?.durationSeconds) ? payload.durationSeconds ?? null : null,
          });
        } catch (error) {
          const status = typeof error === "object" && error && "status" in error
            ? Number((error as { status?: number }).status)
            : 500;
          ack?.({
            success: false,
            status,
            message: error instanceof Error ? error.message : "Message could not be sent.",
          });
          return;
        }

        if (!created) {
          ack?.({ success: false, message: "Match not found." });
          return;
        }

        const serializedForSender = serializeMessage(created.message, userId);
        const receiverId = created.conversation.user1Id === userId ? created.conversation.user2Id : created.conversation.user1Id;
        emitMessageToUser(io, userKey, serializedForSender);
        emitMessageToUser(io, receiverId, serializeMessage(created.message, receiverId));

        if (onlineUsers.has(receiverId.toString())) {
          io.to(`user:${userKey}`).emit("message_delivered", {
            matchId: matchId.toString(),
            messageId: created.message.id.toString(),
            deliveredTo: receiverId.toString(),
            deliveredAt: new Date().toISOString(),
          });
        }

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
      })
    );

    socket.on("typing_start", safeAsyncHandler(async (payload: { matchId?: string }, ack?: Ack) => {
      const matchId = parseBigInt(payload?.matchId);

      if (!matchId) {
        ack?.({ success: false, message: "Match id is invalid." });
        return;
      }

      const conversation = await getConversationByIdOrMatchId(userId, matchId);

      if (!conversation) {
        ack?.({ success: false, message: "Match not found." });
        return;
      }

      socket.to(roomForMatch(conversation.matchId)).emit("typing_start", {
        matchId: conversation.matchId.toString(),
        userId: userKey,
      });
      ack?.({ success: true });
    }));

    socket.on("typing_stop", safeAsyncHandler(async (payload: { matchId?: string }, ack?: Ack) => {
      const matchId = parseBigInt(payload?.matchId);

      if (!matchId) {
        ack?.({ success: false, message: "Match id is invalid." });
        return;
      }

      const conversation = await getConversationByIdOrMatchId(userId, matchId);

      if (!conversation) {
        ack?.({ success: false, message: "Match not found." });
        return;
      }

      socket.to(roomForMatch(conversation.matchId)).emit("typing_stop", {
        matchId: conversation.matchId.toString(),
        userId: userKey,
      });
      ack?.({ success: true });
    }));

    socket.on("mark_read", safeAsyncHandler(async (payload: { matchId?: string; messageId?: string }, ack?: Ack) => {
      const matchId = parseBigInt(payload?.matchId);
      const messageId = parseBigInt(payload?.messageId);

      if (!matchId) {
        ack?.({ success: false, message: "Match id is invalid." });
        return;
      }

      const conversation = await getConversationByIdOrMatchId(userId, matchId);

      if (!conversation) {
        ack?.({ success: false, message: "Match not found." });
        return;
      }

      const readAt = await markConversationRead(conversation, userId, messageId ?? undefined);
      io.to(roomForMatch(conversation.matchId)).emit("message_read", {
        matchId: conversation.matchId.toString(),
        messageId: messageId?.toString() ?? null,
        readerId: userKey,
        readAt: readAt.toISOString(),
      });
      ack?.({ success: true, readAt: readAt.toISOString() });
    }));

    socket.on("react_message", safeAsyncHandler(async (payload: { messageId?: string; emoji?: string }, ack?: Ack) => {
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
    }));

    socket.on("delete_message", safeAsyncHandler(async (payload: { messageId?: string }, ack?: Ack) => {
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
    }));

    socket.on("webrtc_signal", (payload: { to: string; type: string; sdp?: any; candidate?: any }) => {
      io.to(`user:${payload.to}`).emit("webrtc_signal", {
        from: userKey,
        type: payload.type,
        sdp: payload.sdp,
        candidate: payload.candidate,
      });
    });

    socket.on("disconnect", safeAsyncHandler(async () => {
      const count = Math.max((onlineUsers.get(userKey) ?? 1) - 1, 0);

      if (count > 0) {
        onlineUsers.set(userKey, count);
        return;
      }

      onlineUsers.delete(userKey);
      clearActiveMatchRooms(userId);
      await prisma.user.update({ where: { id: userId }, data: { lastActiveAt: new Date() } }).catch(() => undefined);
      io.emit("presence_update", { userId: userKey, isOnline: false });
    }));
  });

  return io;
}
