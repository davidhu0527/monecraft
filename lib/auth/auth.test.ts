import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { closeTestDb, createTestDb, type TestDb } from "@/db/testDb";
import { schema } from "@/db";
import { createAuth, type Auth } from "./server";

/**
 * The load-bearing integration test of the accounts feature: a GUEST who
 * creates worlds and then upgrades to a real account MUST keep them. This
 * exercises the real better-auth flow (anonymous sign-in → email sign-up
 * links the account → onLinkAccount re-parents → anonymous user deleted)
 * against real SQL (PGlite), not mocks — if the plugin's linking semantics
 * ever change under an upgrade, this fails before any UI is built on it.
 */

let db: TestDb;
let auth: Auth;

beforeAll(async () => {
  db = await createTestDb();
  auth = createAuth(db as never, { baseURL: "http://localhost:3000", secret: "test-secret-test-secret-test-secret" });
});

// An unclosed PGlite leaks a pending WASM op that Bun flags as exit code 99.
afterAll(async () => {
  await closeTestDb(db);
});

/**
 * Signs in a fresh guest and returns their session cookie. Uses
 * returnHeaders (not asResponse): the test runner registers happy-dom, whose
 * browser-faithful Response hides Set-Cookie from scripts.
 */
async function guestCookie(): Promise<string> {
  const { headers } = await auth.api.signInAnonymous({ returnHeaders: true });
  const cookie = headers.get("set-cookie");
  expect(cookie).toBeTruthy();
  return cookie!.split(";")[0];
}

describe("guest → account upgrade", () => {
  test("anonymous sign-in creates a session for an isAnonymous user", async () => {
    const cookie = await guestCookie();
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user).toBeTruthy();
    expect((session!.user as { isAnonymous?: boolean }).isAnonymous).toBe(true);
  });

  test("upgrading re-parents worlds, memberships, and invites onto the new account", async () => {
    // 1. A guest arrives…
    const cookie = await guestCookie();
    const anonSession = await auth.api.getSession({ headers: new Headers({ cookie }) });
    const guestId = anonSession!.user.id;

    // 2. …creates a world (owner + membership + an invite link)…
    await db.insert(schema.worlds).values({
      id: "world-1",
      ownerId: guestId,
      kind: "mp",
      name: "Guest Keep",
      seed: 1337,
      worldgenVersion: 11
    });
    await db.insert(schema.worldMembers).values({ worldId: "world-1", userId: guestId, role: "owner" });
    await db.insert(schema.worldInvites).values({ id: "invite-1", worldId: "world-1", token: "tok-abc", createdBy: guestId });

    // 3. …then signs up for a real account WHILE holding the guest session.
    await auth.api.signUpEmail({
      body: { email: "keeper@example.com", password: "hunter2hunter2", name: "Keeper" },
      headers: new Headers({ cookie })
    });

    const newUser = await db.select().from(schema.user).where(eq(schema.user.email, "keeper@example.com"));
    expect(newUser).toHaveLength(1);
    const newId = newUser[0].id;
    expect(newId).not.toBe(guestId);

    // The world, membership, and invite all belong to the upgraded account…
    const worlds = await db.select().from(schema.worlds).where(eq(schema.worlds.ownerId, newId));
    expect(worlds.map((w) => w.id)).toEqual(["world-1"]);
    const members = await db.select().from(schema.worldMembers).where(eq(schema.worldMembers.userId, newId));
    expect(members.map((m) => m.worldId)).toEqual(["world-1"]);
    const invites = await db.select().from(schema.worldInvites).where(eq(schema.worldInvites.createdBy, newId));
    expect(invites.map((i) => i.token)).toEqual(["tok-abc"]);

    // …and the anonymous user is gone (with nothing cascaded away wrongly).
    const guestRows = await db.select().from(schema.user).where(eq(schema.user.id, guestId));
    expect(guestRows).toHaveLength(0);
    const orphanedMembers = await db.select().from(schema.worldMembers).where(eq(schema.worldMembers.userId, guestId));
    expect(orphanedMembers).toHaveLength(0);
  });

  test("linking a guest into an EXISTING account dedups a shared membership", async () => {
    // An established account, owner+member of a world…
    await auth.api.signUpEmail({
      body: { email: "veteran@example.com", password: "hunter2hunter2", name: "Veteran" }
    });
    const veteran = (await db.select().from(schema.user).where(eq(schema.user.email, "veteran@example.com")))[0];

    await db.insert(schema.worlds).values({
      id: "world-2",
      ownerId: veteran.id,
      kind: "mp",
      name: "Shared",
      seed: 7,
      worldgenVersion: 11
    });
    await db.insert(schema.worldMembers).values({ worldId: "world-2", userId: veteran.id, role: "owner" });

    // …the same person, browsing as a guest on another device, joins that
    // world too…
    const cookie = await guestCookie();
    const guestId = (await auth.api.getSession({ headers: new Headers({ cookie }) }))!.user.id;
    await db.insert(schema.worldMembers).values({ worldId: "world-2", userId: guestId, role: "member" });

    // …then signs IN to their existing account while holding the guest
    // session — the anonymous plugin links on sign-in as well, and the merge
    // hits the (worldId, userId) unique index: the guest's duplicate
    // membership must fold away, not explode.
    await auth.api.signInEmail({
      body: { email: "veteran@example.com", password: "hunter2hunter2" },
      headers: new Headers({ cookie })
    });

    const rows = await db.select().from(schema.worldMembers).where(eq(schema.worldMembers.worldId, "world-2"));
    expect(rows).toHaveLength(1); // exactly the veteran's own membership
    expect(rows[0].userId).toBe(veteran.id);
    expect(rows[0].role).toBe("owner"); // the pre-existing row wins
    // The guest row is gone with the guest.
    expect(await db.select().from(schema.user).where(eq(schema.user.id, guestId))).toHaveLength(0);
  });
});
