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
 * local dev use it; data lives exactly as long as the server process.
 */

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let instance: Db | null = null;

export function db(): Db {
  if (instance) return instance;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — see .env.example");
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
