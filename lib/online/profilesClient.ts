"use client";

import type { ProfileSummary } from "@/lib/online/worldsService";

/**
 * Browser-side fetch helpers for account (online) profiles — the cross-device
 * identities a signed-in account owns. Thin and total: failures come back as
 * null/false, never exceptions, so the menu shows offline/limit states instead
 * of crashing. Local Players use lib/game/profiles.ts (localStorage) instead.
 */

export type OnlineProfile = ProfileSummary;

export async function listOnlineProfiles(): Promise<OnlineProfile[] | null> {
  try {
    const response = await fetch("/api/profiles");
    if (!response.ok) return null;
    const { profiles } = (await response.json()) as { profiles: OnlineProfile[] };
    return profiles;
  } catch {
    return null;
  }
}

export async function createOnlineProfile(input: { name: string; skinId?: string | null }): Promise<OnlineProfile | null> {
  try {
    const response = await fetch("/api/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!response.ok) return null;
    const { profile } = (await response.json()) as { profile: OnlineProfile };
    return profile;
  } catch {
    return null;
  }
}

/** Rename and/or reskin a profile. Returns whether it succeeded. */
export async function updateOnlineProfile(id: string, patch: { name?: string; skinId?: string | null }): Promise<boolean> {
  try {
    const response = await fetch(`/api/profiles/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch)
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Delete a profile and (server-side, cascading) its online worlds. */
export async function deleteOnlineProfile(id: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/profiles/${id}`, { method: "DELETE" });
    return response.ok;
  } catch {
    return false;
  }
}
