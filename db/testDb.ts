import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
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
  await client.exec(`
    CREATE TABLE "user" (
      id text PRIMARY KEY,
      name text NOT NULL,
      email text NOT NULL UNIQUE,
      email_verified boolean NOT NULL DEFAULT false,
      image text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      is_anonymous boolean,
      skin_id text
    );
    CREATE TABLE "session" (
      id text PRIMARY KEY,
      expires_at timestamp NOT NULL,
      token text NOT NULL UNIQUE,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      ip_address text,
      user_agent text,
      user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
    );
    CREATE TABLE "account" (
      id text PRIMARY KEY,
      account_id text NOT NULL,
      provider_id text NOT NULL,
      user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      access_token text,
      refresh_token text,
      id_token text,
      access_token_expires_at timestamp,
      refresh_token_expires_at timestamp,
      scope text,
      password text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE "verification" (
      id text PRIMARY KEY,
      identifier text NOT NULL,
      value text NOT NULL,
      expires_at timestamp NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE worlds (
      id text PRIMARY KEY,
      owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      kind text NOT NULL,
      name text NOT NULL,
      seed integer NOT NULL,
      world_type text NOT NULL DEFAULT 'default',
      game_mode text NOT NULL DEFAULT 'survival',
      difficulty text NOT NULL DEFAULT 'normal',
      hardcore boolean NOT NULL DEFAULT false,
      worldgen_version integer NOT NULL,
      save_version integer,
      save_blob bytea,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE TABLE world_members (
      world_id text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      role text NOT NULL,
      joined_at timestamp NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX world_members_pk ON world_members (world_id, user_id);
    CREATE TABLE world_invites (
      id text PRIMARY KEY,
      world_id text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      token text NOT NULL UNIQUE,
      created_by text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      expires_at timestamp,
      max_uses integer,
      uses integer NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT now()
    );
  `);
  return drizzle(client, { schema });
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;
