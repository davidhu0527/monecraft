import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { customType } from "drizzle-orm/pg-core";

/**
 * The online schema: better-auth's core tables (user/session/account/
 * verification, plus our skinId additional field) and the game's own tables
 * (worlds, memberships, invites, profiles).
 *
 * Shared by the Next.js app (Vercel, via node-postgres) and the game server
 * (Fly, via the same drizzle schema); tests run it against PGlite so CI needs
 * no database daemon. Migrations live in db/migrations (drizzle-kit).
 */

// drizzle's built-in bytea arrives in a newer major; this stays portable.
const bytea = customType<{ data: Uint8Array; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  }
});

// ── better-auth core (column names follow better-auth's documented schema) ──

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  /** Game profile: the player's skin palette id (additional field). */
  skinId: text("skin_id")
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" })
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow()
});

// ── game tables ──────────────────────────────────────────────────────────────

/**
 * A player profile owned by an account: the cross-device identity (name +
 * skin) that owns online worlds. Local Players keep their profiles in the
 * browser (lib/game/profiles.ts); these are the server-side ones an account
 * syncs. Capped per account (config MAX_ONLINE_PROFILES).
 */
export const profiles = pgTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Skin palette id (mirrors the local Profile's skinId). */
    skinId: text("skin_id"),
    createdAt: timestamp("created_at").notNull().defaultNow()
  },
  // Listing/quota-counting a profile always filters by owner.
  (table) => [index("profiles_owner_idx").on(table.ownerId)]
);

/**
 * One world. `kind` separates a cloud-synced single-player world (the blob is
 * the client's latest upload) from a multiplayer world (the blob is the game
 * server's authoritative persistence). One save blob either way: gzipped
 * SaveData JSON (v17 carries every player's slice).
 */
export const worlds = pgTable(
  "worlds",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /**
     * Which of the owner's profiles owns this world. Nullable: pre-profile rows
     * (and the account's default profile backfill) leave it null until claimed.
     */
    profileId: text("profile_id").references(() => profiles.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["sp-cloud", "mp"] }).notNull(),
    name: text("name").notNull(),
    seed: integer("seed").notNull(),
    worldType: text("world_type").notNull().default("default"),
    gameMode: text("game_mode").notNull().default("survival"),
    difficulty: text("difficulty").notNull().default("normal"),
    hardcore: boolean("hardcore").notNull().default(false),
    worldgenVersion: integer("worldgen_version").notNull(),
    saveVersion: integer("save_version"),
    saveBlob: bytea("save_blob"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow()
  },
  // Counting a profile's worlds (the cap check) and listing filter by profile.
  (table) => [index("worlds_profile_idx").on(table.profileId)]
);

/** Who may play a world. The owner also has a row (role "owner") so one query lists a user's playable worlds. */
export const worldMembers = pgTable(
  "world_members",
  {
    worldId: text("world_id")
      .notNull()
      .references(() => worlds.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "member"] }).notNull(),
    joinedAt: timestamp("joined_at").notNull().defaultNow()
  },
  (table) => [uniqueIndex("world_members_pk").on(table.worldId, table.userId)]
);

/** Invite links: a random token, optionally expiring / use-limited. */
export const worldInvites = pgTable("world_invites", {
  id: text("id").primaryKey(),
  worldId: text("world_id")
    .notNull()
    .references(() => worlds.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at"),
  maxUses: integer("max_uses"),
  uses: integer("uses").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow()
});
