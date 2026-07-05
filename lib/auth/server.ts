import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, schema } from "@/db";

/**
 * Server-side auth: email/password accounts, nothing else. Online play is
 * accounts-only — logged-out Local Players never reach this layer, and the
 * anonymous-guest plugin that once minted throwaway users is gone.
 *
 * Exposed as a factory so tests run the identical wiring against PGlite
 * (lib/auth/auth.test.ts keeps that seam honest).
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
    }
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | null = null;

/** The app's auth singleton (lazy: importing this module never needs env). */
export function auth(): Auth {
  instance ??= createAuth(db());
  return instance;
}
