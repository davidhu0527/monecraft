/**
 * The full schema as executable DDL — mirrors db/schema.ts. Applied by the
 * PGlite paths: the bun-test fixture (db/testDb.ts) and the pglite://
 * runtime branch of db() (dev/e2e without a Postgres daemon). Production
 * uses the drizzle-kit migrations generated from the same schema module.
 */
export const SCHEMA_DDL = `
    CREATE TABLE "user" (
      id text PRIMARY KEY,
      name text NOT NULL,
      email text NOT NULL UNIQUE,
      email_verified boolean NOT NULL DEFAULT false,
      image text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
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
    CREATE TABLE profiles (
      id text PRIMARY KEY,
      owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      name text NOT NULL,
      skin_id text,
      created_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX profiles_owner_idx ON profiles (owner_id);
    CREATE TABLE worlds (
      id text PRIMARY KEY,
      owner_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      profile_id text REFERENCES profiles(id) ON DELETE CASCADE,
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
      save_revision integer NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    );
    CREATE INDEX worlds_profile_idx ON worlds (profile_id);
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
    -- The database owns the save_revision increment (migration 0005), so any
    -- writer bumps it correctly and a rename (no save_blob change) never does.
    CREATE FUNCTION bump_save_revision() RETURNS trigger AS $$
    BEGIN
      IF NEW.save_blob IS DISTINCT FROM OLD.save_blob THEN
        NEW.save_revision := OLD.save_revision + 1;
      ELSE
        NEW.save_revision := OLD.save_revision;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER worlds_bump_save_revision
      BEFORE UPDATE ON worlds
      FOR EACH ROW EXECUTE FUNCTION bump_save_revision();
`;
