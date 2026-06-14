/**
 * Player profiles — the top of the save hierarchy. A profile is a distinct
 * player (name + appearance) that owns a list of worlds (see lib/game/worlds.ts
 * for the 1:N link via `WorldMeta.profileId`). Profiles carry identity only;
 * audio settings stay global.
 *
 * The whole list lives in one versioned localStorage blob. Readers are total:
 * malformed entries are dropped, skin ids are sanitized, and a dangling
 * `activeProfileId` is repaired to the first surviving profile (or null).
 */

import { DEFAULT_SKIN_ID, isSkinId, type SkinId } from "./playerSkins";
import { readManifestRaw, resolveDeps, sanitizeName, writeManifest, type ManifestDeps } from "./manifest";

export type Profile = {
  id: string;
  name: string;
  skinId: SkinId;
  createdAt: number;
};

export type ProfilesManifest = {
  version: 1;
  profiles: Profile[];
  /** The profile to preselect on boot; null shows the create-first-profile flow. */
  activeProfileId: string | null;
};

export const PROFILES_KEY = "minecraft_profiles_v1";
export const MAX_PROFILE_NAME = 24;
export const DEFAULT_PROFILE_NAME = "Player";

export const DEFAULT_PROFILES_MANIFEST: ProfilesManifest = { version: 1, profiles: [], activeProfileId: null };

/** Coerces one raw entry into a valid Profile, or null if it can't be salvaged. */
function sanitizeProfile(raw: unknown): Profile | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.id !== "string" || entry.id.length === 0) return null;
  return {
    id: entry.id,
    name: sanitizeName(entry.name, DEFAULT_PROFILE_NAME, MAX_PROFILE_NAME),
    skinId: isSkinId(entry.skinId) ? entry.skinId : DEFAULT_SKIN_ID,
    createdAt: typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt) ? entry.createdAt : 0
  };
}

/** Repairs `activeProfileId` so it always names a present profile (or null when empty). */
function withRepairedActive(profiles: Profile[], activeProfileId: unknown): ProfilesManifest {
  const valid = typeof activeProfileId === "string" && profiles.some((p) => p.id === activeProfileId);
  return {
    version: 1,
    profiles,
    activeProfileId: valid ? (activeProfileId as string) : (profiles[0]?.id ?? null)
  };
}

/** Reads the profiles manifest, dropping malformed entries and repairing the active id. Never throws. */
export function readProfiles(storage: Storage = localStorage): ProfilesManifest {
  const raw = readManifestRaw(PROFILES_KEY, storage) as Partial<ProfilesManifest> | null;
  if (!raw || !Array.isArray(raw.profiles)) return { ...DEFAULT_PROFILES_MANIFEST };
  const profiles = raw.profiles.map(sanitizeProfile).filter((p): p is Profile => p !== null);
  return withRepairedActive(profiles, raw.activeProfileId);
}

export function getProfile(id: string, storage: Storage = localStorage): Profile | null {
  return readProfiles(storage).profiles.find((p) => p.id === id) ?? null;
}

export function getActiveProfile(storage: Storage = localStorage): Profile | null {
  const manifest = readProfiles(storage);
  return manifest.profiles.find((p) => p.id === manifest.activeProfileId) ?? null;
}

/** Creates a profile, makes it the active one, persists, and returns it. */
export function createProfile(name: string, skinId: SkinId, deps: ManifestDeps = {}): Profile {
  const { storage, now, uid } = resolveDeps(deps);
  const profile: Profile = {
    id: uid(),
    name: sanitizeName(name, DEFAULT_PROFILE_NAME, MAX_PROFILE_NAME),
    skinId: isSkinId(skinId) ? skinId : DEFAULT_SKIN_ID,
    createdAt: now()
  };
  const manifest = readProfiles(storage);
  const next: ProfilesManifest = { version: 1, profiles: [...manifest.profiles, profile], activeProfileId: profile.id };
  writeManifest(PROFILES_KEY, next, storage);
  return profile;
}

export function renameProfile(id: string, name: string, storage: Storage = localStorage): ProfilesManifest {
  const manifest = readProfiles(storage);
  const next = withRepairedActive(
    manifest.profiles.map((p) => (p.id === id ? { ...p, name: sanitizeName(name, p.name, MAX_PROFILE_NAME) } : p)),
    manifest.activeProfileId
  );
  writeManifest(PROFILES_KEY, next, storage);
  return next;
}

export function setProfileSkin(id: string, skinId: SkinId, storage: Storage = localStorage): ProfilesManifest {
  const manifest = readProfiles(storage);
  const safeSkin = isSkinId(skinId) ? skinId : DEFAULT_SKIN_ID;
  const next = withRepairedActive(
    manifest.profiles.map((p) => (p.id === id ? { ...p, skinId: safeSkin } : p)),
    manifest.activeProfileId
  );
  writeManifest(PROFILES_KEY, next, storage);
  return next;
}

export function setActiveProfile(id: string | null, storage: Storage = localStorage): ProfilesManifest {
  const manifest = readProfiles(storage);
  const next = withRepairedActive(manifest.profiles, id);
  writeManifest(PROFILES_KEY, next, storage);
  return next;
}

/**
 * Removes a profile and repairs the active id. Does NOT touch the profile's
 * worlds — call `deleteWorldsForProfile` (lib/game/worlds.ts) first so the
 * world records and their save blobs are reclaimed too.
 */
export function deleteProfile(id: string, storage: Storage = localStorage): ProfilesManifest {
  const manifest = readProfiles(storage);
  const profiles = manifest.profiles.filter((p) => p.id !== id);
  const next = withRepairedActive(profiles, manifest.activeProfileId === id ? null : manifest.activeProfileId);
  writeManifest(PROFILES_KEY, next, storage);
  return next;
}
