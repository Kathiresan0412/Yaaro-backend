import { Router, type NextFunction, type Response } from "express";
import type { Gender, UserProfile } from "@prisma/client";
import { prisma } from "../config/database";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.middleware";
import { isSupportedImageUploadSource, uploadProfilePhoto } from "../services/media.service";
import { assertSafeText } from "../services/content-safety.service";
import { requireTier } from "../services/premium.service";
import { interestBadges } from "../services/interest-badges.service";
import { invalidateUserCache } from "../services/cache.service";

export const profileRouter = Router();

profileRouter.use(requireAuth);

const scalarProfileFields = [
  "displayName",
  "pronouns",
  "headline",
  "bio",
  "heightCm",
  "bodyType",
  "hairColour",
  "eyeColour",
  "education",
  "jobTitle",
  "company",
  "industry",
  "religion",
  "nationality",
  "smoking",
  "drinking",
  "exercise",
  "diet",
  "sleepSchedule",
  "livingSituation",
  "hasChildren",
  "wantsChildren",
  "wantsPets",
  "favPet",
  "favColour",
  "loveLanguage",
  "relationshipGoal",
  "mbti",
  "spotifyAnthemId",
  "spotifyAnthemName",
  "spotifyPreviewUrl",
  "spotifyAlbumArtUrl",
] as const;

const arrayProfileFields = [
  "sexualOrientation",
  "ethnicity",
  "languages",
  "hasPets",
  "favFood",
  "favMusic",
  "favMovieGenre",
] as const;

function userId(req: AuthenticatedRequest) {
  if (!req.auth?.userId) {
    throw new Error("Authenticated user missing.");
  }

  return req.auth.userId;
}

function cleanString(value: unknown, max = 255) {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function cleanArray(value: unknown, maxItems = 20) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => cleanString(item, 80))
    .filter((item): item is string => Boolean(item))
    .slice(0, maxItems);
}

function cleanInteger(value: unknown, min: number, max: number) {
  const numberValue = Number(value);

  if (!Number.isInteger(numberValue)) {
    return null;
  }

  return Math.min(max, Math.max(min, numberValue));
}

function parseCoreGender(value: unknown): Gender | null {
  return value === "male" || value === "female" || value === "non_binary" || value === "other" ? value : null;
}

function parseDateOfBirth(value: unknown) {
  const raw = cleanString(value, 20);

  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null;
  }

  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isAdult(dateOfBirth: Date) {
  const today = new Date();
  const age = today.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const birthdayThisYear = new Date(
    Date.UTC(today.getUTCFullYear(), dateOfBirth.getUTCMonth(), dateOfBirth.getUTCDate()),
  );
  const hasHadBirthday = today.getTime() >= birthdayThisYear.getTime();
  return age > 18 || (age === 18 && hasHadBirthday);
}

function starSign(dateOfBirth?: Date | null) {
  if (!dateOfBirth) {
    return null;
  }

  const day = dateOfBirth.getUTCDate();
  const month = dateOfBirth.getUTCMonth() + 1;
  const signs = [
    ["Capricorn", 20],
    ["Aquarius", 19],
    ["Pisces", 20],
    ["Aries", 20],
    ["Taurus", 21],
    ["Gemini", 21],
    ["Cancer", 22],
    ["Leo", 23],
    ["Virgo", 23],
    ["Libra", 23],
    ["Scorpio", 22],
    ["Sagittarius", 22],
    ["Capricorn", 32],
  ] as const;

  return day < signs[month - 1][1] ? signs[month - 1][0] : signs[month][0];
}

function serializePhoto(photo: {
  id: bigint;
  url: string;
  orderIndex: number;
  isPrimary: boolean;
  status: string;
  createdAt: Date;
}) {
  return {
    id: photo.id.toString(),
    url: photo.url,
    orderIndex: photo.orderIndex,
    isPrimary: photo.isPrimary,
    status: photo.status,
    createdAt: photo.createdAt.toISOString(),
  };
}

function serializeProfile(profile: UserProfile | null) {
  if (!profile) {
    return null;
  }

  const { userId: _userId, createdAt, updatedAt, ...fields } = profile;

  return {
    ...fields,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}

function jsonArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function profileCompleteness(input: {
  profile: UserProfile | null;
  hobbies: string[];
  photoCount: number;
  hasLocation: boolean;
}) {
  const profile = input.profile;
  const sections = [
    {
      key: "photos",
      weight: 20,
      complete: input.photoCount >= 2,
      missing: input.photoCount >= 2 ? [] : ["photos"],
    },
    {
      key: "about",
      weight: 20,
      complete: Boolean(profile?.displayName && profile.headline && profile.bio),
      missing: [
        profile?.displayName ? null : "display_name",
        profile?.headline ? null : "headline",
        profile?.bio ? null : "bio",
      ].filter((item): item is string => Boolean(item)),
    },
    {
      key: "basics",
      weight: 15,
      complete: Boolean(profile?.heightCm && profile.bodyType && profile.education),
      missing: [
        profile?.heightCm ? null : "height_cm",
        profile?.bodyType ? null : "body_type",
        profile?.education ? null : "education",
      ].filter((item): item is string => Boolean(item)),
    },
    {
      key: "work",
      weight: 10,
      complete: Boolean(profile?.jobTitle || profile?.company || profile?.industry),
      missing: profile?.jobTitle || profile?.company || profile?.industry ? [] : ["job_title"],
    },
    {
      key: "lifestyle",
      weight: 10,
      complete: Boolean(profile?.smoking && profile.drinking && profile.exercise),
      missing: [
        profile?.smoking ? null : "smoking",
        profile?.drinking ? null : "drinking",
        profile?.exercise ? null : "exercise",
      ].filter((item): item is string => Boolean(item)),
    },
    {
      key: "interests",
      weight: 15,
      complete: input.hobbies.length >= 3,
      missing: input.hobbies.length >= 3 ? [] : ["hobbies"],
    },
    {
      key: "enhancements",
      weight: 10,
      complete: Boolean(profile?.mbti && profile.spotifyAnthemId && input.hasLocation),
      missing: [
        profile?.mbti ? null : "mbti",
        profile?.spotifyAnthemId ? null : "spotify_anthem",
        input.hasLocation ? null : "location",
      ].filter((item): item is string => Boolean(item)),
    },
  ];

  const score = sections.reduce((sum, section) => sum + (section.complete ? section.weight : 0), 0);

  return {
    score,
    missing: sections.flatMap((section) => section.missing),
    sections: sections.map((section) => ({
      key: section.key,
      weight: section.weight,
      complete: section.complete,
      missing: section.missing,
    })),
  };
}

async function getProfilePayload(currentUserId: bigint) {
  const [user, profile, hobbies, photos, location, preferences] = await Promise.all([
    prisma.user.findUnique({
      where: { id: currentUserId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        onboardingCompleted: true,
        oauthProvider: true,
        oauthId: true,
        profile: {
          select: {
            nameEn: true,
            gender: true,
            dateOfBirth: true,
          },
        },
      },
    }),
    prisma.userProfile.findUnique({ where: { userId: currentUserId } }),
    prisma.userHobby.findMany({ where: { userId: currentUserId }, orderBy: { hobby: "asc" } }),
    prisma.userPhoto.findMany({
      where: { userId: currentUserId },
      orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
    }),
    prisma.userLocation.findUnique({ where: { userId: currentUserId } }),
    prisma.userPreference.upsert({
      where: { userId: currentUserId },
      update: {},
      create: { userId: currentUserId },
    }),
  ]);

  return {
    user: user && {
      id: user.id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      onboardingCompleted: user.onboardingCompleted,
      oauthProvider: user.oauthProvider,
      oauthId: user.oauthId,
      registeredProfile: user.profile && {
        name: user.profile.nameEn,
        gender: user.profile.gender,
        dateOfBirth: user.profile.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      },
    },
    profile: serializeProfile(profile),
    hobbies: hobbies.map((item) => item.hobby),
    photos: photos.map(serializePhoto),
    location:
      location &&
      ({
        latitude: location.latitude ? Number(location.latitude) : null,
        longitude: location.longitude ? Number(location.longitude) : null,
        city: location.city,
        country: location.country,
        passportActive: location.passportActive,
        passportLatitude: location.passportLatitude ? Number(location.passportLatitude) : null,
        passportLongitude: location.passportLongitude ? Number(location.passportLongitude) : null,
        passportCity: location.passportCity,
        passportCountry: location.passportCountry,
        passportUpdatedAt: location.passportUpdatedAt?.toISOString() ?? null,
        updatedAt: location.updatedAt.toISOString(),
      } as const),
    preferences: {
      showGender: preferences.showGender,
      minAge: preferences.minAge,
      maxAge: preferences.maxAge,
      maxDistanceKm: preferences.maxDistanceKm,
      globalMode: preferences.globalMode,
      showVerifiedOnly: preferences.showVerifiedOnly,
      showPhotosOnly: preferences.showPhotosOnly,
      incognitoMode: preferences.incognitoMode,
    },
    badges: await interestBadges(hobbies.map((item) => item.hobby)).catch(() => hobbies.map((item) => item.hobby).slice(0, 12)),
    completeness: profileCompleteness({
      profile,
      hobbies: hobbies.map((item) => item.hobby),
      photoCount: photos.length,
      hasLocation: Boolean(location),
    }),
  };
}

profileRouter.get("/me", async (req: AuthenticatedRequest, res, next) => {
  try {
    res.json({ success: true, ...(await getProfilePayload(userId(req))) });
  } catch (error) {
    console.error("[Profile /me] Error:", error);
    next(error);
  }
});

profileRouter.get("/completeness", async (req: AuthenticatedRequest, res, next) => {
  try {
    const currentUserId = userId(req);
    const [profile, hobbies, photoCount, location] = await Promise.all([
      prisma.userProfile.findUnique({ where: { userId: currentUserId } }),
      prisma.userHobby.findMany({ where: { userId: currentUserId }, orderBy: { hobby: "asc" } }),
      prisma.userPhoto.count({ where: { userId: currentUserId } }),
      prisma.userLocation.findUnique({ where: { userId: currentUserId } }),
    ]);

    res.json({
      success: true,
      ...profileCompleteness({
        profile,
        hobbies: hobbies.map((item) => item.hobby),
        photoCount,
        hasLocation: Boolean(location),
      }),
      badges: await interestBadges(hobbies.map((item) => item.hobby)),
    });
  } catch (error) {
    next(error);
  }
});

profileRouter.get("/analytics", async (req: AuthenticatedRequest, res, next) => {
  try {
    const currentUserId = userId(req);
    const entitlement = await requireTier(currentUserId, "platinum");

    if (!entitlement.allowed) {
      return res.status(403).json({
        success: false,
        message: "Profile analytics are available on Platinum.",
        tier: entitlement.tier,
      });
    }

    const now = new Date();
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [profileViews7d, likesReceived7d, swipesReceived7d, matches7d, viewsByDay] = await Promise.all([
      prisma.profileView.count({ where: { viewedId: currentUserId, viewedAt: { gte: since } } }),
      prisma.swipe.count({
        where: { swipedId: currentUserId, action: { in: ["like", "superlike"] }, createdAt: { gte: since } },
      }),
      prisma.swipe.count({ where: { swipedId: currentUserId, createdAt: { gte: since } } }),
      prisma.match.count({
        where: {
          matchedAt: { gte: since },
          OR: [{ user1Id: currentUserId }, { user2Id: currentUserId }],
        },
      }),
      prisma.profileView.groupBy({
        by: ["viewedAt"],
        where: { viewedId: currentUserId, viewedAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);

    const dailyViews = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (6 - index)));
      const key = date.toISOString().slice(0, 10);
      const count = viewsByDay
        .filter((item) => item.viewedAt.toISOString().slice(0, 10) === key)
        .reduce((sum, item) => sum + item._count._all, 0);
      return { date: key, views: count };
    });

    res.json({
      success: true,
      profileViews7d,
      profile_views_7d: profileViews7d,
      likesReceived7d,
      likes_received_7d: likesReceived7d,
      matchRatePercent: swipesReceived7d > 0 ? Math.round((matches7d / swipesReceived7d) * 100) : 0,
      match_rate_percent: swipesReceived7d > 0 ? Math.round((matches7d / swipesReceived7d) * 100) : 0,
      dailyViews,
    });
  } catch (error) {
    next(error);
  }
});

profileRouter.put("/anthem", async (req: AuthenticatedRequest, res, next) => {
  try {
    const currentUserId = userId(req);
    const anthemId = cleanString(req.body.spotifyAnthemId ?? req.body.id, 160);
    const anthemName = cleanString(req.body.spotifyAnthemName ?? req.body.name, 255);
    const artist = cleanString(req.body.artist, 160);
    const previewUrl = cleanString(req.body.spotifyPreviewUrl ?? req.body.previewUrl, 500);
    const albumArtUrl = cleanString(req.body.spotifyAlbumArtUrl ?? req.body.albumArtUrl, 500);

    if (!anthemId || !anthemName) {
      return res.status(400).json({ success: false, message: "Spotify anthem id and name are required." });
    }

    const profile = await prisma.userProfile.upsert({
      where: { userId: currentUserId },
      update: {
        spotifyAnthemId: anthemId,
        spotifyAnthemName: artist ? `${anthemName} - ${artist}` : anthemName,
        spotifyPreviewUrl: previewUrl,
        spotifyAlbumArtUrl: albumArtUrl,
      },
      create: {
        userId: currentUserId,
        spotifyAnthemId: anthemId,
        spotifyAnthemName: artist ? `${anthemName} - ${artist}` : anthemName,
        spotifyPreviewUrl: previewUrl,
        spotifyAlbumArtUrl: albumArtUrl,
      },
    });

    res.json({
      success: true,
      anthem: {
        id: profile.spotifyAnthemId,
        name: profile.spotifyAnthemName,
        previewUrl: profile.spotifyPreviewUrl,
        albumArtUrl: profile.spotifyAlbumArtUrl,
      },
    });
  } catch (error) {
    next(error);
  }
});

profileRouter.put("/me", async (req: AuthenticatedRequest, res, next) => {
  try {
    const currentUserId = userId(req);
    const user = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { firstName: true, lastName: true },
    });
    const existingCoreProfile = await prisma.profile.findUnique({
      where: { userId: currentUserId },
      select: { dateOfBirth: true, nameEn: true, gender: true },
    });
    const coreGender = "gender" in req.body ? parseCoreGender(req.body.gender) : null;
    const coreDateOfBirth = "dateOfBirth" in req.body ? parseDateOfBirth(req.body.dateOfBirth) : null;
    const data: Record<string, string | number | string[] | null> = {
      starSign: starSign(coreDateOfBirth ?? existingCoreProfile?.dateOfBirth),
    };

    for (const field of scalarProfileFields) {
      if (field in req.body) {
        const max = field === "headline" ? 60 : field === "bio" ? 500 : 255;
        if (field === "headline" || field === "bio") {
          assertSafeText(req.body[field], field === "headline" ? "Headline" : "Bio");
        }
        data[field] = field === "heightCm" ? cleanInteger(req.body[field], 90, 240) : cleanString(req.body[field], max);
      }
    }

    for (const field of arrayProfileFields) {
      if (field in req.body) {
        data[field] = cleanArray(req.body[field]);
      }
    }

    if (!data.displayName && !("displayName" in req.body)) {
      data.displayName = existingCoreProfile?.nameEn ?? null;
    }

    if ("gender" in req.body && !coreGender) {
      return res.status(400).json({ success: false, message: "Choose a valid gender." });
    }

    if ("dateOfBirth" in req.body && !coreDateOfBirth) {
      return res.status(400).json({ success: false, message: "Choose a valid date of birth." });
    }

    if (coreDateOfBirth && !isAdult(coreDateOfBirth)) {
      return res.status(400).json({ success: false, message: "You must be at least 18 years old." });
    }

    if ((coreGender || coreDateOfBirth) && !existingCoreProfile && (!coreGender || !coreDateOfBirth)) {
      return res.status(400).json({
        success: false,
        message: "Gender and date of birth are required to activate matching.",
      });
    }

    const hobbies = cleanArray(req.body.hobbies, 10);

    await prisma.$transaction(async (tx) => {
      if (coreGender || coreDateOfBirth) {
        const createGender = coreGender ?? existingCoreProfile?.gender;
        const createDateOfBirth = coreDateOfBirth ?? existingCoreProfile?.dateOfBirth;
        const fallbackName =
          data.displayName?.toString() ||
          [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
          "Yaaro Member";

        await tx.profile.upsert({
          where: { userId: currentUserId },
          update: {
            ...(coreGender ? { gender: coreGender } : {}),
            ...(coreDateOfBirth ? { dateOfBirth: coreDateOfBirth } : {}),
          },
          create: {
            userId: currentUserId,
            nameEn: fallbackName,
            gender: createGender!,
            dateOfBirth: createDateOfBirth!,
          },
        });
      }

      await tx.userProfile.upsert({
        where: { userId: currentUserId },
        update: data,
        create: { userId: currentUserId, ...data },
      });

      if ("hobbies" in req.body) {
        await tx.userHobby.deleteMany({ where: { userId: currentUserId } });
        if (hobbies.length > 0) {
          await tx.userHobby.createMany({
            data: hobbies.map((hobby) => ({ userId: currentUserId, hobby })),
            skipDuplicates: true,
          });
        }
      }
    });

    // Invalidate cache so other users see updated info in discovery/matches
    await invalidateUserCache(currentUserId);

    res.json({ success: true, ...(await getProfilePayload(currentUserId)) });
  } catch (error) {
    next(error);
  }
});

profileRouter.get("/photos", async (req: AuthenticatedRequest, res, next) => {
  try {
    const photos = await prisma.userPhoto.findMany({
      where: { userId: userId(req) },
      orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
    });

    res.json({ success: true, photos: photos.map(serializePhoto) });
  } catch (error) {
    next(error);
  }
});

profileRouter.post("/photos", async (req: AuthenticatedRequest, res, next) => {
  try {
    const currentUserId = userId(req);
    const source = cleanString(req.body.imageDataUrl, 5000000) || cleanString(req.body.url, 5000);

    if (!source || !isSupportedImageUploadSource(source)) {
      return res.status(400).json({ success: false, message: "A photo URL or image data URL is required." });
    }

    const count = await prisma.userPhoto.count({ where: { userId: currentUserId } });

    if (count >= 9) {
      return res.status(400).json({ success: false, message: "You can upload up to 9 photos." });
    }

    const upload = await uploadProfilePhoto(source, currentUserId);

    const photo = await prisma.userPhoto.create({
      data: {
        userId: currentUserId,
        url: upload.secure_url,
        orderIndex: count,
        isPrimary: count === 0,
      },
    });

    res.status(201).json({ success: true, photo: serializePhoto(photo) });
  } catch (error) {
    next(error);
  }
});

profileRouter.delete("/photos/:id", async (req: AuthenticatedRequest, res, next) => {
  try {
    const currentUserId = userId(req);
    const id = BigInt(req.params.id);

    await prisma.userPhoto.deleteMany({ where: { id, userId: currentUserId } });

    const photos = await prisma.userPhoto.findMany({
      where: { userId: currentUserId },
      orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
    });

    await prisma.$transaction(
      photos.map((photo, index) =>
        prisma.userPhoto.update({
          where: { id: photo.id },
          data: { orderIndex: index, isPrimary: index === 0 },
        }),
      ),
    );

    res.json({ success: true, ...(await getProfilePayload(currentUserId)) });
  } catch (error) {
    next(error);
  }
});

profileRouter.put("/photos/reorder", async (req: AuthenticatedRequest, res, next) => {
  try {
    const currentUserId = userId(req);
    const ids: unknown[] = Array.isArray(req.body.photoIds) ? req.body.photoIds : [];

    if (ids.length < 1) {
      return res.status(400).json({ success: false, message: "Photo order is required." });
    }

    const photoIds = ids.map((id) => BigInt(String(id)));
    const ownedCount = await prisma.userPhoto.count({
      where: { userId: currentUserId, id: { in: photoIds } },
    });

    if (ownedCount !== photoIds.length) {
      return res.status(400).json({ success: false, message: "Photo order contains an unknown photo." });
    }

    await prisma.$transaction(
      photoIds.map((id, index) =>
        prisma.userPhoto.update({
          where: { id },
          data: { orderIndex: index, isPrimary: index === 0 },
        }),
      ),
    );

    res.json({ success: true, ...(await getProfilePayload(currentUserId)) });
  } catch (error) {
    next(error);
  }
});

profileRouter.put("/photos/:id/primary", async (req: AuthenticatedRequest, res, next) => {
  try {
    const currentUserId = userId(req);
    const id = BigInt(req.params.id);

    // Fetch all current photos of this user
    const photos = await prisma.userPhoto.findMany({
      where: { userId: currentUserId },
      orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
    });

    const targetPhoto = photos.find((photo) => photo.id === id);
    if (!targetPhoto) {
      return res.status(404).json({ success: false, message: "Photo not found." });
    }

    // Reorder so target photo is at index 0 (primary), shifting others
    const remainingPhotos = photos.filter((photo) => photo.id !== id);
    const newOrder = [targetPhoto, ...remainingPhotos];

    await prisma.$transaction(
      newOrder.map((photo, index) =>
        prisma.userPhoto.update({
          where: { id: photo.id },
          data: {
            orderIndex: index,
            isPrimary: index === 0,
          },
        }),
      ),
    );

    res.json({ success: true, ...(await getProfilePayload(currentUserId)) });
  } catch (error) {
    next(error);
  }
});

profileRouter.put("/preferences", async (req: AuthenticatedRequest, res, next) => {
  try {
    const currentUserId = userId(req);
    const minAge = cleanInteger(req.body.minAge, 18, 100) ?? 18;
    const maxAge = cleanInteger(req.body.maxAge, minAge, 100) ?? Math.max(45, minAge);
    const maxDistanceKm = cleanInteger(req.body.maxDistanceKm, 1, 20000) ?? 150;
    const showGender = cleanString(req.body.showGender, 40) || "everyone";

    const preferences = await prisma.userPreference.upsert({
      where: { userId: currentUserId },
      update: {
        showGender,
        minAge,
        maxAge,
        maxDistanceKm,
        globalMode: Boolean(req.body.globalMode),
        showVerifiedOnly: Boolean(req.body.showVerifiedOnly),
        showPhotosOnly: req.body.showPhotosOnly !== false,
      },
      create: {
        userId: currentUserId,
        showGender,
        minAge,
        maxAge,
        maxDistanceKm,
        globalMode: Boolean(req.body.globalMode),
        showVerifiedOnly: Boolean(req.body.showVerifiedOnly),
        showPhotosOnly: req.body.showPhotosOnly !== false,
      },
    });

    // Preferences change the discovery results – invalidate discovery cache
    await invalidateUserCache(currentUserId);

    res.json({
      success: true,
      preferences: {
        showGender: preferences.showGender,
        minAge: preferences.minAge,
        maxAge: preferences.maxAge,
        maxDistanceKm: preferences.maxDistanceKm,
        globalMode: preferences.globalMode,
        showVerifiedOnly: preferences.showVerifiedOnly,
        showPhotosOnly: preferences.showPhotosOnly,
      },
    });
  } catch (error) {
    next(error);
  }
});

profileRouter.put("/location", async (req: AuthenticatedRequest, res, next) => {
  try {
    const currentUserId = userId(req);
    const latitude = req.body.latitude === null || req.body.latitude === undefined ? null : Number(req.body.latitude);
    const longitude = req.body.longitude === null || req.body.longitude === undefined ? null : Number(req.body.longitude);
    const city = cleanString(req.body.city, 120);
    const country = cleanString(req.body.country, 120);

    if (!city && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
      return res.status(400).json({ success: false, message: "Share your location or enter a city." });
    }

    const location = await prisma.userLocation.upsert({
      where: { userId: currentUserId },
      update: { latitude, longitude, city, country },
      create: { userId: currentUserId, latitude, longitude, city, country },
    });

    // Location changes affect distance-based discovery for all users
    await invalidateUserCache(currentUserId);

    res.json({
      success: true,
      location: {
        latitude: location.latitude ? Number(location.latitude) : null,
        longitude: location.longitude ? Number(location.longitude) : null,
        city: location.city,
        country: location.country,
        updatedAt: location.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
});

export async function completeOnboarding(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const currentUserId = userId(req);

    // Fetch user's first name to use as display name fallback
    const userRecord = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { firstName: true, profile: { select: { id: true } } },
    });
    const defaultDisplayName = userRecord?.firstName || "Yaaro Member";

    if (!userRecord?.profile) {
      return res.status(422).json({
        success: false,
        message: "Add your date of birth and gender before matching.",
        errors: {
          dateOfBirth: "Date of birth is required for matching.",
          gender: "Gender is required for matching.",
        },
      });
    }

    // 1. Photos Seeding is skipped (no default photos stored in database)

    // 2. Check and Seed Profile if missing fields
    let profile = await prisma.userProfile.findUnique({ where: { userId: currentUserId } });
    if (!profile) {
      profile = await prisma.userProfile.create({
        data: {
          userId: currentUserId,
          displayName: defaultDisplayName,
          bio: "Looking to meet verified members, discover shared interests, and have genuine conversations. Let's connect!",
        },
      });
    } else {
      let needsUpdate = false;
      const updateData: any = {};
      if (!profile.displayName?.trim()) {
        updateData.displayName = defaultDisplayName;
        needsUpdate = true;
      }
      if (!profile.bio?.trim()) {
        updateData.bio = "Looking to meet verified members, discover shared interests, and have genuine conversations. Let's connect!";
        needsUpdate = true;
      }
      if (needsUpdate) {
        profile = await prisma.userProfile.update({
          where: { userId: currentUserId },
          data: updateData,
        });
      }
    }

    // 3. Check and Seed Location if missing
    let location = await prisma.userLocation.findUnique({ where: { userId: currentUserId } });
    if (!location) {
      location = await prisma.userLocation.create({
        data: {
          userId: currentUserId,
          latitude: 40.7128,
          longitude: -74.0060,
          city: "New York",
          country: "United States",
        },
      });
    }

    const user = await prisma.user.update({
      where: { id: currentUserId },
      data: { onboardingCompleted: true },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        emailVerified: true,
        onboardingCompleted: true,
        role: true,
      },
    });

    res.json({
      success: true,
      user: {
        id: user.id.toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        emailVerified: user.emailVerified,
        onboardingCompleted: user.onboardingCompleted,
        role: user.role,
      },
      redirectTo: "/app/discover",
    });
  } catch (error) {
    next(error);
  }
}

profileRouter.patch("/onboarding/complete", completeOnboarding);
