import { Router } from "express";
import type { IdType, ReportReason } from "@prisma/client";
import { prisma } from "../config/database";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.middleware";
import { isSupportedImageUploadSource, uploadVerificationSelfie } from "../services/media.service";
import { deactivatePairData, notifyModerationTeam } from "../services/safety.service";

export const safetyRouter = Router();

safetyRouter.use(requireAuth);

const reportReasons = new Set<ReportReason>([
  "fake_profile",
  "inappropriate_photo",
  "harassment",
  "underage",
  "spam",
  "scam",
  "other",
]);

const idTypes = new Set<IdType>(["nic", "passport", "driving_license"]);

function currentUserId(req: AuthenticatedRequest) {
  if (!req.auth?.userId) {
    throw new Error("Authenticated user missing.");
  }

  return req.auth.userId;
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

function cleanString(value: unknown, max = 500) {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function displayName(user: {
  firstName: string | null;
  lastName: string | null;
  onboardingProfile: { displayName: string | null } | null;
}) {
  return (
    user.onboardingProfile?.displayName ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    "Yaaro member"
  );
}

safetyRouter.post("/reports", async (req: AuthenticatedRequest, res, next) => {
  try {
    const reporterId = currentUserId(req);
    const reportedId = parseBigInt(req.body.reportedUserId ?? req.body.reported_user_id ?? req.body.userId);
    const reason = cleanString(req.body.reason, 80) as ReportReason | null;
    const description = cleanString(req.body.description, 2000);
    const screenshotUrl = cleanString(req.body.screenshotUrl ?? req.body.screenshot_url, 500);
    const shouldBlock = Boolean(req.body.blockUser ?? req.body.block_user ?? req.body.block);
    const shouldUnmatch = Boolean(req.body.unmatch ?? req.body.unmatchAndReport ?? shouldBlock);

    if (!reportedId || reportedId === reporterId) {
      return res.status(400).json({ success: false, message: "Reported user is invalid." });
    }

    if (!reason || !reportReasons.has(reason)) {
      return res.status(400).json({ success: false, message: "Choose a valid report reason." });
    }

    const target = await prisma.user.findUnique({
      where: { id: reportedId },
      select: { id: true, isActive: true, status: true },
    });

    if (!target || !target.isActive || target.status === "deleted") {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const report = await prisma.$transaction(async (tx) => {
      const created = await tx.report.create({
        data: {
          reporterId,
          reportedId,
          reason,
          description,
          screenshotUrl,
        },
      });

      if (shouldBlock) {
        await tx.block.upsert({
          where: { blockerId_blockedId: { blockerId: reporterId, blockedId: reportedId } },
          update: {},
          create: { blockerId: reporterId, blockedId: reportedId },
        });
      }

      if (shouldUnmatch) {
        await deactivatePairData(tx, reporterId, reportedId);
      }

      return created;
    });

    notifyModerationTeam(report).catch((error) => {
      console.warn("Moderation report email failed.", error);
    });

    res.status(201).json({
      success: true,
      report: {
        id: report.id.toString(),
        status: report.status,
        createdAt: report.createdAt.toISOString(),
      },
      blocked: shouldBlock,
      unmatched: shouldUnmatch,
    });
  } catch (error) {
    next(error);
  }
});

safetyRouter.post("/users/block/:userId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const blockerId = currentUserId(req);
    const blockedId = parseBigInt(req.params.userId);

    if (!blockedId || blockedId === blockerId) {
      return res.status(400).json({ success: false, message: "Blocked user is invalid." });
    }

    const target = await prisma.user.findUnique({
      where: { id: blockedId },
      select: { id: true, isActive: true, status: true },
    });

    if (!target || !target.isActive || target.status === "deleted") {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    await prisma.$transaction(async (tx) => {
      await tx.block.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId } },
        update: {},
        create: { blockerId, blockedId },
      });
      await deactivatePairData(tx, blockerId, blockedId);
    });

    res.status(201).json({ success: true });
  } catch (error) {
    next(error);
  }
});

safetyRouter.get("/users/blocked", async (req: AuthenticatedRequest, res, next) => {
  try {
    const blockerId = currentUserId(req);
    const blocks = await prisma.block.findMany({
      where: { blockerId },
      orderBy: { createdAt: "desc" },
      include: {
        blocked: {
          include: {
            onboardingProfile: { select: { displayName: true } },
            onboardingPhotos: {
              orderBy: [{ isPrimary: "desc" }, { orderIndex: "asc" }, { id: "asc" }],
              take: 1,
            },
          },
        },
      },
    });

    res.json({
      success: true,
      blockedUsers: blocks.map((block) => ({
        id: block.blocked.id.toString(),
        displayName: displayName(block.blocked),
        mainPhotoUrl: block.blocked.onboardingPhotos[0]?.url ?? null,
        blockedAt: block.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    next(error);
  }
});

safetyRouter.delete("/users/block/:userId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const blockerId = currentUserId(req);
    const blockedId = parseBigInt(req.params.userId);

    if (!blockedId || blockedId === blockerId) {
      return res.status(400).json({ success: false, message: "Blocked user is invalid." });
    }

    await prisma.block.deleteMany({ where: { blockerId, blockedId } });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

safetyRouter.post("/users/unmatch/:matchId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const matchId = parseBigInt(req.params.matchId);

    if (!matchId) {
      return res.status(400).json({ success: false, message: "Match is invalid." });
    }

    const match = await prisma.match.findFirst({
      where: { id: matchId, isActive: true, OR: [{ user1Id: userId }, { user2Id: userId }] },
      select: { id: true },
    });

    if (!match) {
      return res.status(404).json({ success: false, message: "Match not found." });
    }

    await prisma.$transaction([
      prisma.match.update({ where: { id: match.id }, data: { isActive: false } }),
      prisma.conversation.updateMany({ where: { matchId: match.id }, data: { isActive: false } }),
    ]);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

safetyRouter.get("/verification/status", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const latest = await prisma.verification.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    res.json({
      success: true,
      verification: latest && {
        id: latest.id.toString(),
        status: latest.status,
        photoVerified: latest.photoVerified,
        idVerified: latest.idVerified,
        selfieUrl: latest.selfieUrl,
        rejectionReason: latest.rejectionReason,
        submittedAt: latest.createdAt.toISOString(),
        reviewedAt: latest.reviewedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    next(error);
  }
});

safetyRouter.post("/verification/photo", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const source = cleanString(req.body.imageDataUrl, 5_000_000) || cleanString(req.body.selfieUrl ?? req.body.url, 5000);

    if (!source || !isSupportedImageUploadSource(source)) {
      return res.status(400).json({ success: false, message: "A selfie image URL or data URL is required." });
    }

    const upload = await uploadVerificationSelfie(source, userId);
    const verification = await prisma.verification.create({
      data: {
        userId,
        selfieUrl: upload.secure_url,
        status: "pending",
        photoVerified: false,
        idVerified: false,
      },
    });

    res.status(201).json({
      success: true,
      verification: {
        id: verification.id.toString(),
        status: verification.status,
        photoVerified: verification.photoVerified,
        selfieUrl: verification.selfieUrl,
        submittedAt: verification.createdAt.toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
});

safetyRouter.post("/verification/id", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const idType = cleanString(req.body.idType ?? req.body.id_type, 40) as IdType | null;
    const idFrontUrl = cleanString(req.body.idFrontUrl ?? req.body.id_front_url, 500);
    const idBackUrl = cleanString(req.body.idBackUrl ?? req.body.id_back_url, 500);
    const selfieUrl = cleanString(req.body.selfieUrl ?? req.body.selfie_url, 500);

    if (!idType || !idTypes.has(idType) || !idFrontUrl || !selfieUrl) {
      return res.status(400).json({
        success: false,
        message: "ID type, front image, and selfie are required.",
      });
    }

    const verification = await prisma.verification.create({
      data: {
        userId,
        idType,
        idFrontUrl,
        idBackUrl,
        selfieUrl,
        status: "pending",
        photoVerified: false,
        idVerified: false,
      },
    });

    res.status(201).json({
      success: true,
      verification: {
        id: verification.id.toString(),
        status: verification.status,
        idType: verification.idType,
        submittedAt: verification.createdAt.toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
});
