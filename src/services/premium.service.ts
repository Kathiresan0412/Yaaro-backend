import { prisma } from "../config/database";

export type PremiumTier = "free" | "plus" | "gold" | "platinum";

export type PremiumCapabilities = {
  tier: PremiumTier;
  unlimitedLikes: boolean;
  canRewind: boolean;
  canPassport: boolean;
  canIncognito: boolean;
  canSeeLikes: boolean;
  canUseTopPicks: boolean;
  priorityLikes: boolean;
  canMessageBeforeMatch: boolean;
  monthlyBoosts: number;
  superLikeLimit: number;
  superLikeWindowDays: number;
};

const TIER_RANK: Record<PremiumTier, number> = {
  free: 0,
  plus: 1,
  gold: 2,
  platinum: 3,
};

const FALLBACK_PRICES: Record<Exclude<PremiumTier, "free">, number> = {
  plus: 9.99,
  gold: 19.99,
  platinum: 29.99,
};

const DISPLAY_NAMES: Record<PremiumTier, string> = {
  free: "Free",
  plus: "Plus",
  gold: "Gold",
  platinum: "Platinum",
};

export function capabilitiesForTier(tier: PremiumTier): PremiumCapabilities {
  const paid = tier !== "free";
  const goldPlus = hasTier(tier, "gold");
  const platinum = tier === "platinum";

  return {
    tier,
    unlimitedLikes: paid,
    canRewind: paid,
    canPassport: paid,
    canIncognito: paid,
    canSeeLikes: paid,
    canUseTopPicks: goldPlus,
    priorityLikes: platinum,
    canMessageBeforeMatch: platinum,
    monthlyBoosts: paid ? 1 : 0,
    superLikeLimit: goldPlus ? 3 : 1,
    superLikeWindowDays: goldPlus ? 7 : 1,
  };
}

export function hasTier(actual: PremiumTier, required: PremiumTier) {
  return TIER_RANK[actual] >= TIER_RANK[required];
}

function asTier(value: string | null | undefined): PremiumTier {
  return value === "plus" || value === "gold" || value === "platinum" ? value : "free";
}

export async function getUserTier(userId: bigint): Promise<PremiumTier> {
  const subscription = await prisma.subscription.findFirst({
    where: {
      userId,
      status: "active",
      startsAt: { lte: new Date() },
      endsAt: { gte: new Date() },
    },
    orderBy: { endsAt: "desc" },
    select: { plan: { select: { slug: true } } },
  });

  return asTier(subscription?.plan.slug);
}

export async function getUserCapabilities(userId: bigint) {
  return capabilitiesForTier(await getUserTier(userId));
}

export async function requireTier(userId: bigint, minimumTier: PremiumTier) {
  const tier = await getUserTier(userId);
  return { tier, allowed: hasTier(tier, minimumTier), capabilities: capabilitiesForTier(tier) };
}

export async function ensureSubscriptionPlan(tier: Exclude<PremiumTier, "free">) {
  return prisma.subscriptionPlan.upsert({
    where: { slug: tier },
    update: { isActive: true },
    create: {
      slug: tier,
      name: DISPLAY_NAMES[tier],
      durationDays: 30,
      priceUsd: FALLBACK_PRICES[tier],
      features: capabilitiesForTier(tier),
      isFeatured: tier === "gold",
      isActive: true,
      displayOrder: TIER_RANK[tier],
    },
  });
}

export function monthStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}
