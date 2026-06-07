import Redis from "ioredis";
import { env } from "./env";

/**
 * Redis client used for caching discovery/matching results.
 * Falls back to a no-op in-memory map when REDIS_URL is not configured.
 */

let redis: Redis | null = null;

if (env.redisUrl) {
  redis = new Redis(env.redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,
  });

  redis.on("error", (err) => {
    console.error("[Redis] Connection error:", err.message);
  });

  redis.connect().catch(() => {
    console.warn("[Redis] Could not connect, caching disabled.");
    redis = null;
  });
}

export { redis };
