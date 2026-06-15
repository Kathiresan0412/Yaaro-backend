import { redis } from "../config/redis";

/**
 * Lightweight cache service backed by Redis.
 * When Redis is unavailable, uses an in-memory LRU-like map (capped at 500 entries).
 *
 * Cache key conventions:
 *   discovery:{userId}        – discovery card IDs for a user
 *   matches:{userId}          – matches list for a user
 *   profile:{userId}          – public profile payload
 *   preferences:{userId}      – user discovery preferences
 *   explore:categories        – explore category definitions
 *   badges:rules              – interest badge rules
 */

const memoryCache = new Map<string, { value: string; expiresAt: number }>();
const MEMORY_LIMIT = 500;

function evictOldest() {
  if (memoryCache.size <= MEMORY_LIMIT) return;
  const firstKey = memoryCache.keys().next().value;
  if (firstKey) memoryCache.delete(firstKey);
}

export async function cacheGet<T = unknown>(key: string): Promise<T | null> {
  if (redis) {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return JSON.parse(entry.value) as T;
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const serialized = JSON.stringify(value);

  if (redis) {
    await redis.set(key, serialized, "EX", ttlSeconds);
    return;
  }

  evictOldest();
  memoryCache.set(key, { value: serialized, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function cacheDel(...keys: string[]): Promise<void> {
  if (redis) {
    await redis.del(...keys);
    return;
  }

  for (const key of keys) {
    memoryCache.delete(key);
  }
}

/**
 * Invalidate all cache entries matching a pattern (e.g., "discovery:*").
 * Only works with Redis; memory fallback clears matching keys via prefix scan.
 */
export async function cacheInvalidatePattern(pattern: string): Promise<void> {
  if (redis) {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== "0");
    return;
  }

  // Memory fallback: convert glob pattern to prefix match
  const prefix = pattern.replace(/\*$/, "");
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }
}

/**
 * Invalidate all cached data related to a specific user.
 * Call this when the user updates their profile, preferences, photos, or location.
 */
export async function invalidateUserCache(userId: bigint | string): Promise<void> {
  const id = userId.toString();
  await cacheDel(
    `discovery:${id}`,
    `matches:${id}`,
    `profile:${id}`,
    `preferences:${id}`,
    `likes:${id}`,
  );
  // Also invalidate other users' discovery caches since this user's card may appear in them
  await cacheInvalidatePattern("discovery:*");
}

// Cache TTLs (seconds)
export const CacheTTL = {
  DISCOVERY_CARDS: 60,         // 1 min – short-lived, candidates change fast
  MATCHES_LIST: 120,           // 2 min
  USER_PROFILE: 300,           // 5 min – full profile details
  PREFERENCES: 600,            // 10 min – rarely change
  EXPLORE_CATEGORIES: 300,     // 5 min – category definitions
  BADGE_RULES: 600,            // 10 min – admin-configured
  LIKES_RECEIVED: 60,          // 1 min
} as const;
