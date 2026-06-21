import { describe, expect, test } from "bun:test";
import { WORLDGEN_VERSION } from "./config";
import {
  createWorld,
  deleteWorld,
  deleteWorldsForProfile,
  hashStringToSeed,
  MAX_SEED,
  readWorlds,
  renameWorld,
  resolveSeed,
  touchWorld,
  WORLD_SAVE_PREFIX,
  worldSaveKey,
  worldsForProfile,
  WORLDS_KEY
} from "./worlds";
import { createProfile } from "./profiles";

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

/** A world must belong to a real profile, so tests seed one with a known id first. */
function seedProfile(storage: Storage, id: string): void {
  createProfile(`name-${id}`, "default", { storage, uid: () => id });
}

describe("seed resolution", () => {
  test("blank input picks a random seed in range", () => {
    expect(resolveSeed("", () => 0.5)).toBe(Math.floor(0.5 * MAX_SEED));
    const random = resolveSeed(null);
    expect(Number.isInteger(random)).toBe(true);
    expect(random).toBeGreaterThanOrEqual(0);
    expect(random).toBeLessThan(MAX_SEED);
  });

  test("numeric text is clamped to a non-negative int", () => {
    expect(resolveSeed("12345")).toBe(12345);
    expect(resolveSeed("-7")).toBe(7);
    expect(resolveSeed("3.9")).toBe(3);
  });

  test("non-numeric text hashes deterministically", () => {
    expect(resolveSeed("hello")).toBe(hashStringToSeed("hello"));
    expect(resolveSeed("hello")).toBe(resolveSeed("hello"));
    expect(resolveSeed("hello")).not.toBe(resolveSeed("world"));
    expect(hashStringToSeed("hello")).toBeLessThan(MAX_SEED);
  });
});

describe("worlds manifest", () => {
  test("worldSaveKey derives a per-world key", () => {
    expect(worldSaveKey("abc")).toBe(`${WORLD_SAVE_PREFIX}abc`);
  });

  test("create stores a world with the current worldgen version", () => {
    const storage = fakeStorage();
    seedProfile(storage, "prof1");
    const world = createWorld("prof1", "Survival", "42", { storage, now: () => 5, uid: () => "w1", rng: () => 0 });
    expect(world).toMatchObject({ profileId: "prof1", name: "Survival", seed: 42, worldgenVersion: WORLDGEN_VERSION });
    expect(world.createdAt).toBe(world.lastPlayedAt);
    expect(readWorlds(storage).worlds).toHaveLength(1);
  });

  test("worldsForProfile filters by owner and sorts most-recently-played first", () => {
    const storage = fakeStorage();
    seedProfile(storage, "A");
    seedProfile(storage, "B");
    let t = 0;
    const mk = (profileId: string, id: string) => createWorld(profileId, id, "1", { storage, now: () => (t += 10), uid: () => id });
    mk("A", "a1");
    mk("A", "a2");
    mk("B", "b1");
    touchWorld("a1", { storage, now: () => 999 }); // a1 jumps to the front
    expect(worldsForProfile("A", storage).map((w) => w.id)).toEqual(["a1", "a2"]);
    expect(worldsForProfile("B", storage).map((w) => w.id)).toEqual(["b1"]);
  });

  test("rename mutates only the named world", () => {
    const storage = fakeStorage();
    seedProfile(storage, "A");
    createWorld("A", "Old", "1", { storage, uid: () => "w1" });
    renameWorld("w1", "Brand New", storage);
    expect(readWorlds(storage).worlds[0].name).toBe("Brand New");
  });

  test("delete removes the index entry and its save blob", () => {
    const storage = fakeStorage();
    seedProfile(storage, "A");
    createWorld("A", "Doomed", "1", { storage, uid: () => "w1" });
    storage.setItem(worldSaveKey("w1"), "{}");
    deleteWorld("w1", storage);
    expect(readWorlds(storage).worlds).toHaveLength(0);
    expect(storage.getItem(worldSaveKey("w1"))).toBeNull();
  });

  test("deleteWorldsForProfile cascades worlds and blobs for one profile only", () => {
    const storage = fakeStorage();
    seedProfile(storage, "A");
    seedProfile(storage, "B");
    createWorld("A", "a1", "1", { storage, uid: () => "a1" });
    createWorld("A", "a2", "1", { storage, uid: () => "a2" });
    createWorld("B", "b1", "1", { storage, uid: () => "b1" });
    storage.setItem(worldSaveKey("a1"), "{}");
    storage.setItem(worldSaveKey("a2"), "{}");
    deleteWorldsForProfile("A", storage);
    expect(readWorlds(storage).worlds.map((w) => w.id)).toEqual(["b1"]);
    expect(storage.getItem(worldSaveKey("a1"))).toBeNull();
    expect(storage.getItem(worldSaveKey("a2"))).toBeNull();
  });

  test("corrupt manifest and malformed entries fall back gracefully", () => {
    expect(readWorlds(fakeStorage({ [WORLDS_KEY]: "not json{" })).worlds).toEqual([]);
    const raw = JSON.stringify({
      version: 1,
      worlds: [{ id: "w1", profileId: "A", name: "Ok", seed: 5, worldgenVersion: 7, createdAt: 1, lastPlayedAt: 1 }, { id: "w2" }, { profileId: "A", seed: 1 }]
    });
    expect(readWorlds(fakeStorage({ [WORLDS_KEY]: raw })).worlds.map((w) => w.id)).toEqual(["w1"]);
  });

  test("an unknown manifest version falls back to the default", () => {
    const future = JSON.stringify({
      version: 2,
      worlds: [{ id: "w1", profileId: "A", name: "Ok", seed: 5, worldgenVersion: 7, createdAt: 1, lastPlayedAt: 1 }]
    });
    expect(readWorlds(fakeStorage({ [WORLDS_KEY]: future })).worlds).toEqual([]);
  });

  test("creating a world for an unknown profile is refused", () => {
    expect(() => createWorld("ghost", "Orphan", "1", { storage: fakeStorage() })).toThrow();
  });

  test("stores the chosen world type, defaulting and sanitizing", () => {
    const storage = fakeStorage();
    seedProfile(storage, "A");
    expect(createWorld("A", "Flat", "1", { storage, uid: () => "wf", worldType: "flat" }).worldType).toBe("flat");
    expect(createWorld("A", "Plain", "1", { storage, uid: () => "wd" }).worldType).toBe("default"); // omitted -> default

    const raw = JSON.stringify({
      version: 1,
      worlds: [{ id: "wx", profileId: "A", name: "X", seed: 1, worldType: "bogus", worldgenVersion: 7, createdAt: 1, lastPlayedAt: 1 }]
    });
    expect(readWorlds(fakeStorage({ [WORLDS_KEY]: raw })).worlds[0].worldType).toBe("default"); // unknown -> default
  });

  test("stores the chosen game mode, defaulting and sanitizing", () => {
    const storage = fakeStorage();
    seedProfile(storage, "A");
    expect(createWorld("A", "Creative", "1", { storage, uid: () => "wc", gameMode: "creative" }).gameMode).toBe("creative");
    expect(createWorld("A", "Plain", "1", { storage, uid: () => "wp" }).gameMode).toBe("survival"); // omitted -> survival

    const raw = JSON.stringify({
      version: 1,
      worlds: [{ id: "wx", profileId: "A", name: "X", seed: 1, gameMode: "bogus", worldgenVersion: 7, createdAt: 1, lastPlayedAt: 1 }]
    });
    expect(readWorlds(fakeStorage({ [WORLDS_KEY]: raw })).worlds[0].gameMode).toBe("survival"); // unknown -> survival
  });

  test("stores the chosen difficulty, defaulting and sanitizing", () => {
    const storage = fakeStorage();
    seedProfile(storage, "A");
    expect(createWorld("A", "Hard", "1", { storage, uid: () => "wh", difficulty: "hard" }).difficulty).toBe("hard");
    expect(createWorld("A", "Plain", "1", { storage, uid: () => "wp" }).difficulty).toBe("normal"); // omitted -> normal

    const raw = JSON.stringify({
      version: 1,
      worlds: [{ id: "wx", profileId: "A", name: "X", seed: 1, difficulty: "bogus", worldgenVersion: 7, createdAt: 1, lastPlayedAt: 1 }]
    });
    expect(readWorlds(fakeStorage({ [WORLDS_KEY]: raw })).worlds[0].difficulty).toBe("normal"); // unknown -> normal
  });
});
