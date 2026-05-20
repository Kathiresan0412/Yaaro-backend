import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "./env";

function databaseUrlForPg() {
  if (!env.databaseUrl) {
    return env.databaseUrl;
  }

  const url = new URL(env.databaseUrl);
  url.searchParams.delete("sslmode");
  url.searchParams.delete("uselibpqcompat");
  return url.toString();
}

const requiresSsl = env.databaseUrl.includes("sslmode=");

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: databaseUrlForPg(),
      ssl: requiresSsl ? { rejectUnauthorized: false } : undefined,
    }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}
