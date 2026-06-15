import { Router } from "express";
import type { SwipeAction, UserProfile } from "@prisma/client";
import { prisma, prismaRead } from "../config/database";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.middleware";
import { addDays, getUserCapabilities, getUserTier, hasTier } from "../services/premium.service";
import { notifyUser } from "../services/notification.service";
import { cacheGet, cacheSet, cacheDel, CacheTTL } from "../services/cache.service";
import { geocodeCity } from "../services/geocoding.service";

export const discoveryRouter = Router();

discoveryRouter.use(requireAuth);

const LIKE_LIMIT = 50;
const SUPERLIKE_LIMIT = 1;

type Candidate = {
  id: bigint;
  firstName: string | null;
  lastName: string | null;
  onboardingProfile: UserProfile | null;
  hobbies: { hobby: string }[];
  onboardingPhotos: {
    id: bigint;
    url: string;
    orderIndex: number;
    isPrimary: boolean;
    status: string;
  }[];
  location: {
    latitude: unknown;
    longitude: unknown;
    city: string | null;
    country: string | null;
    passportActive: boolean;
    passportLatitude: unknown;
    passportLongitude: unknown;
    passportCity: string | null;
    passportCountry: string | null;
  } | null;
  profile: {
    gender: string;
    dateOfBirth: Date;
    isVerified: boolean;
  } | null;
  discoveryPreference: {
    incognitoMode: boolean;
  } | null;
  boosts: {
    id: bigint;
    endsAt: Date;
  }[];
};

type DiscoveryCard = {
  id: string;
  displayName: string;
  age: number;
  distanceKm: number | null;
  headline: string;
  mainPhotoUrl: string | null;
  photos: Array<{ id: string; url: string; isPrimary: boolean }>;
  city: string | null;
  country: string | null;
  isVerified: boolean;
  isBoosted: boolean;
  sharedInterests: string[];
  compatibilityScore: number;
  profile: ReturnType<typeof publicProfileDetails>;
};

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

function decimalToNumber(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function effectiveLatitude(location: Candidate["location"] | null) {
  return decimalToNumber(location?.passportActive ? location.passportLatitude : location?.latitude);
}

function effectiveLongitude(location: Candidate["location"] | null) {
  return decimalToNumber(location?.passportActive ? location.passportLongitude : location?.longitude);
}

function compatibilityScore(
  viewer: { profile: UserProfile | null; hobbies: string[] },
  candidate: { profile: UserProfile | null; hobbies: string[]; verified: boolean },
) {
  const viewerProfile = viewer.profile;
  const candidateProfile = candidate.profile;
  let score = candidate.verified ? 5 : 0;

  if (
    viewerProfile?.relationshipGoal &&
    viewerProfile.relationshipGoal === candidateProfile?.relationshipGoal
  ) {
    score += 25;
  }

  if (viewerProfile?.loveLanguage && viewerProfile.loveLanguage === candidateProfile?.loveLanguage) {
    score += 15;
  }

  const sharedHobbies = viewer.hobbies.filter((hobby) => candidate.hobbies.includes(hobby));
  score += Math.min(20, sharedHobbies.length * 5);

  const scoringGroups = [
    [jsonArray(viewerProfile?.favMusic), jsonArray(candidateProfile?.favMusic), 10],
    [jsonArray(viewerProfile?.favFood), jsonArray(candidateProfile?.favFood), 10],
    [jsonArray(viewerProfile?.favMovieGenre), jsonArray(candidateProfile?.favMovieGenre), 10],
  ] as const;

  for (const [viewerItems, candidateItems, max] of scoringGroups) {
    const overlap = viewerItems.filter((item) => candidateItems.includes(item)).length;
    score += Math.min(max, overlap * 5);
  }

  if (viewerProfile?.smoking && viewerProfile.smoking === candidateProfile?.smoking) {
    score += 5;
  }

  if (viewerProfile?.drinking && viewerProfile.drinking === candidateProfile?.drinking) {
    score += 5;
  }

  return {
    score: Math.min(100, Math.round(score)),
    sharedHobbies: sharedHobbies.slice(0, 3),
  };
}

function publicProfileDetails(candidate: Candidate) {
  const profile = candidate.onboardingProfile;

  return {
    bio: profile?.bio ?? null,
    pronouns: profile?.pronouns ?? null,
    heightCm: profile?.heightCm ?? null,
    relationshipGoal: profile?.relationshipGoal ?? null,
    loveLanguage: profile?.loveLanguage ?? null,
    lifestyle: {
      smoking: profile?.smoking ?? null,
      drinking: profile?.drinking ?? null,
      exercise: profile?.exercise ?? null,
      diet: profile?.diet ?? null,
      sleepSchedule: profile?.sleepSchedule ?? null,
    },
    interests: {
      hobbies: candidate.hobbies.map((item) => item.hobby),
      favFood: jsonArray(profile?.favFood),
      favMusic: jsonArray(profile?.favMusic),
      favMovieGenre: jsonArray(profile?.favMovieGenre),
      favColour: profile?.favColour ?? null,
      favPet: profile?.favPet ?? null,
    },
  };
}

async function getLimits(userId: bigint) {
  const now = Date.now();
  const twelveHoursAgo = new Date(now - 12 * 60 * 60 * 1000);
  const capabilities = await getUserCapabilities(userId);
  const superLikeWindowStart = addDays(new Date(), -capabilities.superLikeWindowDays);

  const [likesUsed, superLikesUsed] = await Promise.all([
    capabilities.unlimitedLikes
      ? Promise.resolve(0)
      : prisma.swipe.count({
          where: { swiperId: userId, action: "like", createdAt: { gte: twelveHoursAgo } },
        }),
    prisma.superLike.count({ where: { userId, sentAt: { gte: superLikeWindowStart } } }),
  ]);

  return {
    tier: capabilities.tier,
    likesRemaining: capabilities.unlimitedLikes ? null : Math.max(0, LIKE_LIMIT - likesUsed),
    superLikesRemaining: Math.max(0, capabilities.superLikeLimit - superLikesUsed),
    likeLimit: capabilities.unlimitedLikes ? null : LIKE_LIMIT,
    superLikeLimit: capabilities.superLikeLimit,
    superLikeWindowDays: capabilities.superLikeWindowDays,
    likeResetAt: new Date(now + 12 * 60 * 60 * 1000).toISOString(),
    superLikeResetAt: addDays(new Date(), capabilities.superLikeWindowDays).toISOString(),
    capabilities,
  };
}

async function hasPlusAccess(userId: bigint) {
  return (await getUserCapabilities(userId)).canRewind;
}

async function displayNameForUser(userId: bigint) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      firstName: true,
      lastName: true,
      onboardingProfile: { select: { displayName: true } },
    },
  });

  return (
    user?.onboardingProfile?.displayName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    "Yaaro member"
  );
}

// ---------------------------------------------------------------------------
// GET /discover/nearby — Users with fuzzy coordinates for the map view
// ---------------------------------------------------------------------------

discoveryRouter.get("/discover/nearby", async (req: AuthenticatedRequest, res, next) => {
  try {
    const viewerId = currentUserId(req);
    // Allow client to pass radius (in km) — default 200km for broader map view
    const NEARBY_RADIUS_KM = decimalToNumber(req.query.radius) ?? 200;

    const viewer = await prisma.user.findUnique({
      where: { id: viewerId },
      include: { onboardingProfile: true, hobbies: true, location: true, profile: true },
    });

    if (!viewer) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const preferences = await prisma.userPreference.upsert({
      where: { userId: viewerId },
      update: {},
      create: { userId: viewerId },
    });

    // Use query params or viewer location
    const qLat = decimalToNumber(req.query.lat);
    const qLng = decimalToNumber(req.query.lng);
    const viewerLat = qLat ?? effectiveLatitude(viewer.location);
    const viewerLng = qLng ?? effectiveLongitude(viewer.location);

    if (viewerLat === null || viewerLng === null) {
      return res.json({ success: true, users: [] });
    }

    // Exclusion sets
    const [swipes, blocks] = await Promise.all([
      prisma.swipe.findMany({ where: { swiperId: viewerId }, select: { swipedId: true } }),
      prisma.block.findMany({
        where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
        select: { blockerId: true, blockedId: true },
      }),
    ]);

    const swipedIds = new Set(swipes.map((s) => s.swipedId));
    const blockedIds = new Set(
      blocks.flatMap((b) => (b.blockerId === viewerId ? [b.blockedId] : [b.blockerId])),
    );
    const excludeIds = [...swipedIds, ...blockedIds, viewerId];

    const candidates = await prismaRead.user.findMany({
      where: {
        id: { notIn: excludeIds },
        onboardingCompleted: true,
        isActive: true,
        isBanned: false,
        status: "active",
        onboardingProfile: { isNot: null },
        profile: { isNot: null },
        location: { isNot: null },
      },
      include: {
        onboardingProfile: true,
        hobbies: true,
        onboardingPhotos: {
          orderBy: [{ isPrimary: "desc" }, { orderIndex: "asc" }],
          take: 1,
        },
        location: true,
        profile: true,
      },
      take: 200,
    });

    const users: Array<Record<string, unknown>> = [];

    for (const candidate of candidates) {
      if (!candidate.profile || !candidate.location) continue;

      let candidateLat = effectiveLatitude(candidate.location);
      let candidateLng = effectiveLongitude(candidate.location);

      // If user has city but no coordinates, try to geocode and backfill
      if ((candidateLat === null || candidateLng === null) && candidate.location.city) {
        const geocoded = await geocodeCity(
          candidate.location.city,
          candidate.location.country ?? "",
        );
        if (geocoded) {
          candidateLat = geocoded.latitude;
          candidateLng = geocoded.longitude;
          // Backfill the coordinates in DB (fire-and-forget)
          prisma.userLocation.update({
            where: { userId: candidate.id },
            data: { latitude: geocoded.latitude, longitude: geocoded.longitude },
          }).catch(() => {});
        }
      }

      if (candidateLat === null || candidateLng === null) continue;

      const distanceKm = haversineKm(viewerLat, viewerLng, candidateLat, candidateLng);
      if (distanceKm > NEARBY_RADIUS_KM) continue;

      const age = calculateAge(candidate.profile.dateOfBirth);
      if (age < preferences.minAge || age > preferences.maxAge) continue;

      // Fuzzy the coordinates slightly for privacy (~200m random offset)
      const fuzzLat = candidateLat + (Math.random() - 0.5) * 0.004;
      const fuzzLng = candidateLng + (Math.random() - 0.5) * 0.004;

      const hobbies = candidate.hobbies.map((h) => h.hobby);

      users.push({
        id: candidate.id.toString(),
        displayName:
          candidate.onboardingProfile?.displayName ||
          [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") ||
          "Yaaro member",
        age,
        latitude: fuzzLat,
        longitude: fuzzLng,
        photoUrl: candidate.onboardingPhotos[0]?.url ?? null,
        isVerified: candidate.profile.isVerified,
        distanceKm: Math.round(distanceKm * 10) / 10,
        bio: candidate.onboardingProfile?.bio ?? null,
        interests: hobbies.slice(0, 5),
        city: candidate.location.city ?? null,
        country: candidate.location.country ?? null,
      });
    }

    res.json({ success: true, users });
  } catch (error) {
    next(error);
  }
});

discoveryRouter.get("/discover", async (req: AuthenticatedRequest, res, next) => {
  try {
    const viewerId = currentUserId(req);

    // Check discovery cache – short TTL since swipes change frequently
    const cacheKey = `discovery:${viewerId}`;
    const cached = await cacheGet<{ cards: DiscoveryCard[] }>(cacheKey);
    if (cached) {
      const limits = await getLimits(viewerId);
      return res.json({ success: true, cards: cached.cards, limits });
    }

    const viewer = await prisma.user.findUnique({
      where: { id: viewerId },
      include: {
        onboardingProfile: true,
        hobbies: true,
        location: true,
        profile: true,
      },
    });

    if (!viewer) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const preferences = await prisma.userPreference.upsert({
      where: { userId: viewerId },
      update: {},
      create: { userId: viewerId },
    });

    // Parallel fetch of exclusion sets – only select IDs (lightweight)
    const [swipes, receivedLikes, blocks] = await Promise.all([
      prisma.swipe.findMany({ where: { swiperId: viewerId }, select: { swipedId: true } }),
      prisma.swipe.findMany({
        where: { swipedId: viewerId, action: { in: ["like", "superlike"] } },
        select: { swiperId: true },
      }),
      prisma.block.findMany({
        where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
        select: { blockerId: true, blockedId: true },
      }),
    ]);

    const swipedIds = new Set(swipes.map((swipe) => swipe.swipedId));
    const blockedIds = new Set(
      blocks.flatMap((block) =>
        block.blockerId === viewerId ? [block.blockedId] : [block.blockerId],
      ),
    );
    // Combine exclusion IDs for the database query
    const excludeIds = [...swipedIds, ...blockedIds, viewerId];

    // Optimized query: push filters to DB, limit candidate pool
    // Uses read replica for this heavy query — writes still go to primary
    const candidates = await prismaRead.user.findMany({
      where: {
        id: { notIn: excludeIds },
        onboardingCompleted: true,
        isActive: true,
        isBanned: false,
        status: "active",
        onboardingProfile: { isNot: null },
        profile: { isNot: null },
      },
      include: {
        onboardingProfile: true,
        hobbies: true,
        onboardingPhotos: {
          orderBy: [{ isPrimary: "desc" }, { orderIndex: "asc" }, { id: "asc" }],
          take: 6, // Limit photos loaded per candidate
        },
        location: true,
        profile: true,
        discoveryPreference: true,
        boosts: {
          where: { startedAt: { lte: new Date() }, endsAt: { gt: new Date() } },
          select: { id: true, endsAt: true },
        },
      },
      // Fetch more than needed to allow filtering, but cap the DB result set
      take: 200,
    });
    const limits = await getLimits(viewerId);

    const receivedLikeIds = new Set(receivedLikes.map((swipe) => swipe.swiperId.toString()));
    const viewerLatitude = effectiveLatitude(viewer.location);
    const viewerLongitude = effectiveLongitude(viewer.location);
    const viewerHobbies = viewer.hobbies.map((item) => item.hobby);
    const shouldApplyViewerFilters = Boolean(viewer.profile);

    const distanceFallbackCards: DiscoveryCard[] = [];

    const cards: DiscoveryCard[] = candidates
      .flatMap<DiscoveryCard>((candidate) => {
        if (!candidate.profile) {
          return [];
        }

        const age = calculateAge(candidate.profile.dateOfBirth);
        if (shouldApplyViewerFilters && (age < preferences.minAge || age > preferences.maxAge)) {
          return [];
        }

        if (
          shouldApplyViewerFilters &&
          preferences.showGender !== "everyone" &&
          candidate.profile.gender !== preferences.showGender
        ) {
          return [];
        }

        if (candidate.discoveryPreference?.incognitoMode && !receivedLikeIds.has(candidate.id.toString())) {
          return [];
        }

        const candidateLatitude = effectiveLatitude(candidate.location);
        const candidateLongitude = effectiveLongitude(candidate.location);
        const distanceKm =
          viewerLatitude !== null &&
          viewerLongitude !== null &&
          candidateLatitude !== null &&
          candidateLongitude !== null
            ? haversineKm(viewerLatitude, viewerLongitude, candidateLatitude, candidateLongitude)
            : null;

        const outsideDistance =
          shouldApplyViewerFilters &&
          !preferences.globalMode &&
          distanceKm !== null &&
          distanceKm > preferences.maxDistanceKm;

        const photos = candidate.onboardingPhotos;
        if (shouldApplyViewerFilters && preferences.showPhotosOnly && photos.length === 0) {
          return [];
        }

        const { score, sharedHobbies } = compatibilityScore(
          { profile: viewer.onboardingProfile, hobbies: viewerHobbies },
          {
            profile: candidate.onboardingProfile,
            hobbies: candidate.hobbies.map((item) => item.hobby),
            verified: candidate.profile.isVerified,
          },
        );

        const card: DiscoveryCard = {
          id: candidate.id.toString(),
          displayName:
            candidate.onboardingProfile?.displayName ||
            [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") ||
            "Yaaro member",
          age,
          distanceKm: distanceKm === null ? null : Math.round(distanceKm),
          headline: candidate.onboardingProfile?.headline ?? "",
          mainPhotoUrl: photos[0]?.url ?? null,
          photos: photos.map((photo) => ({
            id: photo.id.toString(),
            url: photo.url,
            isPrimary: photo.isPrimary,
          })),
          city: candidate.location?.city ?? null,
          country: candidate.location?.country ?? null,
          isVerified: candidate.profile.isVerified,
          isBoosted: candidate.boosts.length > 0,
          sharedInterests: sharedHobbies,
          compatibilityScore: score,
          profile: publicProfileDetails(candidate),
        };

        if (outsideDistance) {
          distanceFallbackCards.push(card);
          return [];
        }

        return [card];
      })
      .sort((a, b) => Number(b.isBoosted) - Number(a.isBoosted) || b.compatibilityScore - a.compatibilityScore)
      .slice(0, 20);

    if (cards.length === 0 && distanceFallbackCards.length > 0) {
      cards.push(
        ...distanceFallbackCards
          .sort((a, b) => Number(b.isBoosted) - Number(a.isBoosted) || b.compatibilityScore - a.compatibilityScore)
          .slice(0, 20),
      );
    }

    const boostedUserIds = cards.filter((card) => card.isBoosted).map((card) => BigInt(card.id));
    if (boostedUserIds.length > 0) {
      // Fire-and-forget boost tracking for lower latency
      prisma.boost.updateMany({
        where: { userId: { in: boostedUserIds }, startedAt: { lte: new Date() }, endsAt: { gt: new Date() } },
        data: { viewsGained: { increment: 1 } },
      }).catch(() => {});
    }

    // Cache the discovery result
    await cacheSet(cacheKey, { cards }, CacheTTL.DISCOVERY_CARDS);

    res.json({ success: true, cards, limits });
  } catch (error) {
    next(error);
  }
});

discoveryRouter.post("/swipe", async (req: AuthenticatedRequest, res, next) => {
  try {
    const swiperId = currentUserId(req);
    const targetUserId = BigInt(String(req.body.target_user_id || req.body.targetUserId || ""));
    const action = String(req.body.action || "") as SwipeAction;

    if (targetUserId === swiperId) {
      return res.status(400).json({ success: false, message: "You cannot swipe on yourself." });
    }

    if (!["like", "pass", "superlike"].includes(action)) {
      return res.status(400).json({ success: false, message: "Swipe action is invalid." });
    }

    const limits = await getLimits(swiperId);
    if (action === "like" && limits.likesRemaining !== null && limits.likesRemaining <= 0) {
      return res.status(429).json({
        success: false,
        limitReached: true,
        resetAt: limits.likeResetAt,
        message: "You have reached your free likes for this window.",
      });
    }

    if (action === "superlike" && limits.superLikesRemaining <= 0) {
      return res.status(429).json({
        success: false,
        limitReached: true,
        resetAt: limits.superLikeResetAt,
        message: limits.superLikeWindowDays === 1 ? "You have used today's Super Like." : "You have used this week's Super Likes.",
      });
    }

    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, onboardingCompleted: true, isActive: true, isBanned: true, status: true },
    });

    if (!target || !target.onboardingCompleted || !target.isActive || target.isBanned || target.status !== "active") {
      return res.status(404).json({ success: false, message: "Profile is not available." });
    }

    const blocked = await prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: swiperId, blockedId: targetUserId },
          { blockerId: targetUserId, blockedId: swiperId },
        ],
      },
      select: { id: true },
    });

    if (blocked) {
      return res.status(404).json({ success: false, message: "Profile is not available." });
    }

    const existingSwipe = await prisma.swipe.findUnique({
      where: { swiperId_swipedId: { swiperId, swipedId: targetUserId } },
    });

    if (existingSwipe) {
      return res.status(409).json({ success: false, message: "You have already swiped on this profile." });
    }

    const reverseSwipe =
      action === "pass"
        ? null
        : await prisma.swipe.findUnique({
            where: { swiperId_swipedId: { swiperId: targetUserId, swipedId: swiperId } },
          });

    let matchId: string | null = null;
    const isMutual = Boolean(reverseSwipe && ["like", "superlike"].includes(reverseSwipe.action));

    await prisma.$transaction(async (tx) => {
      const swipe = await tx.swipe.create({ data: { swiperId, swipedId: targetUserId, action } });

      if (action === "superlike") {
        await tx.superLike.create({
          data: { userId: swiperId, targetUserId, swipeId: swipe.id },
        });
      }

      if (isMutual) {
        const user1Id = swiperId < targetUserId ? swiperId : targetUserId;
        const user2Id = swiperId < targetUserId ? targetUserId : swiperId;
        const match = await tx.match.upsert({
          where: { user1Id_user2Id: { user1Id, user2Id } },
          update: { isActive: true },
          create: { user1Id, user2Id, compatibilityScore: 0 },
          select: { id: true },
        });
        matchId = match.id.toString();
      }
    });

    if (isMutual && matchId) {
      const [swiperName, targetName] = await Promise.all([
        displayNameForUser(swiperId),
        displayNameForUser(targetUserId),
      ]);

      await Promise.all([
        notifyUser({
          userId: swiperId,
          type: "new_match",
          title: "It's a match",
          body: `You and ${targetName} liked each other.`,
          data: { matchId, userId: targetUserId.toString(), url: "/app/matches" },
          push: true,
          emailTemplateId: "new_match",
        }),
        notifyUser({
          userId: targetUserId,
          type: "new_match",
          title: "It's a match",
          body: `You and ${swiperName} liked each other.`,
          data: { matchId, userId: swiperId.toString(), url: "/app/matches" },
          push: true,
          emailTemplateId: "new_match",
        }),
      ]);
    } else if (action === "superlike") {
      const swiperName = await displayNameForUser(swiperId);
      await notifyUser({
        userId: targetUserId,
        type: "super_like",
        title: "You received a Super Like",
        body: `${swiperName} sent you a Super Like.`,
        data: { userId: swiperId.toString(), url: "/app/discover" },
        push: true,
        emailTemplateId: "super_like",
      });
    } else if (action === "like" && hasTier(await getUserTier(targetUserId), "gold")) {
      await notifyUser({
        userId: targetUserId,
        type: "liked_you",
        title: "Someone liked you",
        body: "A new like is waiting in your Likes You list.",
        data: { userId: swiperId.toString(), url: "/app/matches" },
        push: true,
      });
    }

    // Invalidate caches affected by the swipe
    await cacheDel(`discovery:${swiperId}`, `likes:${targetUserId}`);
    if (isMutual) {
      await cacheDel(`matches:${swiperId}`, `matches:${targetUserId}`);
    }

    res.status(201).json({
      success: true,
      matched: isMutual,
      matchId,
      limits: await getLimits(swiperId),
    });
  } catch (error) {
    next(error);
  }
});

discoveryRouter.post("/swipe/undo", async (req: AuthenticatedRequest, res, next) => {
  try {
    const swiperId = currentUserId(req);

    if (!(await hasPlusAccess(swiperId))) {
      return res.status(403).json({
        success: false,
        upgradeRequired: true,
        message: "Undo is available on Plus, Gold, and Platinum.",
      });
    }

    const lastSwipe = await prisma.swipe.findFirst({
      where: { swiperId },
      orderBy: { createdAt: "desc" },
      select: { id: true, swipedId: true },
    });

    if (!lastSwipe) {
      return res.status(404).json({ success: false, message: "There is no swipe to undo." });
    }

    const user1Id = swiperId < lastSwipe.swipedId ? swiperId : lastSwipe.swipedId;
    const user2Id = swiperId < lastSwipe.swipedId ? lastSwipe.swipedId : swiperId;

    await prisma.$transaction([
      prisma.swipe.delete({ where: { id: lastSwipe.id } }),
      prisma.match.updateMany({
        where: { user1Id, user2Id, isActive: true },
        data: { isActive: false },
      }),
    ]);

    // Invalidate caches for both users
    await cacheDel(
      `discovery:${swiperId}`,
      `matches:${swiperId}`,
      `matches:${lastSwipe.swipedId}`,
      `likes:${lastSwipe.swipedId}`,
    );

    res.json({ success: true, undoneUserId: lastSwipe.swipedId.toString(), limits: await getLimits(swiperId) });
  } catch (error) {
    next(error);
  }
});
