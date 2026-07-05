import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { closeTestDb, createTestDb, type TestDb } from "@/db/testDb";
import { schema } from "@/db";
import { createAuth, type Auth } from "./server";

/**
 * The integration test of the auth seam: the real better-auth wiring
 * (createAuth + drizzleAdapter) against real SQL (PGlite), not mocks. Online
 * play is accounts-only, so what must keep working is exactly email/password
 * sign-up/sign-in and the session shape the API routes read (id, name, and
 * the skinId additional field) — if a better-auth upgrade changes any of it,
 * this fails before any UI is built on it.
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

describe("email/password accounts", () => {
  test("sign-up creates the user and a working session cookie", async () => {
    // returnHeaders (not asResponse): the test runner registers happy-dom,
    // whose browser-faithful Response hides Set-Cookie from scripts.
    const { headers } = await auth.api.signUpEmail({
      body: { email: "keeper@example.com", password: "hunter2hunter2", name: "Keeper" },
      returnHeaders: true
    });
    const cookie = headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();

    const rows = await db.select().from(schema.user).where(eq(schema.user.email, "keeper@example.com"));
    expect(rows).toHaveLength(1);

    // The session carries what the online routes read off it.
    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookie! }) });
    expect(session?.user.id).toBe(rows[0].id);
    expect(session?.user.name).toBe("Keeper");
    expect((session?.user as { skinId?: string | null }).skinId ?? null).toBeNull();
  });

  test("sign-in demands the right password and then yields a session", async () => {
    await auth.api.signUpEmail({
      body: { email: "veteran@example.com", password: "hunter2hunter2", name: "Veteran" }
    });

    await expect(auth.api.signInEmail({ body: { email: "veteran@example.com", password: "wrong-password" } })).rejects.toThrow();

    const { headers } = await auth.api.signInEmail({
      body: { email: "veteran@example.com", password: "hunter2hunter2" },
      returnHeaders: true
    });
    const cookie = headers.get("set-cookie")?.split(";")[0];
    expect(cookie).toBeTruthy();
    const session = await auth.api.getSession({ headers: new Headers({ cookie: cookie! }) });
    expect(session?.user.name).toBe("Veteran");
  });
});
