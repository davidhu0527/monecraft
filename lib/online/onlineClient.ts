"use client";

import type { WorldSummary } from "@/lib/online/worldsService";

/**
 * Browser-side fetch helpers for the online worlds API. Thin and total:
 * failures come back as null/false, never exceptions — the menu shows
 * "offline" states instead of crashing.
 */

export type OnlineWorld = WorldSummary;

export async function listOnlineWorlds(): Promise<OnlineWorld[] | null> {
  try {
    const response = await fetch("/api/worlds");
    if (!response.ok) return null;
    const { worlds } = (await response.json()) as { worlds: OnlineWorld[] };
    return worlds;
  } catch {
    return null;
  }
}

export async function createOnlineWorld(input: {
  name: string;
  seed: number;
  worldType: string;
  gameMode: string;
  difficulty: string;
  hardcore: boolean;
  /** "mp" (a server-hosted co-op room, the default) or "sp-cloud" (a synced single-player save). */
  kind?: "mp" | "sp-cloud";
}): Promise<OnlineWorld | null> {
  try {
    const response = await fetch("/api/worlds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, kind: input.kind ?? "mp" })
    });
    if (!response.ok) return null;
    const { world } = (await response.json()) as { world: OnlineWorld };
    return world;
  } catch {
    return null;
  }
}

/** Deletes an online world server-side (owner only; cascades members/invites). Returns whether it succeeded. */
export async function deleteOnlineWorld(worldId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/worlds/${worldId}`, { method: "DELETE" });
    return response.ok;
  } catch {
    return false;
  }
}

/** Mints an invite token and returns the full shareable link. */
export async function createInviteLink(worldId: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/worlds/${worldId}/invites`, { method: "POST" });
    if (!response.ok) return null;
    const { token } = (await response.json()) as { token: string };
    return `${window.location.origin}/join/${token}`;
  } catch {
    return null;
  }
}

/** Revokes every outstanding invite link for a world (owner only). Returns the count, or null on failure. */
export async function revokeInviteLinks(worldId: string): Promise<number | null> {
  try {
    const response = await fetch(`/api/worlds/${worldId}/invites`, { method: "DELETE" });
    if (!response.ok) return null;
    const { revoked } = (await response.json()) as { revoked: number };
    return revoked;
  } catch {
    return null;
  }
}

export async function resolveInviteToken(token: string): Promise<{ worldId: string; worldName: string } | null> {
  try {
    const response = await fetch(`/api/invite/${token}`);
    if (!response.ok) return null;
    return (await response.json()) as { worldId: string; worldName: string };
  } catch {
    return null;
  }
}

export async function acceptInviteToken(token: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/invite/${token}`, { method: "POST" });
    return response.ok;
  } catch {
    return false;
  }
}

/** The join ticket + where to connect. Null covers "not a member" and misconfiguration alike. */
export async function requestJoinTicket(worldId: string): Promise<{ ticket: string; gameServerUrl: string } | null> {
  try {
    const response = await fetch(`/api/worlds/${worldId}/ticket`, { method: "POST" });
    if (!response.ok) return null;
    const { ticket, gameServerUrl } = (await response.json()) as { ticket: string; gameServerUrl: string | null };
    if (!gameServerUrl) return null;
    return { ticket, gameServerUrl };
  } catch {
    return null;
  }
}
