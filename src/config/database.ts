import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "./env";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: env.databaseUrl,
      ssl: env.databaseUrl.includes("sslmode=") ? { rejectUnauthorized: false } : undefined,
    }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}
