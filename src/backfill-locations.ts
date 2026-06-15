/**
 * One-time script to backfill lat/lng coordinates for users who have
 * city/country but missing coordinates in the user_locations table.
 *
 * Run with: npx tsx src/backfill-locations.ts
 */
import "dotenv/config";
import { prisma } from "./config/database";
import { geocodeCity } from "./services/geocoding.service";

async function backfillLocations() {
  console.log("[Backfill] Finding users with city but no coordinates...");

  const locations = await prisma.userLocation.findMany({
    where: {
      city: { not: null },
      OR: [{ latitude: null }, { longitude: null }],
    },
    select: {
      userId: true,
      city: true,
      country: true,
      latitude: true,
      longitude: true,
    },
  });

  console.log(`[Backfill] Found ${locations.length} users to geocode.`);

  let success = 0;
  let failed = 0;

  for (const loc of locations) {
    if (!loc.city) continue;

    // Respect Nominatim rate limit: 1 request per second
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const result = await geocodeCity(loc.city, loc.country ?? "");
    if (result) {
      await prisma.userLocation.update({
        where: { userId: loc.userId },
        data: {
          latitude: result.latitude,
          longitude: result.longitude,
        },
      });
      success++;
      console.log(
        `  ✓ ${loc.city}, ${loc.country} → (${result.latitude}, ${result.longitude})`,
      );
    } else {
      failed++;
      console.log(`  ✗ Could not geocode: ${loc.city}, ${loc.country}`);
    }
  }

  console.log(`\n[Backfill] Done. Success: ${success}, Failed: ${failed}`);
  await prisma.$disconnect();
}

backfillLocations().catch((e) => {
  console.error("[Backfill] Fatal error:", e);
  process.exit(1);
});
