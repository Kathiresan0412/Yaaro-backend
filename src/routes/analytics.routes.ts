import { Router } from "express";
import { prisma } from "../config/database";

export const analyticsRouter = Router();

const allowedEvents = new Set([
  "page_view",
  "swipe",
  "match_created",
  "message_sent",
  "upgrade_clicked",
  "like_back",
  "unmatch",
]);

function cleanProperties(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([key, entry]) => key.length <= 80 && typeof entry !== "function" && typeof entry !== "symbol",
    ),
  );
}

analyticsRouter.post("/analytics", async (req, res, next) => {
  try {
    const eventName = typeof req.body.eventName === "string" ? req.body.eventName.trim() : "";

    if (!allowedEvents.has(eventName)) {
      return res.status(400).json({ success: false, message: "Analytics event is not supported." });
    }

    const properties = cleanProperties(req.body.properties);
    const url = typeof req.body.url === "string" ? req.body.url.slice(0, 500) : null;
    const referrer = typeof req.body.referrer === "string" ? req.body.referrer.slice(0, 500) : null;
    const userAgent = req.headers["user-agent"]?.slice(0, 500) || null;

    await prisma.$executeRaw`
      INSERT INTO analytics_events (user_id, event_name, properties, url, referrer, user_agent, created_at)
      VALUES (NULL, ${eventName}, ${JSON.stringify(properties)}::jsonb, ${url}, ${referrer}, ${userAgent}, NOW())
    `;

    return res.status(202).json({ success: true });
  } catch (error) {
    return next(error);
  }
});
