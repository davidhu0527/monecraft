import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { SCHEMA_DDL } from "./ddl";
import * as schema from "./schema";

/**
 * An in-memory Postgres (PGlite/WASM) with the full schema applied — bun test
 * exercises real SQL against the real drizzle schema with no daemon. Not a
 * .test.ts file: it's a fixture imported by tests (and by the game server's
 * PERSISTENCE=memory mode later).
 *
 * The DDL mirrors db/schema.ts. drizzle-kit generates the production
 * migrations from the same schema module, and the auth integration test
 * exercises every table, so drift between this DDL and schema.ts fails fast.
 */
export async function createTestDb() {
  const client = new PGlite();
  await client.exec(SCHEMA_DDL);
  return drizzle(client, { schema });
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;
