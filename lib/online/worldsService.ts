import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { MAX_ONLINE_PROFILES, MAX_WORLDS_PER_PROFILE, WORLDGEN_VERSION } from "@/lib/game/config";
import { isDifficulty } from "@/lib/game/difficulties";
import { isGameMode } from "@/lib/game/gameModes";
import { isSkinId } from "@/lib/game/playerSkins";
import { MAX_PROFILE_NAME } from "@/lib/game/profiles";
import { isWorldType } from "@/lib/world/worldTypes";
import { PROTOCOL_VERSION } from "@/lib/net/protocol";
import { signTicket } from "@/lib/net/tickets";

/** Postgres `integer` (int4) bounds — a seed outside this overflows the column into a 500. */
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

/**
 * A transaction-scoped advisory lock keyed off an account id, so concurrent
 * count-then-insert quota checks from the same account run one at a time — a
 * race then can't slip a profile/world past its cap. Held until the txn ends.
 */
const lockAccount = (ownerId: string) => sql`select pg_advisory_xact_lock(hashtext(${ownerId})::bigint)`;

/**
 * The online worlds domain: every rule the API routes enforce, as pure
 * functions over a drizzle Db — unit-tested against PGlite, adapted to HTTP by
 * the thin handlers in app/api. Metadata reads are membership-gated; writes
 * that shape the world (rename/delete/invite) are owner-gated. The save BLOB —
 * both its upload and its download — is membership-gated AND `sp-cloud`-only: an
 * `mp` world's blob is the game server's authoritative state, not something a
 * member may upload over or download raw (see `getSaveBlob`/`putSaveBlob`).
 *
 * Results use a discriminated `ok` so handlers map failures to status codes
 * without exceptions crossing the seam.
 */

export type WorldSummary = {
  id: string;
  name: string;
  kind: "sp-cloud" | "mp";
  seed: number;
  worldType: string;
  gameMode: string;
  difficulty: string;
  hardcore: boolean;
  worldgenVersion: number;
  role: "owner" | "member";
  /** The owner's profile this world belongs to (null for legacy/unclaimed rows). */
  profileId: string | null;
  updatedAt: string;
};

type Failure = { ok: false; error: "not-found" | "forbidden" | "conflict" | "invalid" | "expired" };
const fail = (error: Failure["error"]): Failure => ({ ok: false, error });

function toSummary(world: typeof schema.worlds.$inferSelect, role: "owner" | "member"): WorldSummary {
  return {
    id: world.id,
    name: world.name,
    kind: world.kind,
    seed: world.seed,
    worldType: world.worldType,
    gameMode: world.gameMode,
    difficulty: world.difficulty,
    hardcore: world.hardcore,
    worldgenVersion: world.worldgenVersion,
    role,
    profileId: world.profileId ?? null,
    updatedAt: world.updatedAt.toISOString()
  };
}

// ── account profiles ─────────────────────────────────────────────────────────

export type ProfileSummary = { id: string; name: string; skinId: string | null; createdAt: string };

function toProfileSummary(profile: typeof schema.profiles.$inferSelect): ProfileSummary {
  return { id: profile.id, name: profile.name, skinId: profile.skinId ?? null, createdAt: profile.createdAt.toISOString() };
}

/** Every profile an account owns, oldest first (stable menu order). */
export async function listProfiles(db: Db, ownerId: string): Promise<ProfileSummary[]> {
  const rows = await db.select().from(schema.profiles).where(eq(schema.profiles.ownerId, ownerId));
  return rows.map(toProfileSummary).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Creates an account profile. The account is capped at MAX_ONLINE_PROFILES —
 * a 6th request is a `conflict` the UI reports as "limit reached".
 */
export async function createProfile(
  db: Db,
  ownerId: string,
  input: { name: string; skinId?: string | null }
): Promise<{ ok: true; profile: ProfileSummary } | Failure> {
  // The route hands this a bare-cast JSON body, so treat name/skinId as unknown:
  // a non-string name would throw on .trim() (a 500 where a 400 belongs).
  if (typeof input.name !== "string") return fail("invalid");
  const name = input.name.trim();
  if (!name || name.length > MAX_PROFILE_NAME) return fail("invalid");
  if (input.skinId != null && !isSkinId(input.skinId)) return fail("invalid");
  // Count and insert under a per-account lock so two concurrent creates can't
  // both slip past MAX_ONLINE_PROFILES.
  return db.transaction(async (tx) => {
    await tx.execute(lockAccount(ownerId));
    const existing = await tx.select({ id: schema.profiles.id }).from(schema.profiles).where(eq(schema.profiles.ownerId, ownerId));
    if (existing.length >= MAX_ONLINE_PROFILES) return fail("conflict");
    const [profile] = await tx
      .insert(schema.profiles)
      .values({ id: crypto.randomUUID(), ownerId, name, skinId: input.skinId ?? null })
      .returning();
    return { ok: true, profile: toProfileSummary(profile) };
  });
}

/** Rename and/or reskin a profile (owner-scoped). */
export async function updateProfile(
  db: Db,
  ownerId: string,
  profileId: string,
  patch: { name?: string; skinId?: string | null }
): Promise<{ ok: true } | Failure> {
  const set: { name?: string; skinId?: string | null } = {};
  if (patch.name !== undefined) {
    if (typeof patch.name !== "string") return fail("invalid");
    const trimmed = patch.name.trim();
    if (!trimmed || trimmed.length > MAX_PROFILE_NAME) return fail("invalid");
    set.name = trimmed;
  }
  if (patch.skinId !== undefined) {
    // A skin the client doesn't recognize renders as the default anyway, so
    // don't store one; null clears it.
    if (patch.skinId !== null && !isSkinId(patch.skinId)) return fail("invalid");
    set.skinId = patch.skinId;
  }
  if (Object.keys(set).length === 0) return fail("invalid");
  const updated = await db
    .update(schema.profiles)
    .set(set)
    .where(and(eq(schema.profiles.id, profileId), eq(schema.profiles.ownerId, ownerId)))
    .returning({ id: schema.profiles.id });
  if (updated.length === 0) return fail("not-found");
  return { ok: true };
}

/** Deletes a profile and (via FK cascade) all the online worlds it owned. */
export async function deleteProfile(db: Db, ownerId: string, profileId: string): Promise<{ ok: true } | Failure> {
  const deleted = await db
    .delete(schema.profiles)
    .where(and(eq(schema.profiles.id, profileId), eq(schema.profiles.ownerId, ownerId)))
    .returning({ id: schema.profiles.id });
  if (deleted.length === 0) return fail("not-found");
  return { ok: true };
}

/** The caller's membership row for a world, or null. */
async function membership(db: Db, userId: string, worldId: string) {
  const rows = await db
    .select()
    .from(schema.worldMembers)
    .where(and(eq(schema.worldMembers.worldId, worldId), eq(schema.worldMembers.userId, userId)));
  return rows[0] ?? null;
}

/** Every world the user may play, owner first then most recently updated. */
export async function listWorlds(db: Db, userId: string): Promise<WorldSummary[]> {
  const rows = await db
    .select({ world: schema.worlds, role: schema.worldMembers.role })
    .from(schema.worldMembers)
    .innerJoin(schema.worlds, eq(schema.worldMembers.worldId, schema.worlds.id))
    .where(eq(schema.worldMembers.userId, userId));
  return rows
    .map(({ world, role }) => toSummary(world, role))
    .sort((a, b) => (a.role !== b.role ? (a.role === "owner" ? -1 : 1) : b.updatedAt.localeCompare(a.updatedAt)));
}

export type CreateWorldInput = {
  name: string;
  kind: "sp-cloud" | "mp";
  seed: number;
  worldType?: string;
  gameMode?: string;
  difficulty?: string;
  hardcore?: boolean;
  /** The owner's profile that owns this world; enforces the per-profile world cap. */
  profileId?: string;
};

export async function createWorld(db: Db, userId: string, input: CreateWorldInput): Promise<{ ok: true; world: WorldSummary } | Failure> {
  // The route hands this a bare-cast JSON body, so treat every field as unknown:
  // a non-string name would throw on .trim() (a 500 where a 400 belongs).
  if (typeof input.name !== "string") return fail("invalid");
  const name = input.name.trim();
  if (!name || name.length > 64) return fail("invalid");
  if (input.kind !== "sp-cloud" && input.kind !== "mp") return fail("invalid");
  // Seed must land inside int4 or the insert 500s. The client already clamps to
  // this range; an out-of-range value is a hand-rolled request.
  if (!Number.isFinite(input.seed) || input.seed < INT32_MIN || input.seed > INT32_MAX) return fail("invalid");
  // The row's other columns are plain text/boolean with no DB-level enum, and
  // server/room.ts casts them straight into GameEngine — so validate the enums
  // here rather than let a bogus worldType/gameMode/difficulty reach worldgen.
  // Reuse the guards the client already uses (lib/game/worlds.ts).
  if (input.worldType !== undefined && !isWorldType(input.worldType)) return fail("invalid");
  if (input.gameMode !== undefined && !isGameMode(input.gameMode)) return fail("invalid");
  if (input.difficulty !== undefined && !isDifficulty(input.difficulty)) return fail("invalid");
  if (input.hardcore !== undefined && typeof input.hardcore !== "boolean") return fail("invalid");
  // profileId is the last bare-cast field without a type guard: a numeric 0 would
  // read as "absent" (truthiness) and a non-string object would reach the Drizzle
  // predicate. Require a string when present.
  if (input.profileId !== undefined && input.profileId !== null && typeof input.profileId !== "string") return fail("invalid");
  // An `mp` world is always created under a profile (OnlineWorldSelect always
  // sends one), so require it — otherwise omitting profileId slips past
  // MAX_WORLDS_PER_PROFILE, creating unlimited profileId-null rows. `sp-cloud`
  // legitimately omits it: uploads from the local menus are account-level.
  if (input.kind === "mp" && !input.profileId) return fail("invalid");
  // One transaction so the world + owner-membership inserts are atomic; when a
  // profile is named, a per-account lock also serializes the world-cap check.
  return db.transaction(async (tx) => {
    let profileId: string | null = null;
    if (input.profileId) {
      await tx.execute(lockAccount(userId));
      const [profile] = await tx
        .select({ id: schema.profiles.id })
        .from(schema.profiles)
        .where(and(eq(schema.profiles.id, input.profileId), eq(schema.profiles.ownerId, userId)));
      if (!profile) return fail("forbidden"); // not the caller's profile
      const owned = await tx.select({ id: schema.worlds.id }).from(schema.worlds).where(eq(schema.worlds.profileId, input.profileId));
      if (owned.length >= MAX_WORLDS_PER_PROFILE) return fail("conflict");
      profileId = input.profileId;
    }
    const id = crypto.randomUUID();
    const [world] = await tx
      .insert(schema.worlds)
      .values({
        id,
        ownerId: userId,
        profileId,
        kind: input.kind,
        name,
        seed: Math.floor(input.seed),
        worldType: input.worldType ?? "default",
        gameMode: input.gameMode ?? "survival",
        difficulty: input.difficulty ?? "normal",
        hardcore: input.hardcore ?? false,
        worldgenVersion: WORLDGEN_VERSION
      })
      .returning();
    await tx.insert(schema.worldMembers).values({ worldId: id, userId, role: "owner" });
    return { ok: true, world: toSummary(world, "owner") };
  });
}

export async function getWorld(db: Db, userId: string, worldId: string): Promise<{ ok: true; world: WorldSummary } | Failure> {
  const member = await membership(db, userId, worldId);
  if (!member) return fail("not-found"); // membership-gated: outsiders can't probe ids
  const [world] = await db.select().from(schema.worlds).where(eq(schema.worlds.id, worldId));
  if (!world) return fail("not-found");
  return { ok: true, world: toSummary(world, member.role) };
}

export async function renameWorld(db: Db, userId: string, worldId: string, name: string): Promise<{ ok: true } | Failure> {
  if (typeof name !== "string") return fail("invalid"); // bare-cast body — a number would throw on .trim()
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 64) return fail("invalid");
  const member = await membership(db, userId, worldId);
  if (!member) return fail("not-found");
  if (member.role !== "owner") return fail("forbidden");
  // Bumps the metadata mtime only. `saveRevision` — the devices' sync cursor —
  // deliberately does NOT move here: the save didn't change, and while these
  // were one field a rename 409'd every other device's next push.
  await db.update(schema.worlds).set({ name: trimmed, updatedAt: new Date() }).where(eq(schema.worlds.id, worldId));
  return { ok: true };
}

export async function deleteWorld(db: Db, userId: string, worldId: string): Promise<{ ok: true } | Failure> {
  const member = await membership(db, userId, worldId);
  if (!member) return fail("not-found");
  if (member.role !== "owner") return fail("forbidden");
  await db.delete(schema.worlds).where(eq(schema.worlds.id, worldId)); // members/invites cascade
  return { ok: true };
}

/**
 * The gzipped SaveData blob plus its concurrency stamp (the save revision).
 *
 * `sp-cloud` only, like `putSaveBlob`. An `mp` blob is the game server's whole
 * authoritative world — every (incl. offline) player's inventory, coordinates,
 * health, XP and both dimensions — far more than a member ever observes in-game,
 * so membership does not entitle a raw download of it. Nothing legitimate GETs an
 * `mp` blob from the browser (the client only pulls `sp-cloud` cloud saves; the
 * game server reads via its own Postgres adapter, never this route), so the gate
 * is free. Reads of `sp-cloud` stay membership-gated as before.
 */
export async function getSaveBlob(
  db: Db,
  userId: string,
  worldId: string
): Promise<{ ok: true; blob: Uint8Array | null; saveVersion: number | null; saveRevision: number } | Failure> {
  const member = await membership(db, userId, worldId);
  if (!member) return fail("not-found");
  const [world] = await db.select().from(schema.worlds).where(eq(schema.worlds.id, worldId));
  if (!world) return fail("not-found");
  if (world.kind !== "sp-cloud") return fail("invalid");
  return { ok: true, blob: world.saveBlob ?? null, saveVersion: world.saveVersion, saveRevision: world.saveRevision };
}

/**
 * Uploads a single-player cloud save. Last-write-wins with a stale guard: the
 * client sends the `saveRevision` it last saw; a mismatch means someone else
 * (another device) wrote in between — 409, and the client picks the newer save.
 * `baseRevision: null` means "first upload", accepted only while the world has
 * never been saved (revision 0).
 *
 * The cursor is `saveRevision`, NOT `updatedAt`: the latter is metadata mtime,
 * so a rename moved every other device's cursor and 409'd their next push over
 * a save that had not changed — silently latching cloud sync off for the
 * session. A revision only moves when the blob does.
 *
 * `sp-cloud` only. The two kinds share one `saveBlob` column but not its
 * ownership: for `sp-cloud` the blob IS the client's upload, while for `mp` it
 * is the game server's authoritative persistence (server/persistence.ts), which
 * a room reloads as world state on its next boot. Accepting a client upload
 * there would let any invited member hand the server a world of their choosing —
 * exactly the authority docs/protocol.md reserves for the server ("clients
 * cannot invent items or edits"). Nothing legitimate PUTs an `mp` world:
 * useMinecraftGame's push returns early when online, and mp worlds carry no
 * `cloudId`. Mirrors the kind check `mintTicket` makes in the other direction.
 */
export async function putSaveBlob(
  db: Db,
  userId: string,
  worldId: string,
  blob: Uint8Array,
  saveVersion: number,
  baseRevision: number | null
): Promise<{ ok: true; saveRevision: number } | Failure> {
  const member = await membership(db, userId, worldId);
  if (!member) return fail("not-found");
  if (!Number.isInteger(saveVersion) || blob.byteLength === 0) return fail("invalid");
  if (baseRevision !== null && (!Number.isInteger(baseRevision) || baseRevision < 0)) return fail("invalid");
  const [world] = await db.select().from(schema.worlds).where(eq(schema.worlds.id, worldId));
  if (!world) return fail("not-found");
  if (world.kind !== "sp-cloud") return fail("invalid");
  // Fold the stale check into the UPDATE predicate so two writers with the same
  // base revision can't both win: a first upload requires a never-saved world
  // (revision 0); a later one requires the exact revision it last saw. The
  // increment itself is the DB trigger's job (migration 0005) — it fires on the
  // row this UPDATE locked, so the winner's new revision is decided there, not
  // from a value read earlier. Zero rows affected = stale.
  const guard = and(eq(schema.worlds.id, worldId), eq(schema.worlds.saveRevision, baseRevision ?? 0));
  const updated = await db
    .update(schema.worlds)
    .set({ saveBlob: blob, saveVersion, updatedAt: new Date() })
    .where(guard)
    .returning({ saveRevision: schema.worlds.saveRevision });
  // The world exists (selected above), so no rows means a stale base.
  if (updated.length === 0) return fail("conflict");
  return { ok: true, saveRevision: updated[0].saveRevision };
}

export async function createInvite(db: Db, userId: string, worldId: string): Promise<{ ok: true; token: string } | Failure> {
  const member = await membership(db, userId, worldId);
  if (!member) return fail("not-found");
  if (member.role !== "owner") return fail("forbidden");
  const token = base64urlToken();
  await db.insert(schema.worldInvites).values({ id: crypto.randomUUID(), worldId, token, createdBy: userId });
  return { ok: true, token };
}

/**
 * Owner revokes every outstanding invite for a world — a shared link that
 * escaped is instantly dead (existing members keep their access). Returns how
 * many links were killed so the UI can confirm.
 */
export async function revokeInvites(db: Db, userId: string, worldId: string): Promise<{ ok: true; revoked: number } | Failure> {
  const member = await membership(db, userId, worldId);
  if (!member) return fail("not-found");
  if (member.role !== "owner") return fail("forbidden");
  const killed = await db.delete(schema.worldInvites).where(eq(schema.worldInvites.worldId, worldId)).returning({ id: schema.worldInvites.id });
  return { ok: true, revoked: killed.length };
}

/** 128 bits of URL-safe randomness. */
function base64urlToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function resolveInvite(db: Db, token: string): Promise<{ ok: true; worldId: string; worldName: string } | Failure> {
  const [invite] = await db.select().from(schema.worldInvites).where(eq(schema.worldInvites.token, token));
  if (!invite) return fail("not-found");
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) return fail("expired");
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) return fail("expired");
  const [world] = await db.select().from(schema.worlds).where(eq(schema.worlds.id, invite.worldId));
  if (!world) return fail("not-found");
  return { ok: true, worldId: world.id, worldName: world.name };
}

/** Rolls back an accept when the invite's cap fills between resolve and consume. */
const CAP_FILLED = Symbol("invite-cap-filled");

/** Accepting twice is fine (idempotent); each NEW membership consumes exactly one use. */
export async function acceptInvite(db: Db, userId: string, token: string): Promise<{ ok: true; worldId: string } | Failure> {
  const resolved = await resolveInvite(db, token);
  if (!resolved.ok) return resolved;
  // One transaction so a use is consumed IFF a membership is granted. Two things
  // this ordering fixes over consume-then-insert: (1) a failed insert can no
  // longer burn a use with nothing to show for it — they commit or roll back
  // together; (2) the membership insert goes FIRST, so two concurrent accepts by
  // the SAME user dedupe on the unique index — the second blocks, then sees the
  // conflict and consumes nothing (previously both passed a read-side `existing`
  // check and each burned a use for one membership).
  try {
    return await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.worldMembers)
        .values({ worldId: resolved.worldId, userId, role: "member" })
        .onConflictDoNothing()
        .returning({ userId: schema.worldMembers.userId });
      if (inserted.length === 0) return { ok: true, worldId: resolved.worldId } as const; // already a member — no use consumed
      // A genuinely new membership: consume one use, enforcing cap AND expiry in
      // the predicate (both can change between resolveInvite and here). Zero rows
      // = the invite ran out under us, so undo the membership by aborting.
      const consumed = await tx
        .update(schema.worldInvites)
        .set({ uses: sql`${schema.worldInvites.uses} + 1` })
        .where(
          and(
            eq(schema.worldInvites.token, token),
            or(isNull(schema.worldInvites.maxUses), lt(schema.worldInvites.uses, schema.worldInvites.maxUses)),
            or(isNull(schema.worldInvites.expiresAt), gt(schema.worldInvites.expiresAt, new Date()))
          )
        )
        .returning({ id: schema.worldInvites.id });
      if (consumed.length === 0) throw CAP_FILLED;
      return { ok: true, worldId: resolved.worldId } as const;
    });
  } catch (err) {
    if (err === CAP_FILLED) return fail("expired");
    throw err;
  }
}

/**
 * Mints the 60s join ticket the game server trusts. Membership required; mp
 * worlds only. When a `profileId` is given (and belongs to the caller) the
 * ticket carries that profile's name + skin, so others see the profile identity
 * — not the account. `sub` stays the account id (roster/kick key at the account
 * level; per-profile save-slice keying is a separate decision).
 */
export async function mintTicket(
  db: Db,
  user: { id: string; name: string; skinId?: string | null },
  worldId: string,
  secret: string,
  profileId?: string | null
): Promise<{ ok: true; ticket: string } | Failure> {
  const member = await membership(db, user.id, worldId);
  if (!member) return fail("not-found");
  const [world] = await db.select().from(schema.worlds).where(eq(schema.worlds.id, worldId));
  if (!world) return fail("not-found");
  if (world.kind !== "mp") return fail("invalid");
  let name = user.name;
  let skinId = user.skinId ?? null;
  if (profileId) {
    const [profile] = await db
      .select()
      .from(schema.profiles)
      .where(and(eq(schema.profiles.id, profileId), eq(schema.profiles.ownerId, user.id)));
    if (!profile) return fail("forbidden");
    name = profile.name;
    skinId = profile.skinId ?? null;
  }
  const ticket = await signTicket({ sub: user.id, wid: worldId, name, skinId, role: member.role, gm: world.gameMode, pv: PROTOCOL_VERSION }, secret);
  return { ok: true, ticket };
}
