import { defineConfig } from "drizzle-kit";

/** drizzle-kit config: migrations are generated from db/schema.ts into db/migrations (committed). */
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Only `drizzle-kit migrate/push/studio` need a live database.
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/monecraft"
  }
});
