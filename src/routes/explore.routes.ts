import { Router } from "express";
import type { UserProfile } from "@prisma/client";
import { prisma } from "../config/database";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.middleware";
import { cacheGet, cacheSet, CacheTTL } from "../services/cache.service";

export const exploreRouter = Router();

exploreRouter.use(requireAuth);

type Candidate = {
  id: bigint;
  firstName: string | null;
  lastName: string | null;
  onboardingProfile: UserProfile | null;
  hobbies: { hobby: string }[];
  onboardingPhotos: { id: bigint; url: string; orderIndex: number; isPrimary: boolean; status: string }[];
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
  profile: { gender: string; dateOfBirth: Date; isVerified: boolean } | null;
  discoveryPreference: { incognitoMode: boolean } | null;
  boosts: { id: bigint; endsAt: Date }[];
};

type ExploreCategoryPayload = {
  key: string;
  label: string;
  emoji: string;
  hobbies: string[];
  count?: number;
};

type VibeQuestionPayload = {
  id: string;
  prompt: string;
  answers: string[];
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

  if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < dateOfBirth.getDate())) {
    age -= 1;
  }

  return age;
}

function jsonArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

async function exploreCategories() {
  const cacheKey = "explore:categories";
  const cached = await cacheGet<ExploreCategoryPayload[]>(cacheKey);
  if (cached) return cached;

  const categories = await prisma.exploreCategory.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });

  const result = categories.map<ExploreCategoryPayload>((category) => ({
    key: category.key,
    label: category.label,
    emoji: category.emoji,
    hobbies: jsonArray(category.hobbies),
  }));

  await cacheSet(cacheKey, result, CacheTTL.EXPLORE_CATEGORIES);
  return result;
}

async function exploreVibeQuestions() {
  const questions = await prisma.exploreVibeQuestion.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
  });

  return questions
    .map<VibeQuestionPayload>((question) => ({
      id: question.key,
      prompt: question.prompt,
      answers: jsonArray(question.answers),
    }))
    .filter((question) => question.answers.length > 0);
}

function decimalToNumber(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function haversineKm(fromLatitude: number, fromLongitude: number, toLatitude: number, toLongitude: number) {
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

  if (viewerProfile?.relationshipGoal && viewerProfile.relationshipGoal === candidateProfile?.relationshipGoal) {
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

  return { score: Math.min(100, Math.round(score)), sharedHobbies: sharedHobbies.slice(0, 3) };
}

function publicProfileDetails(candidate: Candidate) {
  const profile = candidate.onboardingProfile;

  return {
    bio: profile?.bio ?? null,
    relationshipGoal: profile?.relationshipGoal ?? null,
    loveLanguage: profile?.loveLanguage ?? null,
    interests: {
      hobbies: candidate.hobbies.map((item) => item.hobby),
      favFood: jsonArray(profile?.favFood),
      favMusic: jsonArray(profile?.favMusic),
      favMovieGenre: jsonArray(profile?.favMovieGenre),
    },
  };
}

async function exploreCards(
  viewerId: bigint,
  filter: (candidate: Candidate, distanceKm: number | null) => boolean,
  limit = 24,
) {
  const viewer = await prisma.user.findUnique({
    where: { id: viewerId },
    include: { onboardingProfile: true, hobbies: true, location: true, profile: true },
  });

  if (!viewer) {
    return null;
  }

  const preferences = await prisma.userPreference.upsert({
    where: { userId: viewerId },
    update: {},
    create: { userId: viewerId },
  });

  // Parallel fetch of exclusion sets
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
  // Push exclusions to database query
  const excludeIds = [...swipedIds, ...blockedIds, viewerId];

  const candidates = await prisma.user.findMany({
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
        take: 6,
      },
      location: true,
      profile: true,
      discoveryPreference: true,
      boosts: {
        where: { startedAt: { lte: new Date() }, endsAt: { gt: new Date() } },
        select: { id: true, endsAt: true },
      },
    },
    take: 200, // Cap DB result set to avoid loading entire user table
  });

  const receivedLikeIds = new Set(receivedLikes.map((swipe) => swipe.swiperId.toString()));
  const viewerLatitude = effectiveLatitude(viewer.location);
  const viewerLongitude = effectiveLongitude(viewer.location);
  const viewerHobbies = viewer.hobbies.map((item) => item.hobby);
  const shouldApplyViewerFilters = Boolean(viewer.profile);

  return candidates
    .flatMap((candidate) => {
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

      if (
        shouldApplyViewerFilters &&
        !preferences.globalMode &&
        distanceKm !== null &&
        distanceKm > preferences.maxDistanceKm
      ) {
        return [];
      }

      if (shouldApplyViewerFilters && preferences.showPhotosOnly && candidate.onboardingPhotos.length === 0) {
        return [];
      }

      if (!filter(candidate, distanceKm)) {
        return [];
      }

      const candidateHobbies = candidate.hobbies.map((item) => item.hobby);
      const { score, sharedHobbies } = compatibilityScore(
        { profile: viewer.onboardingProfile, hobbies: viewerHobbies },
        { profile: candidate.onboardingProfile, hobbies: candidateHobbies, verified: candidate.profile.isVerified },
      );

      return [
        {
          id: candidate.id.toString(),
          displayName:
            candidate.onboardingProfile?.displayName ||
            [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") ||
            "Yaaro member",
          age,
          distanceKm: distanceKm === null ? null : Math.round(distanceKm),
          headline: candidate.onboardingProfile?.headline ?? "",
          mainPhotoUrl: candidate.onboardingPhotos[0]?.url ?? null,
          city: candidate.location?.city ?? null,
          country: candidate.location?.country ?? null,
          isVerified: candidate.profile.isVerified,
          isBoosted: candidate.boosts.length > 0,
          sharedInterests: sharedHobbies,
          compatibilityScore: score,
          profile: publicProfileDetails(candidate),
        },
      ];
    })
    .sort((a, b) => Number(b.isBoosted) - Number(a.isBoosted) || b.compatibilityScore - a.compatibilityScore)
    .slice(0, limit);
}

async function dailyVibeQuestion() {
  const questions = await exploreVibeQuestions();
  if (questions.length === 0) {
    return null;
  }

  const dayNumber = Math.floor(Date.now() / 86_400_000);
  return questions[dayNumber % questions.length];
}

exploreRouter.get("/explore/categories", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const availableCards = await exploreCards(userId, () => true);
    
    if (!availableCards) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const categoryDefinitions = await exploreCategories();
    const categories = categoryDefinitions.map((category) => {
      const acceptedHobbies = category.hobbies.map((h) => h.toLowerCase());
      const count = availableCards.filter((card) => {
        const userHobbies = card.profile?.interests?.hobbies ?? [];
        return userHobbies.some((hobby) => acceptedHobbies.includes(hobby.toLowerCase()));
      }).length;

      return {
        ...category,
        count,
      };
    });

    res.json({ success: true, categories });
  } catch (error) {
    next(error);
  }
});

exploreRouter.get("/explore/by-interest/:hobby", async (req: AuthenticatedRequest, res, next) => {
  try {
    const hobby = decodeURIComponent(req.params.hobby).toLowerCase();
    const categoryDefinitions = await exploreCategories();
    const category = categoryDefinitions.find(
      (item) => item.key === hobby || item.label.toLowerCase() === hobby,
    );
    const acceptedHobbies = (category?.hobbies || [decodeURIComponent(req.params.hobby)]).map((item) =>
      item.toLowerCase(),
    );
    const cards = await exploreCards(currentUserId(req), (candidate) =>
      candidate.hobbies.some((item) => acceptedHobbies.includes(item.hobby.toLowerCase())),
    );

    if (!cards) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    res.json({ success: true, cards, category: category ?? null });
  } catch (error) {
    next(error);
  }
});

exploreRouter.get("/explore/by-goal/:goal", async (req: AuthenticatedRequest, res, next) => {
  try {
    const goal = decodeURIComponent(req.params.goal).toLowerCase();
    const cards = await exploreCards(currentUserId(req), (candidate) =>
      (candidate.onboardingProfile?.relationshipGoal || "").toLowerCase() === goal,
    );

    if (!cards) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    res.json({ success: true, cards, goal: req.params.goal });
  } catch (error) {
    next(error);
  }
});

exploreRouter.get("/explore/nearby", async (req: AuthenticatedRequest, res, next) => {
  try {
    const cards = await exploreCards(
      currentUserId(req),
      (_candidate, distanceKm) => distanceKm !== null && distanceKm <= 2,
    );

    if (!cards) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    res.json({ success: true, cards, radiusKm: 2 });
  } catch (error) {
    next(error);
  }
});

exploreRouter.get("/explore/vibes/today", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const question = await dailyVibeQuestion();
    if (!question) {
      return res.json({ success: true, question: null, answer: null });
    }

    const existing = await prisma.$queryRaw<Array<{ answer: string }>>`
      SELECT answer FROM vibe_responses WHERE user_id = ${userId} AND question_id = ${question.id} LIMIT 1
    `;

    res.json({ success: true, question, answer: existing[0]?.answer ?? null });
  } catch (error) {
    next(error);
  }
});

exploreRouter.post("/explore/vibes/respond", async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const question = await dailyVibeQuestion();
    if (!question) {
      return res.status(404).json({ success: false, message: "Today's vibe question is unavailable." });
    }

    const answer = String(req.body.answer || "");

    if (!question.answers.includes(answer)) {
      return res.status(400).json({ success: false, message: "Choose one of today's vibe answers." });
    }

    await prisma.$executeRaw`
      INSERT INTO vibe_responses (user_id, question_id, answer, updated_at)
      VALUES (${userId}, ${question.id}, ${answer}, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, question_id)
      DO UPDATE SET answer = EXCLUDED.answer, updated_at = CURRENT_TIMESTAMP
    `;

    const matchingRows = await prisma.$queryRaw<Array<{ user_id: bigint }>>`
      SELECT user_id FROM vibe_responses
      WHERE question_id = ${question.id} AND answer = ${answer} AND user_id <> ${userId}
      ORDER BY updated_at DESC
      LIMIT 50
    `;
    const matchingIds = new Set(matchingRows.map((row) => row.user_id.toString()));
    const cards = await exploreCards(userId, (candidate) => matchingIds.has(candidate.id.toString()), 12);

    res.json({ success: true, question, answer, cards: cards ?? [] });
  } catch (error) {
    next(error);
  }
});
