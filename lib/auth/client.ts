"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Browser-side auth. Online play needs a signed-in account; logged-out Local
 * Players never call any of this, so plain offline single-player stays
 * account-free.
 *
 * The client itself constructs lazily: better-auth validates the base URL at
 * construction, which must not run at import time (component tests import
 * menu modules under happy-dom, where no real origin exists).
 */
type Client = ReturnType<typeof createAuthClient>;

let instance: Client | null = null;

export function authClient(): Client {
  instance ??= createAuthClient({
    baseURL: window.location.origin
  });
  return instance;
}

export type OnlineUser = {
  id: string;
  name: string;
  email: string;
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

/** The signed-in account, or null. */
export async function currentUser(): Promise<OnlineUser | null> {
  const { data } = await authClient().getSession();
  if (!data?.user) return null;
  const user = data.user as { id: string; name: string; email: string };
  return { id: user.id, name: user.name, email: user.email };
}
