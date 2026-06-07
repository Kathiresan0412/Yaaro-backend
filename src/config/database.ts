import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "./env";

/**
 * Database configuration for 2M+ user scale.
 *
 * Architecture:
 *   App instances → PgBouncer (transaction pooling) → PostgreSQL primary + read replicas
 *
 * - The local pool size per instance is kept moderate (20 connections).
 *   PgBouncer handles multiplexing thousands of app connections into ~100 real DB connections.
 * - A separate read client points to read replicas for discovery/profile queries.
 * - With this setup, 100+ concurrent users don't wait — PgBouncer queues and multiplexes transparently.
 *
 * Required env vars:
 *   DATABASE_URL         — PgBouncer pooler URL (port 6543 on most providers)
 *   DATABASE_READ_URL    — Read replica pooler URL (optional, falls back to DATABASE_URL)
 *   DATABASE_POOL_MAX    — Connections per instance (default: 20, PgBouncer handles the rest)
 */

function cleanConnectionString(url: string) {
  if (!url) return url;
  const parsed = new URL(url);
  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("uselibpqcompat");
  return parsed.toString();
}

function requiresSsl(url: string) {
  return url.includes("sslmode=");
}

function createAdapter(connectionString: string) {
  const ssl = requiresSsl(connectionString);
  return new PrismaPg({
    connectionString: cleanConnectionString(connectionString),
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    max: env.databasePoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var prismaRead: PrismaClient | undefined;
}

/**
 * Primary client — used for all writes and time-sensitive reads.
 * Points to PgBouncer → PostgreSQL primary.
 */
export const prisma =
  globalThis.prisma ??
  new PrismaClient({
    adapter: createAdapter(env.databaseUrl),
    log: env.nodeEnv === "development" ? ["error", "warn"] : ["error"],
  });

/**
 * Read replica client — used for heavy read queries (discovery, explore, profile views).
 * Points to PgBouncer → Read replica(s).
 * Falls back to the primary if DATABASE_READ_URL is not configured.
 */
export const prismaRead =
  globalThis.prismaRead ??
  new PrismaClient({
    adapter: createAdapter(env.databaseReadUrl || env.databaseUrl),
    log: env.nodeEnv === "development" ? ["error", "warn"] : ["error"],
  });

if (env.nodeEnv !== "production") {
  globalThis.prisma = prisma;
  globalThis.prismaRead = prismaRead;
}
