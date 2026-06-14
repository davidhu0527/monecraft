import { describe, expect, test } from "bun:test";
import {
  createProfile,
  deleteProfile,
  DEFAULT_PROFILES_MANIFEST,
  getActiveProfile,
  PROFILES_KEY,
  readProfiles,
  renameProfile,
  setActiveProfile,
  setProfileSkin
} from "./profiles";

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

/** Deterministic deps so ids and timestamps are predictable. */
function seqDeps(storage: Storage) {
  let n = 0;
  return { storage, now: () => 1000 + n, uid: () => `p${(n += 1)}` };
}

describe("profiles manifest", () => {
  test("create appends and makes the new profile active", () => {
    const storage = fakeStorage();
    const a = createProfile("Alice", "alex", seqDeps(storage));
    const b = createProfile("Bob", "robot", { storage, uid: () => "p2" });
    const manifest = readProfiles(storage);
    expect(manifest.profiles.map((p) => p.name)).toEqual(["Alice", "Bob"]);
    expect(manifest.activeProfileId).toBe(b.id);
    expect(a.skinId).toBe("alex");
  });

  test("missing or corrupt manifest falls back to the default", () => {
    expect(readProfiles(fakeStorage())).toEqual(DEFAULT_PROFILES_MANIFEST);
    expect(readProfiles(fakeStorage({ [PROFILES_KEY]: "not json{" }))).toEqual(DEFAULT_PROFILES_MANIFEST);
    expect(readProfiles(fakeStorage({ [PROFILES_KEY]: "null" }))).toEqual(DEFAULT_PROFILES_MANIFEST);
  });

  test("malformed entries are dropped and skin ids sanitized", () => {
    const raw = JSON.stringify({
      version: 1,
      profiles: [{ id: "p1", name: "Real", skinId: "herobrine", createdAt: 1 }, { name: "no id" }, 42],
      activeProfileId: "p1"
    });
    const manifest = readProfiles(fakeStorage({ [PROFILES_KEY]: raw }));
    expect(manifest.profiles).toHaveLength(1);
    expect(manifest.profiles[0]).toMatchObject({ id: "p1", name: "Real", skinId: "default" });
  });

  test("dangling activeProfileId is repaired to the first profile", () => {
    const raw = JSON.stringify({
      version: 1,
      profiles: [{ id: "p1", name: "First", skinId: "default", createdAt: 1 }],
      activeProfileId: "ghost"
    });
    expect(readProfiles(fakeStorage({ [PROFILES_KEY]: raw })).activeProfileId).toBe("p1");
  });

  test("rename and setProfileSkin mutate the named profile", () => {
    const storage = fakeStorage();
    const p = createProfile("Old", "default", seqDeps(storage));
    renameProfile(p.id, "  New   Name  ", storage);
    setProfileSkin(p.id, "knight", storage);
    const updated = getActiveProfile(storage);
    expect(updated).toMatchObject({ name: "New Name", skinId: "knight" });
  });

  test("delete removes a profile and clears active when it was the one deleted", () => {
    const storage = fakeStorage();
    const a = createProfile("A", "default", { storage, uid: () => "pa" });
    const b = createProfile("B", "default", { storage, uid: () => "pb" });
    setActiveProfile(a.id, storage);
    deleteProfile(a.id, storage);
    const manifest = readProfiles(storage);
    expect(manifest.profiles.map((p) => p.id)).toEqual([b.id]);
    expect(manifest.activeProfileId).toBe(b.id); // repaired to the survivor
  });

  test("write failures are swallowed", () => {
    const storage = fakeStorage();
    storage.setItem = () => {
      throw new Error("quota");
    };
    expect(() => createProfile("Q", "default", { storage })).not.toThrow();
  });
});
