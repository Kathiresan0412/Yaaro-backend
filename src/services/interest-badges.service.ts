import { prisma } from "../config/database";
import { cacheGet, cacheSet, CacheTTL } from "./cache.service";

function jsonArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

export async function interestBadges(hobbies: string[]) {
  // Cache badge rules – they rarely change
  const cacheKey = "badges:rules";
  let rules = await cacheGet<Array<{ badge: string; keywords: unknown; sortOrder: number }>>(cacheKey);

  if (!rules) {
    rules = await prisma.interestBadgeRule.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { badge: "asc" }],
    });
    await cacheSet(cacheKey, rules, CacheTTL.BADGE_RULES);
  }

  const badges = new Set<string>();

  for (const hobby of hobbies) {
    const normalized = hobby.toLowerCase();
    const matched = rules.find((rule) =>
      jsonArray(rule.keywords).some((keyword) => normalized.includes(keyword.toLowerCase())),
    );
    badges.add(matched?.badge ?? hobby);
  }

  return Array.from(badges).slice(0, 12);
}
