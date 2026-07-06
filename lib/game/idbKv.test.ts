import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createIdbKv } from "@/lib/game/idbKv";

// Each test gets its own fake-indexeddb factory (injected, never global) so
// suites stay isolated and the happy-dom environment is untouched.
const freshKv = () => createIdbKv("test-db", "test-store", new IDBFactory());

describe("idbKv", () => {
  test("put/get/delete round-trip preserves nested structures", async () => {
    const kv = freshKv();
    const value = {
      version: 17,
      seed: 1337,
      changes: [
        [42, 0],
        [99, 3]
      ],
      players: [{ id: "local", position: { x: 1.5, y: 2, z: -3 } }]
    };
    await kv.put("world-1", value);
    expect(await kv.get("world-1")).toEqual(value);
    await kv.delete("world-1");
    expect(await kv.get("world-1")).toBeUndefined();
  });

  test("get of a missing key resolves undefined", async () => {
    expect(await freshKv().get("nope")).toBeUndefined();
  });

  test("overwriting a key keeps the newest value", async () => {
    const kv = freshKv();
    await kv.put("k", { n: 1 });
    await kv.put("k", { n: 2 });
    expect(await kv.get("k")).toEqual({ n: 2 });
  });

  test("ready() is false and ops reject when the factory is broken", async () => {
    const broken = {
      open() {
        throw new Error("privacy mode says no");
      }
    } as unknown as IDBFactory;
    const kv = createIdbKv("test-db", "test-store", broken);
    expect(await kv.ready()).toBe(false);
    expect(kv.get("k")).rejects.toThrow("IndexedDB unavailable");
  });

  test("ready() is false when no factory exists at all", async () => {
    // bun test has no global indexedDB (happy-dom does not provide one), so
    // the no-injection path exercises the missing-global branch.
    const kv = createIdbKv("test-db", "test-store");
    expect(await kv.ready()).toBe(false);
  });

  test("tryPutSync is false before the connection opens, true after, and the value lands", async () => {
    const kv = freshKv();
    expect(kv.tryPutSync("k", { n: 1 })).toBe(false);
    await kv.get("warm-up"); // any op opens and caches the connection
    expect(kv.tryPutSync("k", { n: 2 })).toBe(true);
    // A readonly tx created after the readwrite tx queues behind it, so this
    // observes the committed put — the same ordering the unload flush relies on.
    expect(await kv.get("k")).toEqual({ n: 2 });
  });
});
