import { beforeEach, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "@/db/testDb";
import { schema } from "@/db";
import { verifyTicket } from "@/lib/net/tickets";
import {
  acceptInvite,
  createInvite,
  createWorld,
  deleteWorld,
  getSaveBlob,
  getWorld,
  listWorlds,
  mintTicket,
  putSaveBlob,
  renameWorld,
  resolveInvite,
  revokeInvites
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

async function makeWorld(owner = "alice", kind: "sp-cloud" | "mp" = "mp"): Promise<string> {
  const result = await createWorld(asDb(), owner, { name: "Test World", kind, seed: 1337 });
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
    expect(await createWorld(asDb(), "alice", { name: "  ", kind: "mp", seed: 1 })).toMatchObject({ ok: false, error: "invalid" });
    expect(await createWorld(asDb(), "alice", { name: "x".repeat(65), kind: "mp", seed: 1 })).toMatchObject({ ok: false, error: "invalid" });
    expect(await createWorld(asDb(), "alice", { name: "ok", kind: "nope" as never, seed: 1 })).toMatchObject({ ok: false, error: "invalid" });
    expect(await createWorld(asDb(), "alice", { name: "ok", kind: "mp", seed: Number.NaN })).toMatchObject({ ok: false, error: "invalid" });
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

  test("first upload needs a null base; later uploads need the exact stamp", async () => {
    const id = await makeWorld("alice", "sp-cloud");

    const first = await putSaveBlob(asDb(), "alice", id, blob("v1"), 17, null);
    expect(first.ok).toBe(true);
    const stamp1 = first.ok ? first.updatedAt : "";

    // A second device that never saw the blob must not clobber it.
    expect(await putSaveBlob(asDb(), "alice", id, blob("clobber"), 17, null)).toMatchObject({ ok: false, error: "conflict" });
    // A stale stamp must not clobber either.
    expect(await putSaveBlob(asDb(), "alice", id, blob("stale"), 17, "2000-01-01T00:00:00.000Z")).toMatchObject({
      ok: false,
      error: "conflict"
    });
    // The holder of the current stamp may write.
    const second = await putSaveBlob(asDb(), "alice", id, blob("v2"), 17, stamp1);
    expect(second.ok).toBe(true);

    const fetched = await getSaveBlob(asDb(), "alice", id);
    expect(fetched.ok).toBe(true);
    if (fetched.ok) {
      expect(new TextDecoder().decode(fetched.blob!)).toBe("v2");
      expect(fetched.saveVersion).toBe(17);
    }
  });

  test("non-members can't read or write blobs", async () => {
    const id = await makeWorld("alice", "sp-cloud");
    expect((await getSaveBlob(asDb(), "mallory", id)).ok).toBe(false);
    expect((await putSaveBlob(asDb(), "mallory", id, blob("x"), 17, null)).ok).toBe(false);
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
