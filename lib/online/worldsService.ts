import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { WORLDGEN_VERSION } from "@/lib/game/config";
import { PROTOCOL_VERSION } from "@/lib/net/protocol";
import { signTicket } from "@/lib/net/tickets";

/**
 * The online worlds domain: every rule the API routes enforce, as pure
 * functions over a drizzle Db — unit-tested against PGlite, adapted to HTTP by
 * the thin handlers in app/api. All read access is membership-gated; writes
 * that shape the world (rename/delete/invite) are owner-gated.
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
    updatedAt: world.updatedAt.toISOString()
  };
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
};

export async function createWorld(db: Db, userId: string, input: CreateWorldInput): Promise<{ ok: true; world: WorldSummary } | Failure> {
  const name = input.name?.trim();
  if (!name || name.length > 64) return fail("invalid");
  if (input.kind !== "sp-cloud" && input.kind !== "mp") return fail("invalid");
  if (!Number.isFinite(input.seed)) return fail("invalid");
  const id = crypto.randomUUID();
  const [world] = await db
    .insert(schema.worlds)
    .values({
      id,
      ownerId: userId,
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
  await db.insert(schema.worldMembers).values({ worldId: id, userId, role: "owner" });
  return { ok: true, world: toSummary(world, "owner") };
}

export async function getWorld(db: Db, userId: string, worldId: string): Promise<{ ok: true; world: WorldSummary } | Failure> {
  const member = await membership(db, userId, worldId);
  if (!member) return fail("not-found"); // membership-gated: outsiders can't probe ids
  const [world] = await db.select().from(schema.worlds).where(eq(schema.worlds.id, worldId));
  if (!world) return fail("not-found");
  return { ok: true, world: toSummary(world, member.role) };
}

export async function renameWorld(db: Db, userId: string, worldId: string, name: string): Promise<{ ok: true } | Failure> {
  const trimmed = name?.trim();
  if (!trimmed || trimmed.length > 64) return fail("invalid");
  const member = await membership(db, userId, worldId);
  if (!member) return fail("not-found");
  if (member.role !== "owner") return fail("forbidden");
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

/** The gzipped SaveData blob plus its concurrency stamp. */
export async function getSaveBlob(
  db: Db,
  userId: string,
  worldId: string
): Promise<{ ok: true; blob: Uint8Array | null; saveVersion: number | null; updatedAt: string } | Failure> {
  const member = await membership(db, userId, worldId);
  if (!member) return fail("not-found");
  const [world] = await db.select().from(schema.worlds).where(eq(schema.worlds.id, worldId));
  if (!world) return fail("not-found");
  return { ok: true, blob: world.saveBlob ?? null, saveVersion: world.saveVersion, updatedAt: world.updatedAt.toISOString() };
}

/**
 * Last-write-wins with a stale guard: the client sends the `updatedAt` it
 * last saw; a mismatch means someone else (another device) wrote in between —
 * 409, and the client picks the newer save. `baseUpdatedAt: null` means
 * "first upload", accepted only while the world has no blob yet.
 */
export async function putSaveBlob(
  db: Db,
  userId: string,
  worldId: string,
  blob: Uint8Array,
  saveVersion: number,
  baseUpdatedAt: string | null
): Promise<{ ok: true; updatedAt: string } | Failure> {
  const member = await membership(db, userId, worldId);
  if (!member) return fail("not-found");
  if (!Number.isInteger(saveVersion) || blob.byteLength === 0) return fail("invalid");
  const now = new Date();
  // Fold the stale check into the UPDATE predicate so two writers with the same
  // base stamp can't both win: first upload requires no blob yet; a later one
  // requires the exact `updatedAt` it last saw. Zero rows affected = stale.
  const guard =
    baseUpdatedAt === null
      ? and(eq(schema.worlds.id, worldId), isNull(schema.worlds.saveBlob))
      : and(eq(schema.worlds.id, worldId), eq(schema.worlds.updatedAt, new Date(baseUpdatedAt)));
  const updated = await db.update(schema.worlds).set({ saveBlob: blob, saveVersion, updatedAt: now }).where(guard).returning({ id: schema.worlds.id });
  // Membership implies the world exists (FK cascade), so no rows means a stale base.
  if (updated.length === 0) return fail("conflict");
  return { ok: true, updatedAt: now.toISOString() };
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

/** Accepting twice is fine (idempotent); each NEW membership consumes one use. */
export async function acceptInvite(db: Db, userId: string, token: string): Promise<{ ok: true; worldId: string } | Failure> {
  const resolved = await resolveInvite(db, token);
  if (!resolved.ok) return resolved;
  const existing = await membership(db, userId, resolved.worldId);
  if (existing) return { ok: true, worldId: resolved.worldId };
  // Consume one use atomically, enforcing the cap in the predicate: concurrent
  // accepts can't both slip past a maxUses that only one increment should clear.
  const consumed = await db
    .update(schema.worldInvites)
    .set({ uses: sql`${schema.worldInvites.uses} + 1` })
    .where(and(eq(schema.worldInvites.token, token), or(isNull(schema.worldInvites.maxUses), lt(schema.worldInvites.uses, schema.worldInvites.maxUses))))
    .returning({ id: schema.worldInvites.id });
  if (consumed.length === 0) return fail("expired"); // the cap filled under concurrency
  await db.insert(schema.worldMembers).values({ worldId: resolved.worldId, userId, role: "member" }).onConflictDoNothing();
  return { ok: true, worldId: resolved.worldId };
}

/** Mints the 60s join ticket the game server trusts. Membership required; mp worlds only. */
export async function mintTicket(
  db: Db,
  user: { id: string; name: string; skinId?: string | null },
  worldId: string,
  secret: string
): Promise<{ ok: true; ticket: string } | Failure> {
  const member = await membership(db, user.id, worldId);
  if (!member) return fail("not-found");
  const [world] = await db.select().from(schema.worlds).where(eq(schema.worlds.id, worldId));
  if (!world) return fail("not-found");
  if (world.kind !== "mp") return fail("invalid");
  const ticket = await signTicket(
    { sub: user.id, wid: worldId, name: user.name, skinId: user.skinId ?? null, role: member.role, pv: PROTOCOL_VERSION },
    secret
  );
  return { ok: true, ticket };
}
