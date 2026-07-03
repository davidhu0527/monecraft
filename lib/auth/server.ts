import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Server-side auth. Guests are first-class: the anonymous plugin mints a real
 * user (isAnonymous) on the first online action, so "play now" needs no form —
 * and when the guest later signs up (email/password or OAuth), onLinkAccount
 * re-parents everything they own onto the new account before the anonymous
 * user is deleted. That hook IS the "guests keep their worlds" promise; the
 * integration test in lib/auth/auth.test.ts exercises it end to end.
 *
 * Exposed as a factory so tests run the identical wiring against PGlite.
 */

type AnyDrizzleDb = Parameters<typeof drizzleAdapter>[0];

export function createAuth(database: AnyDrizzleDb, options: { baseURL?: string; secret?: string } = {}) {
  return betterAuth({
    baseURL: options.baseURL ?? process.env.BETTER_AUTH_URL,
    secret: options.secret ?? process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(database, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification
      }
    }),
    emailAndPassword: {
      enabled: true
    },
    user: {
      additionalFields: {
        skinId: { type: "string", required: false }
      }
    },
    plugins: [
      anonymous({
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          // Everything the guest owned moves to the upgraded account. The
          // anonymous user row is deleted right after this hook, and the FKs
          // cascade — so a missed table here would silently destroy data.
          const target = database as unknown as import("@/db").Db;
          const from = anonymousUser.user.id;
          const to = newUser.user.id;
          await target.update(schema.worlds).set({ ownerId: to }).where(eq(schema.worlds.ownerId, from));
          await target.update(schema.worldInvites).set({ createdBy: to }).where(eq(schema.worldInvites.createdBy, from));
          // Memberships can collide if the new account already joined the same
          // world; drop the guest's row in that case (the membership exists).
          const memberships = await target.select().from(schema.worldMembers).where(eq(schema.worldMembers.userId, from));
          for (const membership of memberships) {
            await target
              .insert(schema.worldMembers)
              .values({ ...membership, userId: to })
              .onConflictDoNothing();
          }
          await target.delete(schema.worldMembers).where(eq(schema.worldMembers.userId, from));
        }
      })
    ]
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | null = null;

/** The app's auth singleton (lazy: importing this module never needs env). */
export function auth(): Auth {
  instance ??= createAuth(db());
  return instance;
}
