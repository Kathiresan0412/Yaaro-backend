import { Router } from "express";
import { prisma } from "../config/database";
import { authRouter } from "./auth.routes";
import { completeOnboarding, profileRouter } from "./profile.routes";
import { profilesRouter } from "./profiles.routes";
import { discoveryRouter } from "./discovery.routes";
import { matchesRouter } from "./matches.routes";
import { messagesRouter } from "./messages.routes";
import { exploreRouter } from "./explore.routes";
import { premiumRouter } from "./premium.routes";
import { safetyRouter } from "./safety.routes";
import { notificationsRouter } from "./notifications.routes";
import { spotifyRouter } from "./spotify.routes";
import { mbtiRouter } from "./mbti.routes";
import { doubleDateRouter } from "./double-date.routes";
import { analyticsRouter } from "./analytics.routes";
import { requireAuth } from "../middleware/auth.middleware";

export const apiRouter = Router();

apiRouter.get("/health", (_req, res) => {
  res.json({ success: true, service: "yaro0-api" });
});

apiRouter.get("/health/db", async (_req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, database: "postgresql", status: "connected" });
  } catch (error) {
    next(error);
  }
});

apiRouter.use("/auth", authRouter);
apiRouter.use("/profile", profileRouter);
apiRouter.patch("/onboarding/complete", requireAuth, completeOnboarding);
apiRouter.use("/profiles", profilesRouter);
apiRouter.use(discoveryRouter);
apiRouter.use(exploreRouter);
apiRouter.use(matchesRouter);
apiRouter.use(messagesRouter);
apiRouter.use(premiumRouter);
apiRouter.use(safetyRouter);
apiRouter.use(notificationsRouter);
apiRouter.use(spotifyRouter);
apiRouter.use(mbtiRouter);
apiRouter.use(doubleDateRouter);
apiRouter.use(analyticsRouter);
