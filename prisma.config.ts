import "dotenv/config";
import { defineConfig } from "prisma/config";

function databaseUrl() {
  const value = process.env.DATABASE_URL;

  if (!value) {
    return "postgresql://user:password@localhost:5432/yaaro";
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
