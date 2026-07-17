import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeTestDb, createTestDb, type TestDb } from "@/db/testDb";
import { schema } from "@/db";
import { MAX_ONLINE_PROFILES, MAX_WORLDS_PER_PROFILE } from "@/lib/game/config";
import { verifyTicket } from "@/lib/net/tickets";
import {
  acceptInvite,
  createInvite,
  createProfile,
  createWorld,
  deleteProfile,
  deleteWorld,
  getSaveBlob,
  getWorld,
  listProfiles,
  listWorlds,
  mintTicket,
  putSaveBlob,
  renameWorld,
  resolveInvite,
  revokeInvites,
  updateProfile
} from "./worldsService";

let db: TestDb;
const asDb = () => db as never;

async function addUser(id: string): Promise<void> {
  await db.insert(schema.user).values({ id, name: id, email: `${id}@example.com` });
}

beforeEach(async () => {
  db = await createTestDb();
  await addUser("alice");
  await addUser("bob");
  await addUser("mallory");
});

// An unclosed PGlite leaks a pending WASM op that Bun flags as exit code 99.
afterEach(async () => {
  await closeTestDb(db);
});

async function makeWorld(owner = "alice", kind: "sp-cloud" | "mp" = "mp"): Promise<string> {
  // mp worlds require a profile (that's how the cap is enforced); sp-cloud
  // worlds are account-level (the local-menu upload path sends no profileId).
  let profileId: string | undefined;
  if (kind === "mp") {
    const profile = await createProfile(asDb(), owner, { name: "P", skinId: null });
    if (!profile.ok) throw new Error(profile.error);
    profileId = profile.profile.id;
  }
  const result = await createWorld(asDb(), owner, { name: "Test World", kind, seed: 1337, profileId });
  if (!result.ok) throw new Error(result.error);
  return result.world.id;
}

describe("worlds CRUD", () => {
  test("create gives the owner a membership and shows up in their list", async () => {
    const id = await makeWorld();
    const list = await listWorlds(asDb(), "alice");
    expect(list.map((w) => w.id)).toEqual([id]);
    expect(list[0].role).toBe("owner");
    expect(list[0].worldgenVersion).toBeGreaterThanOrEqual(11);
  });

  test("outsiders can't see, rename, or delete a world (membership-gated as not-found)", async () => {
    const id = await makeWorld();
    expect((await getWorld(asDb(), "mallory", id)).ok).toBe(false);
    expect(await renameWorld(asDb(), "mallory", id, "Stolen")).toMatchObject({ ok: false, error: "not-found" });
    expect(await deleteWorld(asDb(), "mallory", id)).toMatchObject({ ok: false, error: "not-found" });
  });

  test("members can read but only the owner mutates", async () => {
    const id = await makeWorld();
    const invite = await createInvite(asDb(), "alice", id);
    if (!invite.ok) throw new Error("invite failed");
    await acceptInvite(asDb(), "bob", invite.token);

    expect((await getWorld(asDb(), "bob", id)).ok).toBe(true);
    expect(await renameWorld(asDb(), "bob", id, "Bob's Now")).toMatchObject({ ok: false, error: "forbidden" });
    expect(await createInvite(asDb(), "bob", id)).toMatchObject({ ok: false, error: "forbidden" });
    expect(await renameWorld(asDb(), "alice", id, "Renamed")).toMatchObject({ ok: true });
  });

  test("rejects garbage world creation", async () => {
    const p = await createProfile(asDb(), "alice", { name: "P", skinId: null });
    const pid = p.ok ? p.profile.id : "";
    expect(await createWorld(asDb(), "alice", { name: "  ", kind: "mp", seed: 1, profileId: pid })).toMatchObject({ ok: false, error: "invalid" });
    expect(await createWorld(asDb(), "alice", { name: "x".repeat(65), kind: "mp", seed: 1, profileId: pid })).toMatchObject({ ok: false, error: "invalid" });
    expect(await createWorld(asDb(), "alice", { name: "ok", kind: "nope" as never, seed: 1, profileId: pid })).toMatchObject({ ok: false, error: "invalid" });
    expect(await createWorld(asDb(), "alice", { name: "ok", kind: "mp", seed: Number.NaN, profileId: pid })).toMatchObject({ ok: false, error: "invalid" });
  });

  test("validates the enums and the seed range, and requires a profile for mp", async () => {
    const p = await createProfile(asDb(), "alice", { name: "P", skinId: null });
    const pid = p.ok ? p.profile.id : "";
    const base = { name: "W", kind: "mp" as const, seed: 1, profileId: pid };

    // A seed past int4 would overflow the column into a 500 rather than a clean 400.
    expect(await createWorld(asDb(), "alice", { ...base, seed: 1e20 })).toMatchObject({ ok: false, error: "invalid" });
    expect(await createWorld(asDb(), "alice", { ...base, seed: -3_000_000_000 })).toMatchObject({ ok: false, error: "invalid" });
    // Bogus enums would otherwise be cast straight into GameEngine at room boot.
    expect(await createWorld(asDb(), "alice", { ...base, worldType: "__proto__" })).toMatchObject({ ok: false, error: "invalid" });
    expect(await createWorld(asDb(), "alice", { ...base, gameMode: "god" })).toMatchObject({ ok: false, error: "invalid" });
    expect(await createWorld(asDb(), "alice", { ...base, difficulty: "lol" })).toMatchObject({ ok: false, error: "invalid" });
    expect(await createWorld(asDb(), "alice", { ...base, hardcore: "yes" as never })).toMatchObject({ ok: false, error: "invalid" });
    // The cap bypass: an mp world with no profile isn't counted against any cap.
    expect(await createWorld(asDb(), "alice", { name: "W", kind: "mp", seed: 1 })).toMatchObject({ ok: false, error: "invalid" });
    // A non-string name would throw on .trim() — a 500 where a 400 belongs.
    expect(await createWorld(asDb(), "alice", { name: 123 as never, kind: "mp", seed: 1, profileId: pid })).toMatchObject({ ok: false, error: "invalid" });

    // Valid values (including the int4 extremes) go through.
    expect((await createWorld(asDb(), "alice", { ...base, worldType: "amplified", gameMode: "creative", difficulty: "hard", hardcore: true })).ok).toBe(true);
    expect((await createWorld(asDb(), "alice", { ...base, seed: 2147483647 })).ok).toBe(true);
  });

  test("sp-cloud worlds are account-level — no profile required (the upload path)", async () => {
    expect((await createWorld(asDb(), "alice", { name: "Uploaded", kind: "sp-cloud", seed: 1 })).ok).toBe(true);
  });
});

describe("invites", () => {
  test("accept is idempotent and consumes uses only for new members", async () => {
    const id = await makeWorld();
    const invite = await createInvite(asDb(), "alice", id);
    if (!invite.ok) throw new Error("invite failed");

    expect(await acceptInvite(asDb(), "bob", invite.token)).toMatchObject({ ok: true, worldId: id });
    expect(await acceptInvite(asDb(), "bob", invite.token)).toMatchObject({ ok: true, worldId: id });

    const [row] = await db.select().from(schema.worldInvites);
    expect(row.uses).toBe(1); // the second accept was a no-op

    const list = await listWorlds(asDb(), "bob");
    expect(list.map((w) => w.id)).toEqual([id]);
    expect(list[0].role).toBe("member");
  });

  // Two accepts from the SAME user racing: both used to pass the read-side
  // "already a member?" check and each burned a use, leaving 2 uses for the 1
  // membership onConflictDoNothing created. The membership insert now goes first,
  // so the loser dedupes on the unique index and consumes nothing.
  test("concurrent same-user accepts consume exactly one use", async () => {
    const id = await makeWorld();
    const invite = await createInvite(asDb(), "alice", id);
    if (!invite.ok) throw new Error("invite failed");

    const [a, b] = await Promise.all([acceptInvite(asDb(), "bob", invite.token), acceptInvite(asDb(), "bob", invite.token)]);
    expect(a.ok && b.ok).toBe(true);

    const [row] = await db.select().from(schema.worldInvites);
    expect(row.uses).toBe(1); // one membership → one use, not two
    expect((await listWorlds(asDb(), "bob")).map((w) => w.id)).toEqual([id]);
  });

  // A use must be consumed IFF a membership is granted. When the cap fills, the
  // transaction rolls back the membership too — no half-done accept.
  test("an accept that can't consume a use grants no membership", async () => {
    const id = await makeWorld();
    // A single-use invite already spent: the next accept can't consume.
    await db.insert(schema.worldInvites).values({ id: "inv-spent", worldId: id, token: "tok-spent", createdBy: "alice", maxUses: 1, uses: 1 });

    expect(await acceptInvite(asDb(), "bob", "tok-spent")).toMatchObject({ ok: false, error: "expired" });
    // The rolled-back membership insert must leave bob with no access.
    expect(await listWorlds(asDb(), "bob")).toEqual([]);
  });

  test("expired and exhausted invites refuse", async () => {
    const id = await makeWorld();
    await db.insert(schema.worldInvites).values({ id: "inv-old", worldId: id, token: "tok-old", createdBy: "alice", expiresAt: new Date(Date.now() - 1000) });
    expect(await resolveInvite(asDb(), "tok-old")).toMatchObject({ ok: false, error: "expired" });

    await db.insert(schema.worldInvites).values({ id: "inv-max", worldId: id, token: "tok-max", createdBy: "alice", maxUses: 1, uses: 1 });
    expect(await acceptInvite(asDb(), "bob", "tok-max")).toMatchObject({ ok: false, error: "expired" });

    expect(await resolveInvite(asDb(), "tok-nope")).toMatchObject({ ok: false, error: "not-found" });
  });

  test("the owner revokes every outstanding link; members keep access, outsiders/members can't revoke", async () => {
    const id = await makeWorld();
    const first = await createInvite(asDb(), "alice", id);
    if (!first.ok) throw new Error("invite failed");
    await acceptInvite(asDb(), "bob", first.token); // bob is a member now
    await createInvite(asDb(), "alice", id); // a second, still-outstanding link

    expect(await revokeInvites(asDb(), "bob", id)).toMatchObject({ ok: false, error: "forbidden" });
    expect(await revokeInvites(asDb(), "mallory", id)).toMatchObject({ ok: false, error: "not-found" });

    expect(await revokeInvites(asDb(), "alice", id)).toMatchObject({ ok: true, revoked: 2 });
    expect(await resolveInvite(asDb(), first.token)).toMatchObject({ ok: false, error: "not-found" }); // dead link
    expect((await getWorld(asDb(), "bob", id)).ok).toBe(true); // bob still a member
  });
});

describe("save blobs (LWW)", () => {
  const blob = (text: string) => new TextEncoder().encode(text);

  test("first upload needs a null base; later uploads need the exact revision", async () => {
    const id = await makeWorld("alice", "sp-cloud");

    const first = await putSaveBlob(asDb(), "alice", id, blob("v1"), 17, null);
    expect(first).toMatchObject({ ok: true, saveRevision: 1 }); // a never-saved world starts at 0
    const rev1 = first.ok ? first.saveRevision : -1;

    // A second device that never saw the blob must not clobber it.
    expect(await putSaveBlob(asDb(), "alice", id, blob("clobber"), 17, null)).toMatchObject({ ok: false, error: "conflict" });
    // A stale revision must not clobber either.
    expect(await putSaveBlob(asDb(), "alice", id, blob("stale"), 17, 0)).toMatchObject({ ok: false, error: "conflict" });
    // Nor may a revision from the future.
    expect(await putSaveBlob(asDb(), "alice", id, blob("ahead"), 17, 99)).toMatchObject({ ok: false, error: "conflict" });
    // The holder of the current revision may write, and the revision advances.
    expect(await putSaveBlob(asDb(), "alice", id, blob("v2"), 17, rev1)).toMatchObject({ ok: true, saveRevision: 2 });

    const fetched = await getSaveBlob(asDb(), "alice", id);
    expect(fetched.ok).toBe(true);
    if (fetched.ok) {
      expect(new TextDecoder().decode(fetched.blob!)).toBe("v2");
      expect(fetched.saveVersion).toBe(17);
      expect(fetched.saveRevision).toBe(2);
    }
  });

  test("a garbage base revision is rejected, not read as a first upload", async () => {
    const id = await makeWorld("alice", "sp-cloud");
    expect((await putSaveBlob(asDb(), "alice", id, blob("v1"), 17, null)).ok).toBe(true);
    // NaN is what an unparseable x-base-revision header becomes. Treating it as
    // "first upload" would hand a stale client a clobber.
    expect(await putSaveBlob(asDb(), "alice", id, blob("x"), 17, Number.NaN)).toMatchObject({ ok: false, error: "invalid" });
    expect(await putSaveBlob(asDb(), "alice", id, blob("x"), 17, -1)).toMatchObject({ ok: false, error: "invalid" });
  });

  // The bug this column exists for: updatedAt was both metadata mtime AND the
  // sync cursor, so renaming a world moved every other device's cursor and
  // 409'd its next push over a save that never changed.
  test("renaming a world doesn't disturb the save cursor", async () => {
    const id = await makeWorld("alice", "sp-cloud");
    const first = await putSaveBlob(asDb(), "alice", id, blob("v1"), 18, null);
    const rev = first.ok ? first.saveRevision : -1;

    expect((await renameWorld(asDb(), "alice", id, "Renamed")).ok).toBe(true);

    // Same cursor the device held before the rename: still valid.
    expect(await putSaveBlob(asDb(), "alice", id, blob("v2"), 18, rev)).toMatchObject({ ok: true, saveRevision: 2 });
    // And the rename did land — the metadata mtime is what moved, not the cursor.
    const world = await getWorld(asDb(), "alice", id);
    expect(world.ok && world.world.name).toBe("Renamed");
  });

  test("a read doesn't move the cursor either", async () => {
    const id = await makeWorld("alice", "sp-cloud");
    const first = await putSaveBlob(asDb(), "alice", id, blob("v1"), 18, null);
    const rev = first.ok ? first.saveRevision : -1;
    await getSaveBlob(asDb(), "alice", id);
    expect(await putSaveBlob(asDb(), "alice", id, blob("v2"), 18, rev)).toMatchObject({ ok: true });
  });

  test("non-members can't read or write blobs", async () => {
    const id = await makeWorld("alice", "sp-cloud");
    expect((await getSaveBlob(asDb(), "mallory", id)).ok).toBe(false);
    expect((await putSaveBlob(asDb(), "mallory", id, blob("x"), 17, null)).ok).toBe(false);
  });

  // An `mp` world's blob is the game server's authoritative state, not a client
  // upload. Membership alone must not buy the right to replace it — otherwise an
  // invited player hands the room whatever world they like on its next boot.
  test("an mp world's blob rejects uploads — even from its owner", async () => {
    const id = await makeWorld("alice", "mp");
    expect(await putSaveBlob(asDb(), "alice", id, blob("x"), 18, null)).toMatchObject({ ok: false, error: "invalid" });
  });

  test("an invited member can't overwrite an mp world's authoritative save", async () => {
    const id = await makeWorld("alice", "mp");
    const invite = await createInvite(asDb(), "alice", id);
    if (!invite.ok) throw new Error("invite failed");
    expect((await acceptInvite(asDb(), "bob", invite.token)).ok).toBe(true);

    // Bob is a real member: he can read the world and its blob...
    expect((await getWorld(asDb(), "bob", id)).ok).toBe(true);
    expect((await getSaveBlob(asDb(), "bob", id)).ok).toBe(true);
    // ...but the blob is the server's to write, not his.
    expect(await putSaveBlob(asDb(), "bob", id, blob("pwned"), 18, null)).toMatchObject({ ok: false, error: "invalid" });
  });

  test("sp-cloud uploads still work — the gate is on kind, not on saving", async () => {
    const id = await makeWorld("alice", "sp-cloud");
    expect((await putSaveBlob(asDb(), "alice", id, blob("v1"), 18, null)).ok).toBe(true);
  });
});

describe("account profiles", () => {
  test("create, list (oldest first), and rename/reskin — all owner-scoped", async () => {
    const a = await createProfile(asDb(), "alice", { name: "Steve", skinId: "default" });
    const b = await createProfile(asDb(), "alice", { name: "Alex", skinId: "alex" });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok) throw new Error("create failed");

    expect((await listProfiles(asDb(), "alice")).map((p) => p.name)).toEqual(["Steve", "Alex"]);

    expect(await updateProfile(asDb(), "alice", a.profile.id, { name: "Renamed", skinId: "robot" })).toMatchObject({ ok: true });
    // Not your profile → not-found (owner-scoped, so ids can't be probed).
    expect(await updateProfile(asDb(), "bob", a.profile.id, { name: "Hijack" })).toMatchObject({ ok: false, error: "not-found" });
    expect((await listProfiles(asDb(), "alice")).find((p) => p.id === a.profile.id)).toMatchObject({ name: "Renamed", skinId: "robot" });
  });

  test("an account is capped at MAX_ONLINE_PROFILES; blank/over-long names are rejected", async () => {
    for (let i = 0; i < MAX_ONLINE_PROFILES; i += 1) {
      expect((await createProfile(asDb(), "alice", { name: `P${i}` })).ok).toBe(true);
    }
    expect(await createProfile(asDb(), "alice", { name: "one too many" })).toMatchObject({ ok: false, error: "conflict" });
    expect(await createProfile(asDb(), "bob", { name: "   " })).toMatchObject({ ok: false, error: "invalid" });
    expect(await createProfile(asDb(), "bob", { name: "x".repeat(25) })).toMatchObject({ ok: false, error: "invalid" });
  });

  test("deleting a profile cascades its online worlds; delete is owner-scoped", async () => {
    const p = await createProfile(asDb(), "alice", { name: "Steve" });
    if (!p.ok) throw new Error("create failed");
    const world = await createWorld(asDb(), "alice", { name: "W", kind: "mp", seed: 1, profileId: p.profile.id });
    if (!world.ok) throw new Error("world failed");
    expect(world.world.profileId).toBe(p.profile.id);

    expect(await deleteProfile(asDb(), "bob", p.profile.id)).toMatchObject({ ok: false, error: "not-found" });
    expect(await deleteProfile(asDb(), "alice", p.profile.id)).toMatchObject({ ok: true });
    expect(await listWorlds(asDb(), "alice")).toEqual([]); // world + its membership cascaded away
  });

  test("createWorld enforces profile ownership and the per-profile world cap", async () => {
    const p = await createProfile(asDb(), "alice", { name: "Steve" });
    if (!p.ok) throw new Error("create failed");
    // A profile that isn't yours can't own your world.
    expect(await createWorld(asDb(), "bob", { name: "W", kind: "mp", seed: 1, profileId: p.profile.id })).toMatchObject({ ok: false, error: "forbidden" });

    for (let i = 0; i < MAX_WORLDS_PER_PROFILE; i += 1) {
      expect((await createWorld(asDb(), "alice", { name: `W${i}`, kind: "mp", seed: i, profileId: p.profile.id })).ok).toBe(true);
    }
    expect(await createWorld(asDb(), "alice", { name: "over", kind: "mp", seed: 99, profileId: p.profile.id })).toMatchObject({ ok: false, error: "conflict" });
  });

  test("singleplayer (sp-cloud) worlds attach to a profile and share its cap with mp", async () => {
    const p = await createProfile(asDb(), "alice", { name: "Steve" });
    if (!p.ok) throw new Error("create failed");
    // A profile-owned singleplayer world is a first-class row…
    const sp = await createWorld(asDb(), "alice", { name: "Solo", kind: "sp-cloud", seed: 1, profileId: p.profile.id });
    expect(sp.ok).toBe(true);
    if (sp.ok) expect(sp.world).toMatchObject({ kind: "sp-cloud", profileId: p.profile.id });

    // …and the quota is kind-blind: mixed kinds fill the same cap, and the
    // cap refuses BOTH kinds once full.
    for (let i = 1; i < MAX_WORLDS_PER_PROFILE; i += 1) {
      const kind: "sp-cloud" | "mp" = i % 2 === 0 ? "sp-cloud" : "mp";
      expect((await createWorld(asDb(), "alice", { name: `W${i}`, kind, seed: i, profileId: p.profile.id })).ok).toBe(true);
    }
    expect(await createWorld(asDb(), "alice", { name: "over-sp", kind: "sp-cloud", seed: 99, profileId: p.profile.id })).toMatchObject({
      ok: false,
      error: "conflict"
    });
    expect(await createWorld(asDb(), "alice", { name: "over-mp", kind: "mp", seed: 100, profileId: p.profile.id })).toMatchObject({
      ok: false,
      error: "conflict"
    });
  });

  test("a join ticket carries the chosen profile's name + skin, not the account's; a foreign profile is refused", async () => {
    const p = await createProfile(asDb(), "alice", { name: "Steve", skinId: "robot" });
    if (!p.ok) throw new Error("create failed");
    const world = await createWorld(asDb(), "alice", { name: "W", kind: "mp", seed: 1, profileId: p.profile.id });
    if (!world.ok) throw new Error("world failed");

    const minted = await mintTicket(asDb(), { id: "alice", name: "Account Name", skinId: "default" }, world.world.id, "secret-1", p.profile.id);
    expect(minted.ok).toBe(true);
    if (minted.ok) {
      expect(await verifyTicket(minted.ticket, "secret-1")).toMatchObject({ sub: "alice", name: "Steve", skinId: "robot" });
    }

    // bob joins the world but can't mint against alice's profile.
    const invite = await createInvite(asDb(), "alice", world.world.id);
    if (!invite.ok) throw new Error("invite failed");
    await acceptInvite(asDb(), "bob", invite.token);
    expect(await mintTicket(asDb(), { id: "bob", name: "Bob" }, world.world.id, "secret-1", p.profile.id)).toMatchObject({ ok: false, error: "forbidden" });
  });
});

describe("join tickets", () => {
  test("members mint verifiable tickets carrying their role; outsiders can't; sp-cloud worlds refuse", async () => {
    const mp = await makeWorld("alice", "mp");
    const minted = await mintTicket(asDb(), { id: "alice", name: "Alice", skinId: "default" }, mp, "secret-1");
    expect(minted.ok).toBe(true);
    if (minted.ok) {
      const claims = await verifyTicket(minted.ticket, "secret-1");
      expect(claims).toMatchObject({ sub: "alice", wid: mp, role: "owner", name: "Alice" });
    }

    expect((await mintTicket(asDb(), { id: "mallory", name: "M" }, mp, "secret-1")).ok).toBe(false);

    const sp = await makeWorld("alice", "sp-cloud");
    expect(await mintTicket(asDb(), { id: "alice", name: "Alice" }, sp, "secret-1")).toMatchObject({ ok: false, error: "invalid" });
  });
});
