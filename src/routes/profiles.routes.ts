import { Router } from "express";
import { prisma } from "../config/database";

export const profilesRouter = Router();

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

function formatEducation(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

profilesRouter.get("/discover", async (_req, res, next) => {
  try {
    const profiles = await prisma.profile.findMany({
      where: {
        isActive: true,
        isHidden: false,
        user: {
          isActive: true,
          isBanned: false,
        },
      },
      orderBy: [{ profileCompletionPct: "desc" }, { updatedAt: "desc" }],
      take: 20,
      include: {
        user: {
          include: {
            photos: {
              where: { status: "approved" },
              orderBy: [{ isPrimary: "desc" }, { displayOrder: "asc" }],
              take: 1,
            },
          },
        },
      },
    });

    res.json({
      success: true,
      profiles: profiles.map((profile) => {
        const tags = [
          profile.motherTongue,
          profile.profession,
          formatEducation(profile.educationLevel),
          profile.isVerified ? "Verified" : null,
        ].filter(Boolean);

        return {
          id: profile.id.toString(),
          name: profile.nameEn,
          age: calculateAge(profile.dateOfBirth),
          city: profile.city ?? profile.country,
          distance: profile.country === "Sri Lanka" ? "Sri Lanka" : "Diaspora",
          match: Math.max(60, profile.profileCompletionPct),
          tags,
          bio:
            profile.bioEn ??
            "This profile is still being completed. Check back soon for more details.",
          image: profile.user.photos[0]?.photoUrl ?? null,
          isVerified: profile.isVerified,
          isWomenSafeMode: profile.isWomenSafeMode,
        };
      }),
    });
  } catch (error) {
    next(error);
  }
});
