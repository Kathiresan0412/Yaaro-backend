import { Router } from "express";
import { prisma } from "../config/database";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.middleware";
import { assertSafeText } from "../services/content-safety.service";

export const doubleDateRouter = Router();

doubleDateRouter.use(requireAuth);

function currentUserId(req: AuthenticatedRequest) {
  if (!req.auth?.userId) {
    throw new Error("Authenticated user missing.");
  }

  return req.auth.userId;
}

function cleanString(value: unknown, max = 160) {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function serializePair(pair: {
  id: bigint;
  ownerId: bigint;
  partnerId: bigint | null;
  title: string | null;
  activity: string | null;
  city: string | null;
  availability: string | null;
  isActive: boolean;
  createdAt: Date;
  owner?: { onboardingProfile: { displayName: string | null } | null; firstName: string | null; lastName: string | null } | null;
  partner?: { onboardingProfile: { displayName: string | null } | null; firstName: string | null; lastName: string | null } | null;
}) {
  const name = (user: typeof pair.owner) =>
    user?.onboardingProfile?.displayName || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null;

  return {
    id: pair.id.toString(),
    ownerId: pair.ownerId.toString(),
    partnerId: pair.partnerId?.toString() ?? null,
    ownerName: name(pair.owner),
    partnerName: name(pair.partner),
    title: pair.title,
    activity: pair.activity,
    city: pair.city,
    availability: pair.availability,
    isActive: pair.isActive,
    createdAt: pair.createdAt.toISOString(),
  };
}

doubleDateRouter.get("/double-date/pairs", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const city = cleanString(req.query.city, 120);
    const pairs = await prisma.doubleDatePair.findMany({
      where: {
        isActive: true,
        ownerId: { not: userId },
        partnerId: { not: userId },
        ...(city ? { city: { equals: city, mode: "insensitive" } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        owner: { select: { firstName: true, lastName: true, onboardingProfile: { select: { displayName: true } } } },
        partner: { select: { firstName: true, lastName: true, onboardingProfile: { select: { displayName: true } } } },
      },
    });

    res.json({ success: true, pairs: pairs.map(serializePair) });
  } catch (error) {
    next(error);
  }
});

doubleDateRouter.get("/double-date/me", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const [pairs, sentRequests, receivedRequests] = await Promise.all([
      prisma.doubleDatePair.findMany({
        where: { OR: [{ ownerId: userId }, { partnerId: userId }] },
        orderBy: { createdAt: "desc" },
        include: {
          owner: { select: { firstName: true, lastName: true, onboardingProfile: { select: { displayName: true } } } },
          partner: { select: { firstName: true, lastName: true, onboardingProfile: { select: { displayName: true } } } },
        },
      }),
      prisma.doubleDateRequest.findMany({
        where: { senderId: userId },
        orderBy: { createdAt: "desc" },
        include: { receiverPair: true },
      }),
      prisma.doubleDateRequest.findMany({
        where: { receiverId: userId },
        orderBy: { createdAt: "desc" },
        include: { senderPair: true },
      }),
    ]);

    res.json({
      success: true,
      pairs: pairs.map(serializePair),
      sentRequests: sentRequests.map((request) => ({
        id: request.id.toString(),
        status: request.status,
        receiverPair: serializePair(request.receiverPair),
        createdAt: request.createdAt.toISOString(),
        respondedAt: request.respondedAt?.toISOString() ?? null,
      })),
      receivedRequests: receivedRequests.map((request) => ({
        id: request.id.toString(),
        status: request.status,
        senderPair: serializePair(request.senderPair),
        message: request.message,
        createdAt: request.createdAt.toISOString(),
        respondedAt: request.respondedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

doubleDateRouter.post("/double-date/pairs", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const partnerId = req.body.partnerId ? BigInt(String(req.body.partnerId)) : null;
    const title = cleanString(req.body.title, 120);
    const activity = cleanString(req.body.activity, 160);
    const city = cleanString(req.body.city, 120);
    const availability = cleanString(req.body.availability, 160);

    if (!title || !activity) {
      return res.status(400).json({ success: false, message: "Pair title and activity are required." });
    }

    assertSafeText(title, "Double date title");
    assertSafeText(activity, "Double date activity");

    if (partnerId === userId) {
      return res.status(400).json({ success: false, message: "Partner must be another member." });
    }

    if (partnerId) {
      const match = await prisma.match.findFirst({
        where: {
          isActive: true,
          OR: [
            { user1Id: userId, user2Id: partnerId },
            { user1Id: partnerId, user2Id: userId },
          ],
        },
        select: { id: true },
      });

      if (!match) {
        return res.status(400).json({ success: false, message: "Double date partners must be active matches." });
      }
    }

    const pair = await prisma.doubleDatePair.create({
      data: { ownerId: userId, partnerId, title, activity, city, availability },
    });

    res.status(201).json({ success: true, pair: serializePair(pair) });
  } catch (error) {
    next(error);
  }
});

doubleDateRouter.post("/double-date/requests", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const senderPairId = BigInt(String(req.body.senderPairId));
    const receiverPairId = BigInt(String(req.body.receiverPairId));
    const message = cleanString(req.body.message, 240);

    if (message) {
      assertSafeText(message, "Double date message");
    }

    const [senderPair, receiverPair] = await Promise.all([
      prisma.doubleDatePair.findFirst({
        where: { id: senderPairId, isActive: true, OR: [{ ownerId: userId }, { partnerId: userId }] },
      }),
      prisma.doubleDatePair.findFirst({ where: { id: receiverPairId, isActive: true } }),
    ]);

    if (!senderPair || !receiverPair || receiverPair.ownerId === userId || receiverPair.partnerId === userId) {
      return res.status(400).json({ success: false, message: "Choose one of your pairs and another active pair." });
    }

    const request = await prisma.doubleDateRequest.upsert({
      where: { senderPairId_receiverPairId: { senderPairId, receiverPairId } },
      update: { message, status: "pending", respondedAt: null },
      create: {
        senderPairId,
        receiverPairId,
        senderId: userId,
        receiverId: receiverPair.ownerId,
        message,
      },
    });

    res.status(201).json({
      success: true,
      request: {
        id: request.id.toString(),
        status: request.status,
        createdAt: request.createdAt.toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
});

doubleDateRouter.patch("/double-date/requests/:requestId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const requestId = BigInt(req.params.requestId);
    const status = cleanString(req.body.status, 40);

    if (status !== "accepted" && status !== "declined") {
      return res.status(400).json({ success: false, message: "Status must be accepted or declined." });
    }

    const request = await prisma.doubleDateRequest.findFirst({
      where: { id: requestId, receiverId: userId, status: "pending" },
    });

    if (!request) {
      return res.status(404).json({ success: false, message: "Double date request not found." });
    }

    const updated = await prisma.doubleDateRequest.update({
      where: { id: request.id },
      data: { status, respondedAt: new Date() },
    });

    res.json({
      success: true,
      request: {
        id: updated.id.toString(),
        status: updated.status,
        respondedAt: updated.respondedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    next(error);
  }
});
