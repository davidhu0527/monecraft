import { describe, expect, test } from "bun:test";
import type { AsyncKv } from "@/lib/game/idbKv";
import { createWorldSaveStore } from "@/lib/game/saveStore";
import { worldSaveKey } from "@/lib/game/worlds";
import type { SaveData } from "@/lib/game/types";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value)
  };
}

/** Minimal valid current-version blob (reads parse in place - a stale version would migrate and break the round-trip equality asserts); the seed makes instances distinguishable. */
function sampleSave(seed: number): SaveData {
  return { version: 18, seed, changes: [], players: [] } as unknown as SaveData;
}

/**
 * Map-backed AsyncKv (the async sibling of the repo's Storage fakes). `gate`
 * lets a test hold get/put/delete in flight to probe queue ordering.
 */
function createFakeKv(options: { failPuts?: boolean; unavailable?: boolean } = {}) {
  const data = new Map<string, unknown>();
  const putLog: string[] = [];
  let gate: Promise<void> = Promise.resolve();
  const kv: AsyncKv = {
    ready: async () => !options.unavailable,
    get: async (key) => {
      await gate;
      return data.has(key) ? structuredClone(data.get(key)) : undefined;
    },
    put: async (key, value) => {
      await gate;
      if (options.failPuts) throw new Error("put failed");
      data.set(key, structuredClone(value));
      putLog.push(key);
    },
    delete: async (key) => {
      await gate;
      data.delete(key);
    },
    tryPutSync: (key, value) => {
      if (options.unavailable) return false;
      data.set(key, structuredClone(value));
      putLog.push(key);
      return true;
    }
  };
  return { kv, data, putLog, setGate: (next: Promise<void>) => (gate = next) };
}

/** Lets timer-scheduled continuations (the void-enqueued flushes) settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("worldSaveStore", () => {
  test("write then read round-trips and lands durably in the kv", async () => {
    const { kv, data } = createFakeKv();
    const store = createWorldSaveStore({ kv, storage: memoryStorage() });
    await store.write("w1", sampleSave(7));
    expect(data.get("w1")).toEqual(sampleSave(7));
    expect(await store.read("w1")).toEqual(sampleSave(7));
  });

  test("read of an unknown world resolves null", async () => {
    const { kv } = createFakeKv();
    const store = createWorldSaveStore({ kv, storage: memoryStorage() });
    expect(await store.read("nope")).toBeNull();
  });

  test("a read during an in-flight write returns the pending value", async () => {
    const { kv, setGate } = createFakeKv();
    const store = createWorldSaveStore({ kv, storage: memoryStorage() });
    let release!: () => void;
    setGate(new Promise((resolve) => (release = resolve)));
    const write = store.write("w1", sampleSave(1));
    expect(await store.read("w1")).toEqual(sampleSave(1)); // memory, not disk
    release();
    await write;
    expect(await store.read("w1")).toEqual(sampleSave(1)); // now from the kv
  });

  test("rapid writes coalesce latest-wins", async () => {
    const { kv, data, putLog, setGate } = createFakeKv();
    const store = createWorldSaveStore({ kv, storage: memoryStorage() });
    let release!: () => void;
    setGate(new Promise((resolve) => (release = resolve)));
    void store.write("w1", sampleSave(1));
    void store.write("w1", sampleSave(2));
    const last = store.write("w1", sampleSave(3));
    release();
    await last;
    expect(data.get("w1")).toEqual(sampleSave(3));
    // First put was in flight when the newer values arrived; they collapse
    // into a single follow-up put.
    expect(putLog.filter((key) => key === "w1").length).toBeLessThanOrEqual(2);
  });

  test("a failed write keeps serving the newest state from memory and retries on the next write", async () => {
    const failing = createFakeKv({ failPuts: true });
    const store = createWorldSaveStore({ kv: failing.kv, storage: memoryStorage() });
    await expect(store.write("w1", sampleSave(1))).rejects.toThrow("put failed");
    await settle();
    expect(await store.read("w1")).toEqual(sampleSave(1)); // memory, despite the disk failure
  });

  test("remove tombstones the record and clears both stores", async () => {
    const { kv, data } = createFakeKv();
    const storage = memoryStorage({ [worldSaveKey("w1")]: JSON.stringify(sampleSave(1)) });
    const store = createWorldSaveStore({ kv, storage });
    await store.write("w1", sampleSave(2));
    await store.remove("w1");
    expect(await store.read("w1")).toBeNull();
    expect(data.has("w1")).toBe(false);
    expect(storage.getItem(worldSaveKey("w1"))).toBeNull();
  });

  describe("lazy migration on read", () => {
    test("a localStorage blob is returned, copied to the kv, then deleted from localStorage", async () => {
      const { kv, data } = createFakeKv();
      const storage = memoryStorage({ [worldSaveKey("w1")]: JSON.stringify(sampleSave(9)) });
      const store = createWorldSaveStore({ kv, storage });
      expect(await store.read("w1")).toEqual(sampleSave(9));
      await settle();
      expect(data.get("w1")).toEqual(sampleSave(9)); // copy landed…
      expect(storage.getItem(worldSaveKey("w1"))).toBeNull(); // …then the original was removed
    });

    test("a failed copy keeps the localStorage original and still returns the data", async () => {
      const failing = createFakeKv({ failPuts: true });
      const storage = memoryStorage({ [worldSaveKey("w1")]: JSON.stringify(sampleSave(9)) });
      const store = createWorldSaveStore({ kv: failing.kv, storage });
      expect(await store.read("w1")).toEqual(sampleSave(9));
      await settle();
      expect(storage.getItem(worldSaveKey("w1"))).not.toBeNull();
    });

    test("a corrupt localStorage blob reads null and is left in place", async () => {
      const { kv } = createFakeKv();
      const storage = memoryStorage({ [worldSaveKey("w1")]: "{not json" });
      const store = createWorldSaveStore({ kv, storage });
      expect(await store.read("w1")).toBeNull();
      await settle();
      expect(storage.getItem(worldSaveKey("w1"))).toBe("{not json");
    });
  });

  test("a successful write clears a lingering localStorage shadow copy", async () => {
    const { kv } = createFakeKv();
    const storage = memoryStorage({ [worldSaveKey("w1")]: JSON.stringify(sampleSave(1)) });
    const store = createWorldSaveStore({ kv, storage });
    await store.write("w1", sampleSave(2));
    expect(storage.getItem(worldSaveKey("w1"))).toBeNull();
  });

  describe("fallback mode (IndexedDB unavailable)", () => {
    test("ops go through the injected Storage under the legacy keys", async () => {
      const off = createFakeKv({ unavailable: true });
      const storage = memoryStorage();
      const store = createWorldSaveStore({ kv: off.kv, storage });
      await store.write("w1", sampleSave(4));
      expect(JSON.parse(storage.getItem(worldSaveKey("w1"))!).seed).toBe(4);
      expect(await store.read("w1")).toEqual(sampleSave(4));
      await store.remove("w1");
      expect(storage.getItem(worldSaveKey("w1"))).toBeNull();
      expect(off.data.size).toBe(0); // the kv was never touched
    });

    test("a quota throw surfaces as a rejected write", async () => {
      const off = createFakeKv({ unavailable: true });
      const storage = memoryStorage();
      storage.setItem = () => {
        throw new Error("QuotaExceededError");
      };
      const store = createWorldSaveStore({ kv: off.kv, storage });
      await expect(store.write("w1", sampleSave(1))).rejects.toThrow("QuotaExceededError");
    });

    test("flushWrite writes synchronously once the mode is known", async () => {
      const off = createFakeKv({ unavailable: true });
      const storage = memoryStorage();
      const store = createWorldSaveStore({ kv: off.kv, storage });
      await store.read("w1"); // resolves the mode probe
      store.flushWrite("w1", sampleSave(5));
      expect(JSON.parse(storage.getItem(worldSaveKey("w1"))!).seed).toBe(5); // no await needed
    });
  });

  test("flushWrite starts the put synchronously in IndexedDB mode", async () => {
    const { kv, data } = createFakeKv();
    const store = createWorldSaveStore({ kv, storage: memoryStorage() });
    await store.read("w1"); // resolves the mode probe (and warms a real connection)
    store.flushWrite("w1", sampleSave(6));
    expect(data.get("w1")).toEqual(sampleSave(6)); // tryPutSync path, no await
    expect(await store.read("w1")).toEqual(sampleSave(6));
  });

  describe("migrateAll", () => {
    test("sweeps every prefixed key — including manifest-less cloud: ids — copy-then-delete", async () => {
      const { kv, data } = createFakeKv();
      const storage = memoryStorage({
        [worldSaveKey("w1")]: JSON.stringify(sampleSave(1)),
        [worldSaveKey("cloud:abc")]: JSON.stringify(sampleSave(2)),
        minecraft_worlds_v1: JSON.stringify({ version: 1, worlds: [] }) // not a save key: untouched
      });
      const store = createWorldSaveStore({ kv, storage });
      await store.migrateAll();
      expect(data.get("w1")).toEqual(sampleSave(1));
      expect(data.get("cloud:abc")).toEqual(sampleSave(2));
      expect(storage.getItem(worldSaveKey("w1"))).toBeNull();
      expect(storage.getItem(worldSaveKey("cloud:abc"))).toBeNull();
      expect(storage.getItem("minecraft_worlds_v1")).not.toBeNull();
    });

    test("is idempotent and never overwrites an existing record", async () => {
      const { kv, data, putLog } = createFakeKv();
      const storage = memoryStorage({ [worldSaveKey("w1")]: JSON.stringify(sampleSave(1)) });
      const store = createWorldSaveStore({ kv, storage });
      await store.migrateAll();
      const putsAfterFirst = putLog.length;
      // A stale shadow copy reappears (e.g. an earlier failed cleanup) — the
      // sweep must not clobber the newer IndexedDB record with it.
      storage.setItem(worldSaveKey("w1"), JSON.stringify(sampleSave(99)));
      await store.migrateAll();
      expect(putLog.length).toBe(putsAfterFirst);
      expect(data.get("w1")).toEqual(sampleSave(1));
    });

    test("skips corrupt blobs and leaves them in localStorage", async () => {
      const { kv, data } = createFakeKv();
      const storage = memoryStorage({ [worldSaveKey("bad")]: "{not json" });
      const store = createWorldSaveStore({ kv, storage });
      await store.migrateAll();
      expect(data.has("bad")).toBe(false);
      expect(storage.getItem(worldSaveKey("bad"))).toBe("{not json");
    });

    test("no-ops in fallback mode", async () => {
      const off = createFakeKv({ unavailable: true });
      const storage = memoryStorage({ [worldSaveKey("w1")]: JSON.stringify(sampleSave(1)) });
      const store = createWorldSaveStore({ kv: off.kv, storage });
      await store.migrateAll();
      expect(storage.getItem(worldSaveKey("w1"))).not.toBeNull();
    });
  });
});
