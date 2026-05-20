import type { Message, MessageType } from "@prisma/client";
import { prisma } from "../config/database";

export type SerializedMessage = {
  id: string;
  matchId: string;
  conversationId: string;
  senderId: string;
  type: MessageType;
  content: string | null;
  mediaUrl: string | null;
  durationSeconds: number | null;
  reactions: { userId: string; emoji: string }[];
  isMine: boolean;
  isRead: boolean;
  readAt: string | null;
  isDeleted: boolean;
  createdAt: string;
};

type ConversationAccess = {
  id: bigint;
  matchId: bigint;
  user1Id: bigint;
  user2Id: bigint;
};

function normalizeReactions(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([userId, emoji]) => /^\d+$/.test(userId) && typeof emoji === "string" && emoji.trim().length > 0,
    ),
  ) as Record<string, string>;
}

export function serializeMessage(
  message: Message & { conversation: { matchId: bigint } },
  viewerId: bigint,
): SerializedMessage {
  const isMine = message.senderId === viewerId;
  const isDeleted = isMine ? message.isDeletedBySender : message.isDeletedByReceiver;
  const reactions = normalizeReactions(message.reactions);

  return {
    id: message.id.toString(),
    matchId: message.conversation.matchId.toString(),
    conversationId: message.conversationId.toString(),
    senderId: message.senderId.toString(),
    type: message.messageType,
    content: isDeleted ? null : message.content,
    mediaUrl: isDeleted ? null : message.mediaUrl,
    durationSeconds: isDeleted ? null : message.durationSeconds,
    reactions: Object.entries(reactions).map(([userId, emoji]) => ({ userId, emoji })),
    isMine,
    isRead: message.isRead,
    readAt: message.readAt?.toISOString() ?? null,
    isDeleted,
    createdAt: message.createdAt.toISOString(),
  };
}

export async function getConversationForMatch(userId: bigint, matchId: bigint) {
  const match = await prisma.match.findFirst({
    where: {
      id: matchId,
      isActive: true,
      OR: [{ user1Id: userId }, { user2Id: userId }],
    },
    select: { id: true, user1Id: true, user2Id: true },
  });

  if (!match) {
    return null;
  }

  const blocked = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: match.user1Id, blockedId: match.user2Id },
        { blockerId: match.user2Id, blockedId: match.user1Id },
      ],
    },
    select: { id: true },
  });

  if (blocked) {
    return null;
  }

  const existing = await prisma.conversation.findFirst({
    where: { matchId: match.id, isActive: true },
    select: { id: true, matchId: true, user1Id: true, user2Id: true },
  });

  if (existing) {
    return existing;
  }

  return prisma.conversation.create({
    data: {
      matchId: match.id,
      user1Id: match.user1Id,
      user2Id: match.user2Id,
    },
    select: { id: true, matchId: true, user1Id: true, user2Id: true },
  });
}

function previewFor(type: MessageType, content: string | null) {
  if (type === "photo" || type === "image") {
    return "Photo";
  }

  if (type === "gif") {
    return "GIF";
  }

  if (type === "voice") {
    return "Voice message";
  }

  return (content || "Message").slice(0, 255);
}

export async function createMessage(params: {
  userId: bigint;
  matchId: bigint;
  type: MessageType;
  content?: string | null;
  mediaUrl?: string | null;
  durationSeconds?: number | null;
}) {
  const conversation = await getConversationForMatch(params.userId, params.matchId);

  if (!conversation) {
    return null;
  }

  const now = new Date();
  const isSenderUser1 = conversation.user1Id === params.userId;
  const unreadField = isSenderUser1 ? "user2UnreadCount" : "user1UnreadCount";
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        conversationId: conversation.id,
        senderId: params.userId,
        messageType: params.type,
        content: params.content || null,
        mediaUrl: params.mediaUrl || null,
        durationSeconds: params.durationSeconds ?? null,
      },
      include: { conversation: { select: { matchId: true } } },
    });

    await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: now,
        lastMessagePreview: previewFor(params.type, params.content || null),
        [unreadField]: { increment: 1 },
      },
    });

    return created;
  });

  return { message, conversation };
}

export async function findAccessibleMessage(messageId: bigint, userId: bigint) {
  return prisma.message.findFirst({
    where: {
      id: messageId,
      conversation: {
        isActive: true,
        match: {
          isActive: true,
          OR: [{ user1Id: userId }, { user2Id: userId }],
        },
      },
    },
    include: { conversation: { select: { id: true, matchId: true, user1Id: true, user2Id: true } } },
  });
}

export async function markConversationRead(conversation: ConversationAccess, userId: bigint, throughMessageId?: bigint) {
  const now = new Date();
  const otherUserId = conversation.user1Id === userId ? conversation.user2Id : conversation.user1Id;
  const unreadField = conversation.user1Id === userId ? "user1UnreadCount" : "user2UnreadCount";
  const where = {
    conversationId: conversation.id,
    senderId: otherUserId,
    isRead: false,
    ...(throughMessageId ? { id: { lte: throughMessageId } } : {}),
  };

  await prisma.$transaction([
    prisma.message.updateMany({ where, data: { isRead: true, readAt: now } }),
    prisma.conversation.update({ where: { id: conversation.id }, data: { [unreadField]: 0 } }),
  ]);

  return now;
}

export async function setMessageReaction(messageId: bigint, userId: bigint, emoji: string) {
  const message = await findAccessibleMessage(messageId, userId);

  if (!message) {
    return null;
  }

  const reactions = normalizeReactions(message.reactions);
  const trimmedEmoji = emoji.trim().slice(0, 16);

  if (trimmedEmoji) {
    reactions[userId.toString()] = trimmedEmoji;
  } else {
    delete reactions[userId.toString()];
  }

  return prisma.message.update({
    where: { id: message.id },
    data: { reactions },
    include: { conversation: { select: { matchId: true } } },
  });
}
