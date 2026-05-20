import "dotenv/config";
import { defineConfig } from "prisma/config";

function databaseUrl() {
  const value = process.env.DATABASE_URL;

  if (!value) {
    throw new Error("DATABASE_URL is required.");
  }

  const url = new URL(value);
  if (url.searchParams.get("sslmode") === "require") {
    url.searchParams.set("uselibpqcompat", "true");
  }

  return url.toString();
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl(),
  },
});
