import "dotenv/config";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/config/database";
import { hashPassword } from "../src/utils/password";

const exploreCategories = [
  { key: "fitness", label: "Fitness", emoji: "🏋️", hobbies: ["Fitness", "Gym", "Yoga", "Running", "Cycling"], sortOrder: 10 },
  { key: "foodies", label: "Foodies", emoji: "🍕", hobbies: ["Cooking", "Food", "Baking", "Restaurants"], sortOrder: 20 },
  { key: "travel", label: "Travel", emoji: "✈️", hobbies: ["Travel", "Backpacking", "Road trips", "Beaches"], sortOrder: 30 },
  { key: "gamers", label: "Gamers", emoji: "🎮", hobbies: ["Gaming", "Esports", "Board games"], sortOrder: 40 },
  { key: "music", label: "Music", emoji: "🎵", hobbies: ["Music", "Concerts", "Singing", "Dancing"], sortOrder: 50 },
  { key: "outdoors", label: "Outdoors", emoji: "🌲", hobbies: ["Hiking", "Camping", "Nature", "Adventure"], sortOrder: 60 },
  { key: "creatives", label: "Creatives", emoji: "🎨", hobbies: ["Art", "Photography", "Writing", "Design"], sortOrder: 70 },
  { key: "bookworms", label: "Bookworms", emoji: "📚", hobbies: ["Reading", "Books", "Poetry"], sortOrder: 80 },
];

const exploreVibeQuestions = [
  {
    key: "daily-2026-05-18",
    prompt: "A perfect weekend starts with...",
    answers: ["A spontaneous trip", "A slow morning"],
    sortOrder: 10,
  },
  {
    key: "daily-2026-05-19",
    prompt: "Choose your date energy.",
    answers: ["Street food crawl", "Quiet rooftop talk"],
    sortOrder: 20,
  },
  {
    key: "daily-2026-05-20",
    prompt: "Would you rather...",
    answers: ["Travel often", "Build a cozy home"],
    sortOrder: 30,
  },
];

const interestBadgeRules = [
  { badge: "Gamer", keywords: ["game", "gaming", "esports", "playstation", "xbox"], sortOrder: 10 },
  { badge: "Traveller", keywords: ["travel", "trip", "backpacking", "passport"], sortOrder: 20 },
  { badge: "Foodie", keywords: ["food", "cooking", "baking", "restaurant"], sortOrder: 30 },
  { badge: "Music Lover", keywords: ["music", "singing", "guitar", "piano", "concert"], sortOrder: 40 },
  { badge: "Bookworm", keywords: ["book", "reading", "novel", "poetry"], sortOrder: 50 },
  { badge: "Fitness", keywords: ["gym", "fitness", "running", "yoga", "workout"], sortOrder: 60 },
  { badge: "Creative", keywords: ["art", "design", "painting", "photography", "writing"], sortOrder: 70 },
  { badge: "Movie Buff", keywords: ["movie", "cinema", "film", "netflix"], sortOrder: 80 },
  { badge: "Nature", keywords: ["hiking", "nature", "camping", "beach", "garden"], sortOrder: 90 },
];

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required to seed the admin user`);
  }
  return value;
}

async function main() {
  const email = requireEnv("ADMIN_EMAIL").toLowerCase();
  const phone = requireEnv("ADMIN_PHONE");
  const password = requireEnv("ADMIN_PASSWORD");
  const passwordHash = hashPassword(password);

  const admin = await prisma.user.upsert({
    where: { phone },
    update: {
      email,
      role: "super_admin",
      isActive: true,
      isBanned: false,
      passwordHash,
      passwordUpdatedAt: new Date(),
    },
    create: {
      phone,
      email,
      role: "super_admin",
      isActive: true,
      phoneVerifiedAt: new Date(),
      passwordHash,
      passwordUpdatedAt: new Date(),
    },
    select: {
      id: true,
      email: true,
      phone: true,
      role: true,
    },
  });

  const portalAdmin = await prisma.admin.upsert({
    where: { email },
    update: {
      passwordHash,
      role: "super_admin",
      isActive: true,
    },
    create: {
      email,
      passwordHash,
      role: "super_admin",
      isActive: true,
    },
    select: {
      id: true,
      email: true,
      role: true,
    },
  });

  await Promise.all(
    exploreCategories.map((category) =>
      prisma.exploreCategory.upsert({
        where: { key: category.key },
        update: {
          label: category.label,
          emoji: category.emoji,
          hobbies: category.hobbies as Prisma.InputJsonValue,
          sortOrder: category.sortOrder,
          isActive: true,
        },
        create: {
          key: category.key,
          label: category.label,
          emoji: category.emoji,
          hobbies: category.hobbies as Prisma.InputJsonValue,
          sortOrder: category.sortOrder,
          isActive: true,
        },
      }),
    ),
  );

  await Promise.all(
    exploreVibeQuestions.map((question) =>
      prisma.exploreVibeQuestion.upsert({
        where: { key: question.key },
        update: {
          prompt: question.prompt,
          answers: question.answers as Prisma.InputJsonValue,
          sortOrder: question.sortOrder,
          isActive: true,
        },
        create: {
          key: question.key,
          prompt: question.prompt,
          answers: question.answers as Prisma.InputJsonValue,
          sortOrder: question.sortOrder,
          isActive: true,
        },
      }),
    ),
  );

  await Promise.all(
    interestBadgeRules.map((rule) =>
      prisma.interestBadgeRule.upsert({
        where: { badge: rule.badge },
        update: {
          keywords: rule.keywords as Prisma.InputJsonValue,
          sortOrder: rule.sortOrder,
          isActive: true,
        },
        create: {
          badge: rule.badge,
          keywords: rule.keywords as Prisma.InputJsonValue,
          sortOrder: rule.sortOrder,
          isActive: true,
        },
      }),
    ),
  );

  console.log(
    JSON.stringify({
      seeded: true,
      exploreCategories: exploreCategories.length,
      exploreVibeQuestions: exploreVibeQuestions.length,
      interestBadgeRules: interestBadgeRules.length,
      admin: {
        ...admin,
          id: admin.id.toString(),
      },
      portalAdmin: {
        ...portalAdmin,
        id: portalAdmin.id.toString(),
      },
    }),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
