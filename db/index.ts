import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * The Postgres connection, lazily created so importing this module never
 * requires DATABASE_URL (the client bundle types against the schema; only
 * route handlers and the game server actually connect). postgres-js runs on
 * both Node (Vercel functions) and Bun (the Fly game server); tests use the
 * PGlite driver via db/testDb.ts instead.
 *
 * `DATABASE_URL=pglite://memory` runs an EPHEMERAL in-process Postgres with
 * the schema pre-applied — the Playwright multiplayer suite and daemon-free
 * local dev use it; data lives exactly as long as the server process. Outside
 * production an unset DATABASE_URL falls back to that mode, so `bun run dev`
 * needs zero env config; production keeps the hard error (a prod deploy
 * silently running on an in-memory database would lose everything).
 */

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let instance: Db | null = null;

/**
 * The connection-string decision, separated from the connection itself so it
 * can be unit-tested (constructing PGlite under the happy-dom test runner
 * breaks on its URL polyfill). db()'s memo makes the dev warning effectively
 * once-per-process.
 */
export function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  if (process.env.NODE_ENV === "production") throw new Error("DATABASE_URL is not set — see .env.example");
  console.warn("DATABASE_URL not set — using in-memory PGlite; online data resets on restart. See .env.example for Postgres.");
  return "pglite://memory";
}

export function db(): Db {
  if (instance) return instance;
  const url = resolveDatabaseUrl();
  if (url.startsWith("pglite:")) {
    // Lazy requires keep PGlite (a WASM bundle) out of production paths.
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
    const { drizzle: drizzlePglite } = require("drizzle-orm/pglite") as typeof import("drizzle-orm/pglite");
    const { SCHEMA_DDL } = require("./ddl") as typeof import("./ddl");
    /* eslint-enable @typescript-eslint/no-require-imports */
    const client = new PGlite();
    // exec() is async; PGlite queues queries behind it, so no race. Surface a
    // schema-init failure loudly instead of leaving it an unhandled rejection.
    void client.exec(SCHEMA_DDL).catch((error: unknown) => {
      console.error("pglite schema init failed", error);
    });
    instance = drizzlePglite(client, { schema }) as unknown as Db;
    return instance;
  }
  // Vercel Fluid Compute reuses instances; keep the pool tiny per instance.
  instance = drizzle(postgres(url, { max: 5 }), { schema });
  return instance;
}

export { schema };
