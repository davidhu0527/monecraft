"use client";

import { createAuthClient } from "better-auth/react";
import { anonymousClient } from "better-auth/client/plugins";

/**
 * Browser-side auth. Guests are created LAZILY — only when the player takes
 * an online action (sign-in panel, cloud sync, joining a world). Plain
 * offline single-player never calls any of this, so it stays account-free.
 *
 * The client itself constructs lazily too: better-auth validates the base
 * URL at construction, which must not run at import time (component tests
 * import menu modules under happy-dom, where no real origin exists).
 */
type Client = ReturnType<typeof createAuthClient<{ plugins: [ReturnType<typeof anonymousClient>] }>>;

let instance: Client | null = null;

export function authClient(): Client {
  instance ??= createAuthClient({
    baseURL: window.location.origin,
    plugins: [anonymousClient()]
  });
  return instance;
}

export type OnlineUser = {
  id: string;
  name: string;
  email: string;
  isAnonymous: boolean;
};

/**
 * "Has this browser ever used online features?" Offline-first hinges on it:
 * until the player takes an online action, the menu makes NO auth requests —
 * so a dev/e2e server without a database never even sees a session fetch.
 */
const ONLINE_USED_KEY = "minecraft_online_v1";

export function onlineUsed(storage: Storage = localStorage): boolean {
  return storage.getItem(ONLINE_USED_KEY) === "1";
}

export function markOnlineUsed(storage: Storage = localStorage): void {
  storage.setItem(ONLINE_USED_KEY, "1");
}

/** The signed-in user (guest or full), or null. */
export async function currentUser(): Promise<OnlineUser | null> {
  const { data } = await authClient().getSession();
  if (!data?.user) return null;
  const user = data.user as { id: string; name: string; email: string; isAnonymous?: boolean | null };
  return { id: user.id, name: user.name, email: user.email, isAnonymous: user.isAnonymous === true };
}

/** Ensures some identity exists — signs in anonymously on first online action. */
export async function ensureSignedIn(): Promise<OnlineUser | null> {
  markOnlineUsed();
  const existing = await currentUser();
  if (existing) return existing;
  const { error } = await authClient().signIn.anonymous();
  if (error) return null;
  return currentUser();
}
