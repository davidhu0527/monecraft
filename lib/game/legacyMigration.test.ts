import { describe, expect, test } from "bun:test";
import { AUDIO_SETTINGS_KEY } from "./audio/settings";
import { SAVE_KEY } from "./config";
import { LEGACY_WORLD_NAME, migrateLegacySave } from "./legacyMigration";
import { getActiveProfile, PROFILES_KEY, readProfiles } from "./profiles";
import { readSave } from "./save";
import { SKIN_SETTINGS_KEY } from "./skinSettings";
import { readWorlds, worldSaveKey, worldsForProfile } from "./worlds";
import type { SaveData } from "./types";

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value)
  };
}

// A pre-multi-world blob under the legacy SAVE_KEY (readSave migrates it forward).
const LEGACY_SAVE = { version: 5, seed: 12345, changes: [[7, 3]], player: { x: 1, y: 2, z: 3 } } as unknown as SaveData;

/** Deterministic ids so the profile and world get distinct, predictable keys. */
function seqDeps(storage: Storage) {
  let n = 0;
  return { storage, now: () => 100 + n, uid: () => `id${(n += 1)}` };
}

describe("legacy save migration", () => {
  test("folds a legacy save + global skin into a default profile and world", () => {
    const storage = fakeStorage({
      [SAVE_KEY]: JSON.stringify(LEGACY_SAVE),
      [SKIN_SETTINGS_KEY]: JSON.stringify({ skinId: "knight" }),
      [AUDIO_SETTINGS_KEY]: JSON.stringify({ master: 0.4, music: 0.2, muted: true })
    });

    migrateLegacySave(seqDeps(storage));

    const profile = getActiveProfile(storage);
    expect(profile).toMatchObject({ name: "Player", skinId: "knight" });

    const worlds = worldsForProfile(profile!.id, storage);
    expect(worlds).toHaveLength(1);
    expect(worlds[0]).toMatchObject({ name: LEGACY_WORLD_NAME, seed: 12345 });

    // The blob is copied to the per-world key and the legacy key is removed.
    expect(readSave(worldSaveKey(worlds[0].id), storage)).toMatchObject({ seed: 12345, changes: [[7, 3]] });
    expect(storage.getItem(SAVE_KEY)).toBeNull();

    // Audio settings are global and untouched.
    expect(storage.getItem(AUDIO_SETTINGS_KEY)).toBe(JSON.stringify({ master: 0.4, music: 0.2, muted: true }));
  });

  test("brand-new player (no legacy save) creates nothing — the menu prompts them", () => {
    const storage = fakeStorage();
    migrateLegacySave(seqDeps(storage));
    expect(storage.getItem(PROFILES_KEY)).toBeNull();
    expect(getActiveProfile(storage)).toBeNull();
    expect(readWorlds(storage).worlds).toHaveLength(0);
  });

  test("is idempotent — a second run is a no-op", () => {
    const storage = fakeStorage({ [SAVE_KEY]: JSON.stringify(LEGACY_SAVE) });
    migrateLegacySave(seqDeps(storage));
    const before = storage.getItem(PROFILES_KEY);
    const worldsBefore = readWorlds(storage).worlds;

    migrateLegacySave(seqDeps(storage)); // profiles manifest already present
    expect(storage.getItem(PROFILES_KEY)).toBe(before);
    expect(readProfiles(storage).profiles).toHaveLength(1);
    expect(readWorlds(storage).worlds).toEqual(worldsBefore);
  });

  test("no custom skin falls back to the default", () => {
    const storage = fakeStorage({ [SAVE_KEY]: JSON.stringify(LEGACY_SAVE) });
    migrateLegacySave(seqDeps(storage));
    expect(getActiveProfile(storage)?.skinId).toBe("default");
  });
});
