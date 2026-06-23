/**
 * Worlds — the second level of the save hierarchy. Each world belongs to one
 * profile (`profileId`) and owns a single bundled SaveData blob under its own
 * `minecraft_world_save_<id>` key (read/written with the existing
 * lib/game/save.ts helpers). The world *index* — names, seeds, ordering — lives
 * in one versioned manifest blob; the heavy per-world saves stay separate so
 * the index reads cheaply.
 *
 * A world's `seed` is resolved once at creation and is the source of truth for
 * regeneration; `worldgenVersion` records the WORLDGEN_VERSION it was generated
 * under so a future baseline bump can discard its stale block-diffs.
 */

import { isWorldType, type WorldType } from "@/lib/world";
import { isGameMode, type GameMode } from "./gameModes";
import { isDifficulty, type Difficulty } from "./difficulties";
import { WORLDGEN_VERSION } from "./config";
import { readManifestRaw, resolveDeps, sanitizeName, writeManifest, type ManifestDeps } from "./manifest";
import { getProfile } from "./profiles";

export type WorldMeta = {
  id: string;
  profileId: string;
  name: string;
  seed: number;
  worldType: WorldType;
  /** Initial game mode, chosen at creation. The *current* mode (switchable in-game) lives in the save blob. */
  gameMode: GameMode;
  /** Initial difficulty, chosen at creation. The *current* difficulty (switchable in-game) lives in the save blob. */
  difficulty: Difficulty;
  /** Hardcore world: forces Survival + Hard and permadeath. Immutable for the world's life (unlike gameMode/difficulty). */
  hardcore: boolean;
  worldgenVersion: number;
  createdAt: number;
  lastPlayedAt: number;
};

/** UI metadata for the world-type picker (the engine side lives in lib/world/worldTypes.ts). */
export const WORLD_TYPE_PRESETS: ReadonlyArray<{ id: WorldType; label: string; blurb: string }> = [
  { id: "default", label: "Default", blurb: "Balanced terrain, every biome" },
  { id: "flat", label: "Superflat", blurb: "Level ground — a builder's canvas" },
  { id: "amplified", label: "Amplified", blurb: "Towering, dramatic relief" },
  { id: "islands", label: "Islands", blurb: "Scattered land in a wide sea" }
];

export type WorldsManifest = {
  version: 1;
  worlds: WorldMeta[];
};

export const WORLDS_KEY = "minecraft_worlds_v1";
export const WORLD_SAVE_PREFIX = "minecraft_world_save_";
export const MAX_WORLD_NAME = 32;
export const DEFAULT_WORLD_NAME = "New World";
export const MAX_SEED = 2147483647;

export const DEFAULT_WORLDS_MANIFEST: WorldsManifest = { version: 1, worlds: [] };

/** The per-world SaveData key handed to readSave/writeSave. */
export function worldSaveKey(worldId: string): string {
  return WORLD_SAVE_PREFIX + worldId;
}

/** FNV-1a hash of a text seed into a stable non-negative 31-bit integer (Minecraft-style). */
export function hashStringToSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash | 0) % MAX_SEED;
}

/**
 * Resolves a user seed input to an integer in 0..MAX_SEED-1: blank → random
 * (same entropy the engine used for a fresh world), numeric text → clamped int,
 * any other text → stable hash. `rng` is injectable for deterministic tests.
 */
export function resolveSeed(seedInput: string | null, rng: () => number = Math.random): number {
  const trimmed = (seedInput ?? "").trim();
  if (trimmed === "") return Math.floor(rng() * MAX_SEED);
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) return Math.floor(Math.abs(asNumber)) % MAX_SEED;
  return hashStringToSeed(trimmed);
}

/** Coerces one raw entry into a valid WorldMeta, or null if it can't be salvaged. */
function sanitizeWorld(raw: unknown): WorldMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.id !== "string" || entry.id.length === 0) return null;
  if (typeof entry.profileId !== "string" || entry.profileId.length === 0) return null;
  if (typeof entry.seed !== "number" || !Number.isFinite(entry.seed)) return null;
  const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
  // Hardcore is the source of truth — keep the persisted mode/difficulty consistent
  // with it (the engine forces them at runtime, but the meta drives the UI/card too).
  const hardcore = entry.hardcore === true;
  return {
    id: entry.id,
    profileId: entry.profileId,
    name: sanitizeName(entry.name, DEFAULT_WORLD_NAME, MAX_WORLD_NAME),
    seed: Math.floor(entry.seed),
    worldType: isWorldType(entry.worldType) ? entry.worldType : "default",
    gameMode: hardcore ? "survival" : isGameMode(entry.gameMode) ? entry.gameMode : "survival",
    difficulty: hardcore ? "hard" : isDifficulty(entry.difficulty) ? entry.difficulty : "normal",
    hardcore,
    worldgenVersion: num(entry.worldgenVersion, WORLDGEN_VERSION),
    createdAt: num(entry.createdAt, 0),
    lastPlayedAt: num(entry.lastPlayedAt, 0)
  };
}

/** Reads the worlds manifest, dropping malformed entries. Never throws. */
export function readWorlds(storage: Storage = localStorage): WorldsManifest {
  const raw = readManifestRaw(WORLDS_KEY, storage) as Partial<WorldsManifest> | null;
  // Only the current manifest version is understood; an unknown version falls
  // back to the default rather than risk misreading an incompatible payload.
  if (!raw || raw.version !== 1 || !Array.isArray(raw.worlds)) return { ...DEFAULT_WORLDS_MANIFEST };
  return { version: 1, worlds: raw.worlds.map(sanitizeWorld).filter((w): w is WorldMeta => w !== null) };
}

export function getWorld(id: string, storage: Storage = localStorage): WorldMeta | null {
  return readWorlds(storage).worlds.find((w) => w.id === id) ?? null;
}

/** A profile's worlds, most-recently-played first (ties broken by creation time). */
export function worldsForProfile(profileId: string, storage: Storage = localStorage): WorldMeta[] {
  return readWorlds(storage)
    .worlds.filter((w) => w.profileId === profileId)
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt || b.createdAt - a.createdAt);
}

/** Creates a world for an existing profile, persists it, and returns it (throws on an unknown profile). `deps.rng` seeds blank-input worlds; `deps.worldType` picks the generation preset; `deps.gameMode`/`deps.difficulty` pick the initial mode/difficulty; `deps.hardcore` flags a permadeath world. */
export function createWorld(
  profileId: string,
  name: string,
  seedInput: string | null,
  deps: ManifestDeps & { rng?: () => number; worldType?: WorldType; gameMode?: GameMode; difficulty?: Difficulty; hardcore?: boolean } = {}
): WorldMeta {
  const { storage, now, uid } = resolveDeps(deps);
  // Worlds must belong to a real profile — refuse to persist an orphan record.
  if (!getProfile(profileId, storage)) throw new Error(`createWorld: unknown profile "${profileId}"`);
  const createdAt = now();
  // Hardcore forces Survival + Hard, so the persisted meta is consistent from birth.
  const hardcore = deps.hardcore === true;
  const world: WorldMeta = {
    id: uid(),
    profileId,
    name: sanitizeName(name, DEFAULT_WORLD_NAME, MAX_WORLD_NAME),
    seed: resolveSeed(seedInput, deps.rng ?? Math.random),
    worldType: isWorldType(deps.worldType) ? deps.worldType : "default",
    gameMode: hardcore ? "survival" : isGameMode(deps.gameMode) ? deps.gameMode : "survival",
    difficulty: hardcore ? "hard" : isDifficulty(deps.difficulty) ? deps.difficulty : "normal",
    hardcore,
    worldgenVersion: WORLDGEN_VERSION,
    createdAt,
    lastPlayedAt: createdAt
  };
  const manifest = readWorlds(storage);
  writeManifest(WORLDS_KEY, { version: 1, worlds: [...manifest.worlds, world] }, storage);
  return world;
}

export function renameWorld(id: string, name: string, storage: Storage = localStorage): WorldsManifest {
  const manifest = readWorlds(storage);
  const next: WorldsManifest = {
    version: 1,
    worlds: manifest.worlds.map((w) => (w.id === id ? { ...w, name: sanitizeName(name, w.name, MAX_WORLD_NAME) } : w))
  };
  writeManifest(WORLDS_KEY, next, storage);
  return next;
}

/** Bumps a world's `lastPlayedAt` so it sorts to the top of its profile's list. */
export function touchWorld(id: string, deps: ManifestDeps = {}): WorldsManifest {
  const { storage, now } = resolveDeps(deps);
  const manifest = readWorlds(storage);
  const next: WorldsManifest = {
    version: 1,
    worlds: manifest.worlds.map((w) => (w.id === id ? { ...w, lastPlayedAt: now() } : w))
  };
  writeManifest(WORLDS_KEY, next, storage);
  return next;
}

/** Removes a world from the index and deletes its save blob. */
export function deleteWorld(id: string, storage: Storage = localStorage): WorldsManifest {
  const manifest = readWorlds(storage);
  const next: WorldsManifest = { version: 1, worlds: manifest.worlds.filter((w) => w.id !== id) };
  writeManifest(WORLDS_KEY, next, storage);
  try {
    storage.removeItem(worldSaveKey(id));
  } catch {
    // A failed blob cleanup just leaves an orphaned key; the index no longer references it.
  }
  return next;
}

/** Cascade for profile deletion: removes every world of a profile and its save blobs. */
export function deleteWorldsForProfile(profileId: string, storage: Storage = localStorage): WorldsManifest {
  const manifest = readWorlds(storage);
  const doomed = manifest.worlds.filter((w) => w.profileId === profileId);
  const next: WorldsManifest = { version: 1, worlds: manifest.worlds.filter((w) => w.profileId !== profileId) };
  writeManifest(WORLDS_KEY, next, storage);
  for (const world of doomed) {
    try {
      storage.removeItem(worldSaveKey(world.id));
    } catch {
      // Orphaned blob; the index no longer references it.
    }
  }
  return next;
}
