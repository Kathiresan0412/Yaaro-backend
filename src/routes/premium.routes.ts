import { Router } from "express";
import { env } from "../config/env";
import { prisma } from "../config/database";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.middleware";
import {
  addDays,
  addMinutes,
  ensureSubscriptionPlan,
  getUserCapabilities,
  getUserTier,
  monthStart,
  requireTier,
  type PremiumTier,
} from "../services/premium.service";
import { assertSafeText } from "../services/content-safety.service";
import { notifyUser } from "../services/notification.service";

export const premiumRouter = Router();

const PAID_TIERS = ["plus", "gold", "platinum"] as const;

type PaidTier = (typeof PAID_TIERS)[number];
type CheckoutPlan = Awaited<ReturnType<typeof ensureSubscriptionPlan>>;

function currentUserId(req: AuthenticatedRequest) {
  if (!req.auth?.userId) {
    throw new Error("Authenticated user missing.");
  }

  return req.auth.userId;
}

function isPaidTier(value: unknown): value is PaidTier {
  return typeof value === "string" && PAID_TIERS.includes(value as PaidTier);
}

function stripePriceForTier(tier: PaidTier) {
  return {
    plus: env.stripePricePlus,
    gold: env.stripePriceGold,
    platinum: env.stripePricePlatinum,
  }[tier];
}

function checkoutSuccessUrl() {
  return `${env.publicWebUrl.replace(/\/$/, "")}/app/premium?checkout=success`;
}

function checkoutCancelUrl() {
  return `${env.publicWebUrl.replace(/\/$/, "")}/app/premium?checkout=cancelled`;
}

function stripeUnitAmount(plan: CheckoutPlan) {
  const amount = Number(plan.priceUsd ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Subscription plan price is not configured.");
  }

  return Math.round(amount * 100);
}

async function createStripeCheckoutSession(userId: bigint, tier: PaidTier, plan: CheckoutPlan) {
  const price = stripePriceForTier(tier);

  if (!env.stripeSecretKey) {
    return null;
  }

  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("success_url", checkoutSuccessUrl());
  params.set("cancel_url", checkoutCancelUrl());
  params.set("client_reference_id", userId.toString());
  if (price) {
    params.set("line_items[0][price]", price);
  } else {
    params.set("line_items[0][price_data][currency]", "usd");
    params.set("line_items[0][price_data][unit_amount]", stripeUnitAmount(plan).toString());
    params.set("line_items[0][price_data][recurring][interval]", "month");
    params.set("line_items[0][price_data][product_data][name]", `Yaaro0 ${plan.name}`);
  }
  params.set("line_items[0][quantity]", "1");
  params.set("metadata[userId]", userId.toString());
  params.set("metadata[tier]", tier);
  params.set("subscription_data[metadata][userId]", userId.toString());
  params.set("subscription_data[metadata][tier]", tier);

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  const payload = (await response.json()) as { id?: string; url?: string; error?: { message?: string } };

  if (!response.ok || !payload.id || !payload.url) {
    throw new Error(payload.error?.message || "Stripe checkout session could not be created.");
  }

  return payload;
}

async function activateSubscription(input: {
  userId: bigint;
  tier: PaidTier;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  checkoutSessionId?: string | null;
}) {
  const now = new Date();
  const plan = await ensureSubscriptionPlan(input.tier);

  const subscription = await prisma.subscription.upsert({
    where: input.stripeSubscriptionId
      ? { stripeSubscriptionId: input.stripeSubscriptionId }
      : { id: BigInt(0) },
    update: {
      userId: input.userId,
      planId: plan.id,
      startsAt: now,
      endsAt: addDays(now, plan.durationDays),
      status: "active",
      stripeCustomerId: input.stripeCustomerId ?? undefined,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
    },
    create: {
      userId: input.userId,
      planId: plan.id,
      startsAt: now,
      endsAt: addDays(now, plan.durationDays),
      status: "active",
      stripeSubscriptionId: input.stripeSubscriptionId ?? null,
      stripeCustomerId: input.stripeCustomerId ?? null,
    },
    include: { plan: true },
  });

  if (input.checkoutSessionId) {
    await prisma.payment.updateMany({
      where: { checkoutSessionId: input.checkoutSessionId },
      data: {
        subscriptionId: subscription.id,
        gatewayPaymentId: input.stripeSubscriptionId ?? input.checkoutSessionId,
        status: "completed",
        paidAt: now,
      },
    });
  }

  return subscription;
}

function activeLocation(location: {
  latitude: unknown;
  longitude: unknown;
  city: string | null;
  country: string | null;
  passportActive: boolean;
  passportLatitude: unknown;
  passportLongitude: unknown;
  passportCity: string | null;
  passportCountry: string | null;
  passportUpdatedAt: Date | null;
} | null) {
  if (!location) {
    return null;
  }

  const toNumber = (value: unknown) => {
    if (value === null || value === undefined) {
      return null;
    }
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  };
  const passportActive = Boolean(location.passportActive);
  return {
    latitude: toNumber(passportActive ? location.passportLatitude : location.latitude),
    longitude: toNumber(passportActive ? location.passportLongitude : location.longitude),
    city: passportActive ? location.passportCity : location.city,
    country: passportActive ? location.passportCountry : location.country,
    passportActive,
    passportUpdatedAt: location.passportUpdatedAt?.toISOString() ?? null,
  };
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

function scheduleBoostEndedNotification(boost: { id: bigint; userId: bigint; endsAt: Date }) {
  const delayMs = boost.endsAt.getTime() - Date.now();
  const maxDelayMs = 2_147_483_647;

  if (delayMs <= 0 || delayMs > maxDelayMs) {
    return;
  }

  setTimeout(() => {
    notifyUser({
      userId: boost.userId,
      type: "boost_ended",
      title: "Your Boost has ended",
      body: "Your profile boost finished. Check how many extra views it brought in.",
      data: { boostId: boost.id.toString(), url: "/app/premium" },
      push: true,
    }).catch((error) => {
      console.warn("Boost ended notification failed.", error);
    });
  }, delayMs).unref();
}

premiumRouter.get("/payments/subscription", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const [tier, subscription, boostsUsedThisMonth, activeBoost, location, preferences] = await Promise.all([
      getUserTier(userId),
      prisma.subscription.findFirst({
        where: { userId, status: "active", startsAt: { lte: new Date() }, endsAt: { gte: new Date() } },
        orderBy: { endsAt: "desc" },
        include: { plan: true },
      }),
      prisma.boost.count({ where: { userId, startedAt: { gte: monthStart() } } }),
      prisma.boost.findFirst({
        where: { userId, startedAt: { lte: new Date() }, endsAt: { gt: new Date() } },
        orderBy: { endsAt: "desc" },
      }),
      prisma.userLocation.findUnique({ where: { userId } }),
      prisma.userPreference.upsert({ where: { userId }, update: {}, create: { userId } }),
    ]);
    const capabilities = await getUserCapabilities(userId);

    res.json({
      success: true,
      tier,
      capabilities,
      subscription: subscription && {
        id: subscription.id.toString(),
        plan: subscription.plan.slug,
        status: subscription.status,
        startsAt: subscription.startsAt.toISOString(),
        endsAt: subscription.endsAt.toISOString(),
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      },
      boost: activeBoost && {
        id: activeBoost.id.toString(),
        startedAt: activeBoost.startedAt.toISOString(),
        endsAt: activeBoost.endsAt.toISOString(),
        viewsGained: activeBoost.viewsGained,
      },
      boostsRemaining: Math.max(0, capabilities.monthlyBoosts - boostsUsedThisMonth),
      location: activeLocation(location),
      preferences: { incognitoMode: preferences.incognitoMode },
    });
  } catch (error) {
    next(error);
  }
});

premiumRouter.post("/payments/create-checkout", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const tier = req.body.tier;

    if (!isPaidTier(tier)) {
      return res.status(400).json({ success: false, message: "Choose plus, gold, or platinum." });
    }

    const plan = await ensureSubscriptionPlan(tier);
    const session = await createStripeCheckoutSession(userId, tier, plan);

    if (!session) {
      return res.status(503).json({
        success: false,
        message: "Stripe is not configured for this environment.",
      });
    }

    await prisma.payment.create({
      data: {
        userId,
        planId: plan.id,
        gateway: "stripe",
        gatewayOrderId: session.id,
        checkoutSessionId: session.id,
        amount: plan.priceUsd ?? 0,
        currency: "USD",
        status: "pending",
        gatewayResponse: session,
      },
    });

    res.status(201).json({ success: true, checkoutUrl: session.url, sessionId: session.id });
  } catch (error) {
    next(error);
  }
});

premiumRouter.post("/payments/webhook", async (req, res, next) => {
  try {
    const event = req.body as {
      type?: string;
      data?: { object?: Record<string, unknown> };
    };
    const object = event.data?.object ?? {};

    if (event.type === "checkout.session.completed") {
      const metadata = (object.metadata ?? {}) as Record<string, string | undefined>;
      const tier = metadata.tier;
      const userId = metadata.userId || String(object.client_reference_id || "");

      if (isPaidTier(tier) && userId) {
        await activateSubscription({
          userId: BigInt(userId),
          tier,
          stripeSubscriptionId: String(object.subscription || ""),
          stripeCustomerId: String(object.customer || ""),
          checkoutSessionId: String(object.id || ""),
        });
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const subscriptionId = String(object.id || "");
      if (subscriptionId) {
        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: subscriptionId },
          data: { status: "expired", cancelledAt: new Date(), endsAt: new Date() },
        });
      }
    }

    res.json({ received: true });
  } catch (error) {
    next(error);
  }
});

premiumRouter.post("/payments/cancel", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const subscription = await prisma.subscription.findFirst({
      where: { userId, status: "active", endsAt: { gte: new Date() } },
      orderBy: { endsAt: "desc" },
      include: { plan: true },
    });

    if (!subscription) {
      return res.status(404).json({ success: false, message: "No active subscription found." });
    }

    if (subscription.stripeSubscriptionId && env.stripeSecretKey) {
      const params = new URLSearchParams();
      params.set("cancel_at_period_end", "true");
      await fetch(`https://api.stripe.com/v1/subscriptions/${subscription.stripeSubscriptionId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      });
    }

    const updated = await prisma.subscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd: true, cancelledAt: new Date() },
      include: { plan: true },
    });

    res.json({
      success: true,
      subscription: {
        id: updated.id.toString(),
        plan: updated.plan.slug,
        status: updated.status,
        endsAt: updated.endsAt.toISOString(),
        cancelAtPeriodEnd: updated.cancelAtPeriodEnd,
      },
    });
  } catch (error) {
    next(error);
  }
});

premiumRouter.post("/boost/start", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const capabilities = await getUserCapabilities(userId);

    if (capabilities.monthlyBoosts <= 0) {
      return res.status(403).json({
        success: false,
        upgradeRequired: true,
        message: "Boost is available on Plus, Gold, and Platinum.",
      });
    }

    const now = new Date();
    const [activeBoost, usedThisMonth] = await Promise.all([
      prisma.boost.findFirst({ where: { userId, startedAt: { lte: now }, endsAt: { gt: now } } }),
      prisma.boost.count({ where: { userId, startedAt: { gte: monthStart(now) } } }),
    ]);

    if (activeBoost) {
      return res.json({
        success: true,
        boost: {
          id: activeBoost.id.toString(),
          startedAt: activeBoost.startedAt.toISOString(),
          endsAt: activeBoost.endsAt.toISOString(),
          viewsGained: activeBoost.viewsGained,
        },
      });
    }

    if (usedThisMonth >= capabilities.monthlyBoosts) {
      return res.status(429).json({
        success: false,
        limitReached: true,
        message: "Your free monthly boost has already been used.",
      });
    }

    const boost = await prisma.boost.create({
      data: { userId, startedAt: now, endsAt: addMinutes(now, 30), source: "monthly" },
    });
    scheduleBoostEndedNotification(boost);

    res.status(201).json({
      success: true,
      boost: {
        id: boost.id.toString(),
        startedAt: boost.startedAt.toISOString(),
        endsAt: boost.endsAt.toISOString(),
        viewsGained: boost.viewsGained,
      },
    });
  } catch (error) {
    next(error);
  }
});

premiumRouter.post("/profile/location/passport", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const gate = await requireTier(userId, "plus");

    if (!gate.allowed) {
      return res.status(403).json({
        success: false,
        upgradeRequired: true,
        message: "Passport is available on Plus, Gold, and Platinum.",
      });
    }

    const active = req.body.active !== false;

    if (!active) {
      const location = await prisma.userLocation.update({
        where: { userId },
        data: {
          passportActive: false,
          passportLatitude: null,
          passportLongitude: null,
          passportCity: null,
          passportCountry: null,
          passportUpdatedAt: new Date(),
        },
      });
      return res.json({ success: true, location: activeLocation(location) });
    }

    const latitude = Number(req.body.latitude);
    const longitude = Number(req.body.longitude);
    const city = typeof req.body.city === "string" ? req.body.city.trim().slice(0, 120) : null;
    const country = typeof req.body.country === "string" ? req.body.country.trim().slice(0, 120) : null;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ success: false, message: "Latitude and longitude are required." });
    }

    const location = await prisma.userLocation.upsert({
      where: { userId },
      update: {
        passportActive: true,
        passportLatitude: latitude,
        passportLongitude: longitude,
        passportCity: city,
        passportCountry: country,
        passportUpdatedAt: new Date(),
      },
      create: {
        userId,
        passportActive: true,
        passportLatitude: latitude,
        passportLongitude: longitude,
        passportCity: city,
        passportCountry: country,
        passportUpdatedAt: new Date(),
      },
    });

    res.json({ success: true, location: activeLocation(location) });
  } catch (error) {
    next(error);
  }
});

premiumRouter.patch("/profile/preferences/incognito", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const enabled = Boolean(req.body.enabled ?? req.body.incognitoMode);

    if (enabled) {
      const gate = await requireTier(userId, "plus");
      if (!gate.allowed) {
        return res.status(403).json({
          success: false,
          upgradeRequired: true,
          message: "Incognito is available on Plus, Gold, and Platinum.",
        });
      }
    }

    const preferences = await prisma.userPreference.upsert({
      where: { userId },
      update: { incognitoMode: enabled },
      create: { userId, incognitoMode: enabled },
    });

    res.json({ success: true, incognitoMode: preferences.incognitoMode });
  } catch (error) {
    next(error);
  }
});

premiumRouter.post("/super-like", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const targetUserId = BigInt(String(req.body.target_user_id || req.body.targetUserId || ""));
    const rawMessage = typeof req.body.message === "string" ? req.body.message.trim() : "";
    const message = rawMessage ? rawMessage.slice(0, 140) : null;
    const capabilities = await getUserCapabilities(userId);

    if (targetUserId === userId) {
      return res.status(400).json({ success: false, message: "You cannot Super Like yourself." });
    }

    if (message && !capabilities.canMessageBeforeMatch) {
      return res.status(403).json({
        success: false,
        upgradeRequired: true,
        message: "Message before match is available on Platinum.",
      });
    }

    if (message) {
      assertSafeText(message, "Super Like message");
    }

    const since = addDays(new Date(), -capabilities.superLikeWindowDays);
    const used = await prisma.superLike.count({ where: { userId, sentAt: { gte: since } } });

    if (used >= capabilities.superLikeLimit) {
      return res.status(429).json({
        success: false,
        limitReached: true,
        message: capabilities.tier === "free" || capabilities.tier === "plus"
          ? "You have used today's Super Like."
          : "You have used this week's Super Likes.",
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
          { blockerId: userId, blockedId: targetUserId },
          { blockerId: targetUserId, blockedId: userId },
        ],
      },
      select: { id: true },
    });

    if (blocked) {
      return res.status(404).json({ success: false, message: "Profile is not available." });
    }

    const reverseSwipe = await prisma.swipe.findUnique({
      where: { swiperId_swipedId: { swiperId: targetUserId, swipedId: userId } },
    });
    const isMutual = Boolean(reverseSwipe && ["like", "superlike"].includes(reverseSwipe.action));
    let matchId: string | null = null;

    await prisma.$transaction(async (tx) => {
      const swipe = await tx.swipe.create({
        data: { swiperId: userId, swipedId: targetUserId, action: "superlike" },
      });

      await tx.superLike.create({
        data: { userId, targetUserId, message, swipeId: swipe.id },
      });

      if (isMutual) {
        const user1Id = userId < targetUserId ? userId : targetUserId;
        const user2Id = userId < targetUserId ? targetUserId : userId;
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
      const [senderName, receiverName] = await Promise.all([
        displayNameForUser(userId),
        displayNameForUser(targetUserId),
      ]);

      await Promise.all([
        notifyUser({
          userId,
          type: "new_match",
          title: "It's a match",
          body: `You and ${receiverName} liked each other.`,
          data: { matchId, userId: targetUserId.toString(), url: "/app/matches" },
          push: true,
          emailTemplateId: "new_match",
        }),
        notifyUser({
          userId: targetUserId,
          type: "new_match",
          title: "It's a match",
          body: `You and ${senderName} liked each other.`,
          data: { matchId, userId: userId.toString(), url: "/app/matches" },
          push: true,
          emailTemplateId: "new_match",
        }),
      ]);
    } else {
      const senderName = await displayNameForUser(userId);
      await notifyUser({
        userId: targetUserId,
        type: "super_like",
        title: "You received a Super Like",
        body: message ? `${senderName}: ${message}` : `${senderName} sent you a Super Like.`,
        data: { userId: userId.toString(), url: "/app/discover" },
        push: true,
        emailTemplateId: "super_like",
      });
    }

    res.status(201).json({ success: true, matched: isMutual, matchId });
  } catch (error) {
    next(error);
  }
});

premiumRouter.get("/top-picks", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = currentUserId(req);
    const gate = await requireTier(userId, "gold");

    if (!gate.allowed) {
      return res.status(403).json({
        success: false,
        upgradeRequired: true,
        message: "Top Picks are available on Gold and Platinum.",
      });
    }

    const today = new Date(new Date().toISOString().slice(0, 10));
    const cached = await prisma.topPickBatch.findUnique({
      where: { userId_pickDate: { userId, pickDate: today } },
    });

    const pickIds = Array.isArray(cached?.picks)
      ? cached.picks.map((id) => BigInt(String(id))).slice(0, 10)
      : [];

    let ids = pickIds;

    if (ids.length === 0) {
      const swipes = await prisma.swipe.findMany({ where: { swiperId: userId }, select: { swipedId: true } });
      const swipedIds = swipes.map((swipe) => swipe.swipedId);
      const candidates = await prisma.user.findMany({
        where: {
          id: { notIn: [userId, ...swipedIds] },
          onboardingCompleted: true,
          isActive: true,
          isBanned: false,
          status: "active",
          onboardingProfile: { isNot: null },
          profile: { isNot: null },
          discoveryPreference: { is: { incognitoMode: false } },
        },
        orderBy: [{ lastActiveAt: "desc" }, { createdAt: "desc" }],
        take: 10,
        select: { id: true },
      });
      ids = candidates.map((candidate) => candidate.id);

      await prisma.topPickBatch.upsert({
        where: { userId_pickDate: { userId, pickDate: today } },
        update: { picks: ids.map((id) => id.toString()) },
        create: { userId, pickDate: today, picks: ids.map((id) => id.toString()) },
      });
    }

    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      include: {
        onboardingProfile: true,
        onboardingPhotos: { orderBy: [{ isPrimary: "desc" }, { orderIndex: "asc" }, { id: "asc" }] },
        profile: true,
      },
    });
    const byId = new Map(users.map((user) => [user.id.toString(), user]));

    res.json({
      success: true,
      refreshesAt: addDays(today, 1).toISOString(),
      picks: ids.flatMap((id) => {
        const user = byId.get(id.toString());
        if (!user) {
          return [];
        }
        return [{
          id: user.id.toString(),
          displayName:
            user.onboardingProfile?.displayName ||
            [user.firstName, user.lastName].filter(Boolean).join(" ") ||
            "Yaaro member",
          headline: user.onboardingProfile?.headline ?? "",
          mainPhotoUrl: user.onboardingPhotos[0]?.url ?? null,
          isVerified: user.profile?.isVerified ?? false,
        }];
      }),
    });
  } catch (error) {
    next(error);
  }
});
