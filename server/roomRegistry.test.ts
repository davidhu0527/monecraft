import { describe, expect, test } from "bun:test";
import { createMemoryPersistence } from "./persistence";
import { RoomRegistry } from "./roomRegistry";

/**
 * The registry's lifecycle seams. Room construction runs real worldgen (a
 * couple of seconds), so these lean on a small number of rooms.
 */

const IDLE_EVICT_MS = 5 * 60 * 1000;

describe("RoomRegistry", () => {
  test("getOrLoad returns the same room, and collapses concurrent loads into one", async () => {
    const registry = new RoomRegistry(createMemoryPersistence(), 4, () => 0);
    const [a, b] = await Promise.all([registry.getOrLoad("w1"), registry.getOrLoad("w1")]);
    expect(a).toBe(b!);
    await registry.shutdownAll();
  }, 120_000);

  test("an unknown world and an over-capacity load both refuse", async () => {
    const registry = new RoomRegistry(createMemoryPersistence(), 1, () => 0);
    expect(await registry.getOrLoad("w1")).not.toBeNull();
    expect(await registry.getOrLoad("w2")).toBeNull(); // at capacity
    await registry.shutdownAll();
  }, 120_000);

  // Eviction persists BEFORE removing the room, so the room stays in `rooms`
  // throughout its final write. A join landing mid-persist gets that exact live
  // instance — never a second room loaded from a blob that's mid-write.
  test("a join during an eviction's persist gets the live room, never a stale rival", async () => {
    let clock = 0;
    const persistence = createMemoryPersistence();
    const registry = new RoomRegistry(persistence, 4, () => clock);

    const original = await registry.getOrLoad("w-evict");
    expect(original).not.toBeNull();

    clock = IDLE_EVICT_MS + 1;
    let storeStarted = false;
    let releaseStore: (() => void) | null = null;
    const inner = persistence.storeWorld.bind(persistence);
    persistence.storeWorld = async (id, blob, version) => {
      persistence.storeWorld = inner; // one-shot: hold only the eviction's write
      storeStarted = true;
      await new Promise<void>((resolve) => (releaseStore = resolve));
      return inner(id, blob, version);
    };

    const sweep = registry.sweepIdle();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(storeStarted).toBe(true); // persisting — but the room is STILL registered

    // A join lands mid-persist: it gets the live room immediately, no wait.
    const joined = await registry.getOrLoad("w-evict");
    expect(joined).toBe(original); // the live room, not a rival loaded from a mid-write blob

    releaseStore!();
    await sweep;
    await registry.shutdownAll();
  }, 120_000);

  // The finding-2 fix: a failed eviction persist used to be swallowed and the
  // room removed anyway, so a waiting join loaded the stale (never-written) DB
  // blob into a rival room. Now a failed persist keeps the room live/retryable.
  test("a failed eviction persist keeps the room live and joinable — no stale reload", async () => {
    let clock = 0;
    const persistence = createMemoryPersistence();
    const registry = new RoomRegistry(persistence, 4, () => clock);
    const original = await registry.getOrLoad("w-fail");
    expect(original).not.toBeNull();

    clock = IDLE_EVICT_MS + 1;
    const inner = persistence.storeWorld.bind(persistence);
    persistence.storeWorld = async () => {
      persistence.storeWorld = inner; // one-shot: only the eviction's write fails
      throw new Error("db down");
    };

    await registry.sweepIdle(); // persist throws → the room must NOT be evicted

    // The world is still served by the LIVE room (its in-memory final state),
    // never reloaded from the stale blob.
    expect(registry.getExisting("w-fail")).toBe(original);
    expect(await registry.getOrLoad("w-fail")).toBe(original);
    await registry.shutdownAll();
  }, 120_000);

  // shutdownAll used to await only rooms already in `rooms`. A load still in
  // flight (not yet registered) would resolve after the drain and never be shut
  // down — its state unpersisted at process exit.
  test("shutdownAll drains a load that is still in flight", async () => {
    const persistence = createMemoryPersistence();
    let releaseLoad: (() => void) | null = null;
    const inner = persistence.loadWorld.bind(persistence);
    persistence.loadWorld = async (id) => {
      persistence.loadWorld = inner; // one-shot
      await new Promise<void>((resolve) => (releaseLoad = resolve));
      return inner(id);
    };
    const registry = new RoomRegistry(persistence, 4, () => 0);

    const loadPromise = registry.getOrLoad("w-load"); // suspended in loadWorld
    await new Promise((resolve) => setTimeout(resolve, 20));

    let shutdownDone = false;
    const shutdown = registry.shutdownAll().then(() => (shutdownDone = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(shutdownDone).toBe(false); // must wait for the in-flight load

    releaseLoad!();
    await loadPromise;
    await shutdown;
    expect(shutdownDone).toBe(true);
    // The room the load produced was shut down (persisted) — it's gone from the registry.
    expect(registry.getExisting("w-load")).toBeNull();
  }, 120_000);

  test("shutdownAll refuses new loads and shuts down a room whose eviction persist is in flight", async () => {
    let clock = 0;
    const persistence = createMemoryPersistence();
    const registry = new RoomRegistry(persistence, 4, () => clock);
    await registry.getOrLoad("w-ev");

    clock = IDLE_EVICT_MS + 1;
    let releaseStore: (() => void) | null = null;
    const inner = persistence.storeWorld.bind(persistence);
    persistence.storeWorld = async (id, blob, version) => {
      persistence.storeWorld = inner;
      await new Promise<void>((resolve) => (releaseStore = resolve));
      return inner(id, blob, version);
    };
    const sweep = registry.sweepIdle(); // starts the eviction's held persist
    await new Promise((resolve) => setTimeout(resolve, 20));

    let shutdownDone = false;
    const shutdown = registry.shutdownAll().then(() => (shutdownDone = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(shutdownDone).toBe(false); // waits for the eviction persist
    expect(await registry.getOrLoad("w-new")).toBeNull(); // no new loads once shutting down

    releaseStore!();
    await sweep;
    await shutdown;
    expect(shutdownDone).toBe(true);
  }, 120_000);
});
