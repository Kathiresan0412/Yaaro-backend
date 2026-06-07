import { Router } from "express";
import type { Prisma, UserProfile } from "@prisma/client";
import { prisma } from "../config/database";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.middleware";
import { hasTier, getUserTier } from "../services/premium.service";
import { interestBadges } from "../services/interest-badges.service";
import {
  cacheGet,
  cacheSet,
  cacheDel,
  CacheTTL,
} from "../services/cache.service";

export const matchesRouter = Router();

matchesRouter.use(requireAuth);

// ─── Helpers ────────────────────────────────────────────────────────────────

function currentUserId(req: AuthenticatedRequest) {
  if (!req.auth?.userId) {
    throw new Error("Authenticated user missing.");
  }

  return req.auth.userId;
}

function calculateAge(dateOfBirth: Date) {
  const today = new Date();
  let age = today.getFullYear() - dateOfBirth.getFullYear();
  const monthDifference = today.getMonth() - dateOfBirth.getMonth();

  if (
    monthDifference < 0 ||
    (monthDifference === 0 && today.getDate() < dateOfBirth.getDate())
  ) {
    age -= 1;
  }

  return age;
}

function jsonArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function decimalToNumber(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function haversineKm(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
) {
  const earthRadiusKm = 6371;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(toLatitude - fromLatitude);
  const longitudeDelta = toRadians(toLongitude - fromLongitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(fromLatitude)) *
      Math.cos(toRadians(toLatitude)) *
      Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function displayName(user: {
  firstName: string | null;
  lastName: string | null;
  onboardingProfile: Pick<UserProfile, "displayName"> | null;
}) {
  return (
    user.onboardingProfile?.displayName ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    "Yaaro member"
  );
}

// ─── Lightweight match card (used in list view) ─────────────────────────────

const MATCH_PHOTO_ORDER = [
  { isPrimary: "desc" as const },
  { orderIndex: "asc" as const },
  { id: "asc" as const },
];

// ─── Full profile builder (loaded on-demand when user taps a profile) ───────

async function publicProfile(user: {
  id: bigint;
  firstName: string | null;
  lastName: string | null;
  lastActiveAt: Date | null;
  onboardingProfile: UserProfile | null;
  hobbies: { hobby: string }[];
  onboardingPhotos: { id: bigint; url: string; isPrimary: boolean; orderIndex: number }[];
  location: { latitude?: unknown; longitude?: unknown; city: string | null; country: string | null } | null;
  profile: {
    gender: string;
    dateOfBirth: Date;
    isVerified: boolean;
  } | null;
}) {
  const profile = user.onboardingProfile;

  return {
    id: user.id.toString(),
    displayName: displayName(user),
    age: user.profile ? calculateAge(user.profile.dateOfBirth) : null,
    gender: user.profile?.gender ?? null,
    lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
    isVerified: user.profile?.isVerified ?? false,
    city: user.location?.city ?? null,
    country: user.location?.country ?? null,
    mainPhotoUrl: user.onboardingPhotos[0]?.url ?? null,
    photos: user.onboardingPhotos.map((photo) => ({
      id: photo.id.toString(),
      url: photo.url,
      isPrimary: photo.isPrimary,
    })),
    bio: profile?.bio ?? null,
    headline: profile?.headline ?? null,
    pronouns: profile?.pronouns ?? null,
    basics: {
      heightCm: profile?.heightCm ?? null,
      bodyType: profile?.bodyType ?? null,
      ethnicity: jsonArray(profile?.ethnicity),
      hairColour: profile?.hairColour ?? null,
      eyeColour: profile?.eyeColour ?? null,
      education: profile?.education ?? null,
      jobTitle: profile?.jobTitle ?? null,
      company: profile?.company ?? null,
      industry: profile?.industry ?? null,
      religion: profile?.religion ?? null,
      nationality: profile?.nationality ?? null,
      languages: jsonArray(profile?.languages),
    },
    lifestyle: {
      smoking: profile?.smoking ?? null,
      drinking: profile?.drinking ?? null,
      exercise: profile?.exercise ?? null,
      diet: profile?.diet ?? null,
      sleepSchedule: profile?.sleepSchedule ?? null,
      livingSituation: profile?.livingSituation ?? null,
      hasChildren: profile?.hasChildren ?? null,
      wantsChildren: profile?.wantsChildren ?? null,
      hasPets: jsonArray(profile?.hasPets),
      wantsPets: profile?.wantsPets ?? null,
    },
    interests: {
      hobbies: user.hobbies.map((item) => item.hobby),
      badges: await interestBadges(user.hobbies.map((item) => item.hobby)),
      favPet: profile?.favPet ?? null,
      favColour: profile?.favColour ?? null,
      favFood: jsonArray(profile?.favFood),
      favMusic: jsonArray(profile?.favMusic),
      favMovieGenre: jsonArray(profile?.favMovieGenre),
      loveLanguage: profile?.loveLanguage ?? null,
      relationshipGoal: profile?.relationshipGoal ?? null,
      starSign: profile?.starSign ?? null,
      mbti: profile?.mbti ?? null,
    },
    anthem: profile?.spotifyAnthemId
      ? {
          id: profile.spotifyAnthemId,
          name: profile.spotifyAnthemName,
          previewUrl: profile.spotifyPreviewUrl,
          albumArtUrl: profile.spotifyAlbumArtUrl,
        }
      : null,
  };
}

function compatibilityScore(
  viewer: { profile: UserProfile | null; hobbies: string[] },
  target: { profile: UserProfile | null; hobbies: string[]; verified: boolean },
) {
  const viewerProfile = viewer.profile;
  const targetProfile = target.profile;
  let score = target.verified ? 5 : 0;

  if (viewerProfile?.relationshipGoal && viewerProfile.relationshipGoal === targetProfile?.relationshipGoal) {
    score += 25;
  }

  if (viewerProfile?.loveLanguage && viewerProfile.loveLanguage === targetProfile?.loveLanguage) {
    score += 15;
  }

  const sharedHobbies = viewer.hobbies.filter((hobby) => target.hobbies.includes(hobby));
  score += Math.min(20, sharedHobbies.length * 5);

  const scoringGroups = [
    [jsonArray(viewerProfile?.favMusic), jsonArray(targetProfile?.favMusic), 10],
    [jsonArray(viewerProfile?.favFood), jsonArray(targetProfile?.favFood), 10],
    [jsonArray(viewerProfile?.favMovieGenre), jsonArray(targetProfile?.favMovieGenre), 10],
  ] as const;

  for (const [viewerItems, targetItems, max] of scoringGroups) {
    const overlap = viewerItems.filter((item) => targetItems.includes(item)).length;
    score += Math.min(max, overlap * 5);
  }

  if (viewerProfile?.smoking && viewerProfile.smoking === targetProfile?.smoking) {
    score += 5;
  }

  if (viewerProfile?.drinking && viewerProfile.drinking === targetProfile?.drinking) {
    score += 5;
  }

  return {
    score: Math.min(100, Math.round(score)),
    sharedHobbies,
  };
}

async function hasPlan(userId: bigint, slugs: string[]) {
  const tier = await getUserTier(userId);
  return slugs.some((slug) => hasTier(tier, slug as "free" | "plus" | "gold" | "platinum"));
}

// ─── GET /matches – Lightweight list with caching ───────────────────────────

matchesRouter.get("/matches", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const cacheKey = `matches:${userId}`;

    // Check cache first
    const cached = await cacheGet<unknown[]>(cacheKey);
    if (cached) {
      return res.json({ success: true, matches: cached });
    }

    // Lightweight query: include only relationships needed for the match list card
    const matches = await prisma.match.findMany({
      where: {
        isActive: true,
        OR: [{ user1Id: userId }, { user2Id: userId }],
      },
      orderBy: { matchedAt: "desc" },
      include: {
        user1: {
          include: {
            onboardingProfile: true,
            onboardingPhotos: {
              orderBy: MATCH_PHOTO_ORDER,
              take: 1,
            },
            profile: true,
          },
        },
        user2: {
          include: {
            onboardingProfile: true,
            onboardingPhotos: {
              orderBy: MATCH_PHOTO_ORDER,
              take: 1,
            },
            profile: true,
          },
        },
        conversations: {
          where: { isActive: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
      },
    });

    const itemsByUser = new Map<string, unknown>();

    for (const match of matches) {
      const matchedUser = match.user1Id === userId ? match.user2 : match.user1;
      const userIdStr = matchedUser.id.toString();

      if (itemsByUser.has(userIdStr)) continue;

      const conversation = match.conversations[0] ?? null;

      itemsByUser.set(userIdStr, {
        id: match.id.toString(),
        matchedAt: match.matchedAt.toISOString(),
        isNew: Date.now() - match.matchedAt.getTime() < 24 * 60 * 60 * 1000,
        compatibilityScore: Number(match.compatibilityScore),
        user: {
          id: userIdStr,
          displayName: displayName(matchedUser),
          age: matchedUser.profile ? calculateAge(matchedUser.profile.dateOfBirth) : null,
          mainPhotoUrl: matchedUser.onboardingPhotos[0]?.url ?? null,
          lastActiveAt: matchedUser.lastActiveAt?.toISOString() ?? null,
          isVerified: matchedUser.profile?.isVerified ?? false,
        },
        lastMessage: conversation?.lastMessagePreview
          ? {
              preview: conversation.lastMessagePreview,
              sentAt: conversation.lastMessageAt?.toISOString() ?? null,
            }
          : null,
        unreadCount:
          conversation && conversation.user1Id === userId
            ? conversation.user1UnreadCount
            : conversation?.user2UnreadCount ?? 0,
      });
    }

    const result = Array.from(itemsByUser.values());

    // Cache the lightweight result
    await cacheSet(cacheKey, result, CacheTTL.MATCHES_LIST);

    res.json({ success: true, matches: result });
  } catch (error) {
    next(error);
  }
});

// ─── DELETE /matches/:matchId ───────────────────────────────────────────────

matchesRouter.delete("/matches/:matchId", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const matchId = BigInt(req.params.matchId);

    const match = await prisma.match.findFirst({
      where: {
        id: matchId,
        isActive: true,
        OR: [{ user1Id: userId }, { user2Id: userId }],
      },
      select: { id: true, user1Id: true, user2Id: true },
    });

    if (!match) {
      return res.status(404).json({ success: false, message: "Match not found." });
    }

    await prisma.$transaction([
      prisma.match.update({ where: { id: matchId }, data: { isActive: false } }),
      prisma.conversation.updateMany({ where: { matchId }, data: { isActive: false } }),
    ]);

    // Invalidate both users' match caches
    const otherUserId = match.user1Id === userId ? match.user2Id : match.user1Id;
    await cacheDel(`matches:${userId}`, `matches:${otherUserId}`);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ─── GET /users/:userId/profile – Full profile (loaded on interaction) ──────

matchesRouter.get("/users/:userId/profile", async (req: AuthenticatedRequest, res, next) => {
  try {
    const viewerId = currentUserId(req);
    const targetUserId = BigInt(req.params.userId);

    // Check cache for this profile
    const cacheKey = `profile:${targetUserId}:viewer:${viewerId}`;
    const cached = await cacheGet<object>(cacheKey);
    if (cached) {
      // Still record the view asynchronously
      if (viewerId !== targetUserId) {
        prisma.profileView.create({
          data: { viewerId, viewedId: targetUserId, source: "profile" },
        }).catch(() => {});
      }
      return res.json({ success: true, profile: cached });
    }

    const blocked = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: targetUserId },
          { blockerId: targetUserId, blockedId: viewerId },
        ],
      },
      select: { id: true },
    });

    if (blocked) {
      return res.status(404).json({ success: false, message: "Profile is not available." });
    }

    const [viewer, target] = await Promise.all([
      prisma.user.findUnique({
        where: { id: viewerId },
        include: { onboardingProfile: true, hobbies: true, location: true },
      }),
      prisma.user.findFirst({
        where: {
          id: targetUserId,
          onboardingCompleted: true,
          isActive: true,
          isBanned: false,
          status: "active",
        },
        include: {
          onboardingProfile: true,
          hobbies: true,
          onboardingPhotos: { orderBy: [{ isPrimary: "desc" }, { orderIndex: "asc" }, { id: "asc" }] },
          location: true,
          profile: true,
        },
      }),
    ]);

    if (!viewer || !target || !target.profile) {
      return res.status(404).json({ success: false, message: "Profile is not available." });
    }

    const targetProfile = await publicProfile(target);

    // Record profile view (fire-and-forget for latency)
    if (viewerId !== targetUserId) {
      prisma.profileView.create({
        data: { viewerId, viewedId: targetUserId, source: "profile" },
      }).catch(() => {});
    }

    const { score, sharedHobbies } = compatibilityScore(
      { profile: viewer.onboardingProfile, hobbies: viewer.hobbies.map((item) => item.hobby) },
      {
        profile: target.onboardingProfile,
        hobbies: target.hobbies.map((item) => item.hobby),
        verified: target.profile.isVerified,
      },
    );

    const viewerLatitude = decimalToNumber(viewer.location?.latitude);
    const viewerLongitude = decimalToNumber(viewer.location?.longitude);
    const targetLatitude = decimalToNumber(target.location?.latitude);
    const targetLongitude = decimalToNumber(target.location?.longitude);
    const distanceKm =
      viewerLatitude !== null &&
      viewerLongitude !== null &&
      targetLatitude !== null &&
      targetLongitude !== null
        ? Math.round(haversineKm(viewerLatitude, viewerLongitude, targetLatitude, targetLongitude))
        : null;

    const profileResult = {
      ...targetProfile,
      distanceKm,
      compatibilityScore: score,
      sharedInterests: sharedHobbies,
    };

    // Cache the full profile result
    await cacheSet(cacheKey, profileResult, CacheTTL.USER_PROFILE);

    res.json({ success: true, profile: profileResult });
  } catch (error) {
    next(error);
  }
});

// ─── GET /likes/received – With caching ─────────────────────────────────────

matchesRouter.get("/likes/received", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const canSeeLikes = await hasPlan(userId, ["plus", "gold", "platinum"]);

    const unmatchedLikeWhere: Prisma.SwipeWhereInput = {
      swipedId: userId,
      action: { in: ["like", "superlike"] },
      swiper: {
        isActive: true,
        isBanned: false,
        status: "active" as const,
        onboardingCompleted: true,
      },
      NOT: {
        OR: [
          { swiper: { matchesAsUser1: { some: { user2Id: userId, isActive: true } } } },
          { swiper: { matchesAsUser2: { some: { user1Id: userId, isActive: true } } } },
        ],
      },
    };

    if (!canSeeLikes) {
      const count = await prisma.swipe.count({ where: unmatchedLikeWhere });
      return res.json({ success: true, count, blurred: true, likes: [] });
    }

    // Check cache
    const cacheKey = `likes:${userId}`;
    const cached = await cacheGet<object>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Lightweight select: only fields needed for the likes list card
    const likes = await prisma.swipe.findMany({
      where: unmatchedLikeWhere,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        action: true,
        createdAt: true,
        superLike: { select: { message: true } },
        swiper: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            onboardingProfile: { select: { displayName: true } },
            onboardingPhotos: {
              select: { url: true },
              orderBy: [
                { isPrimary: "desc" as const },
                { orderIndex: "asc" as const },
                { id: "asc" as const },
              ],
              take: 1,
            },
            profile: { select: { dateOfBirth: true, isVerified: true } },
          },
        },
      },
    });

    const result = {
      success: true,
      count: likes.length,
      blurred: false,
      likes: likes.map((like) => ({
        id: like.id.toString(),
        action: like.action,
        likedAt: like.createdAt.toISOString(),
        superLikeMessage: like.superLike?.message ?? null,
        user: {
          id: like.swiper.id.toString(),
          displayName: displayName(like.swiper),
          age: like.swiper.profile ? calculateAge(like.swiper.profile.dateOfBirth) : null,
          mainPhotoUrl: like.swiper.onboardingPhotos[0]?.url ?? null,
          isVerified: like.swiper.profile?.isVerified ?? false,
        },
      })),
    };

    await cacheSet(cacheKey, result, CacheTTL.LIKES_RECEIVED);

    res.json(result);
  } catch (error) {
    next(error);
  }
});
