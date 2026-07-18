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

  // The race: the room left `rooms` before its shutdown persisted, so a join in
  // that window took the load path, read the PRE-shutdown blob, and built a
  // second Room for one world. Both then wrote the same row through an UPDATE
  // with no version guard — last write wins, and the eviction's is usually the
  // older one, so the evicted room's final state silently lost.
  test("a join during an eviction waits for it rather than loading a rival room from stale state", async () => {
    let clock = 0;
    const persistence = createMemoryPersistence();
    const registry = new RoomRegistry(persistence, 4, () => clock);

    const original = await registry.getOrLoad("w-evict");
    expect(original).not.toBeNull();

    // Sit empty past the idle window, then evict — with the final store held open.
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
    expect(storeStarted).toBe(true); // mid-shutdown: out of `rooms`, still writing

    // A join lands right here. It must not read the row this shutdown is about
    // to overwrite.
    let joined: Awaited<ReturnType<RoomRegistry["getOrLoad"]>> | "pending" = "pending";
    const join = registry.getOrLoad("w-evict").then((room) => (joined = room));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(joined).toBe("pending"); // held until the eviction's write lands

    releaseStore!();
    await sweep;
    await join;

    expect(joined).not.toBeNull();
    expect(joined).not.toBe(original!); // a genuinely fresh room, loaded after the write
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

  test("shutdownAll refuses new loads and awaits an in-flight eviction", async () => {
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
