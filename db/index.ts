import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * The Postgres connection, lazily created so importing this module never
 * requires DATABASE_URL (the client bundle types against the schema; only
 * route handlers and the game server actually connect). postgres-js runs on
 * both Node (Vercel functions) and Bun (the Fly game server); tests use the
 * PGlite driver via db/testDb.ts instead.
 */

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let instance: Db | null = null;

export function db(): Db {
  if (instance) return instance;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — see .env.example");
  // Vercel Fluid Compute reuses instances; keep the pool tiny per instance.
  instance = drizzle(postgres(url, { max: 5 }), { schema });
  return instance;
}

export { schema };
