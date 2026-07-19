import { describe, expect, test } from "bun:test";
import { createCloudPushQueue } from "./cloudPushQueue";
import type { PushResult } from "./cloudSaves";
import type { SaveData } from "@/lib/game/types";

/**
 * The queue exists because six call sites push and several fire together —
 * backgrounding a phone raises visibilitychange AND pagehide. Every test here
 * is about what happens when they overlap.
 */

const save = (seed: number) => ({ version: 18, seed, changes: [], players: [] }) as unknown as SaveData;

/** A push we resolve by hand, so overlap is deterministic rather than timed. */
function controllablePush() {
  const calls: SaveData[] = [];
  const resolvers: Array<(r: PushResult) => void> = [];
  const push = (s: SaveData): Promise<PushResult> => {
    calls.push(s);
    return new Promise<PushResult>((resolve) => resolvers.push(resolve));
  };
  return { calls, resolvers, push };
}

const noop = () => {};
const never = () => false;

describe("createCloudPushQueue", () => {
  test("a push while one is in flight waits rather than racing it", async () => {
    const { calls, resolvers, push } = controllablePush();
    const queue = createCloudPushQueue({ push, onConflict: noop, stopped: never });

    queue.enqueue(save(1), false);
    queue.enqueue(save(2), false);
    // The bug: both would have been in flight at once, with the same base
    // revision — the server takes one and 409s the other.
    expect(calls).toHaveLength(1);
    expect(calls[0].seed).toBe(1);

    resolvers[0]("saved");
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toHaveLength(2);
    expect(calls[1].seed).toBe(2);
  });

  test("snapshots coalesce latest-wins — superseded ones are never sent", async () => {
    const { calls, resolvers, push } = controllablePush();
    const queue = createCloudPushQueue({ push, onConflict: noop, stopped: never });

    queue.enqueue(save(1), false);
    queue.enqueue(save(2), false);
    queue.enqueue(save(3), false);
    queue.enqueue(save(4), false); // all describe the same world; only the newest matters

    resolvers[0]("saved");
    await Promise.resolve();
    await Promise.resolve();
    expect(calls.map((c) => c.seed)).toEqual([1, 4]); // 2 and 3 dropped, not queued up

    resolvers[1]("saved");
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toHaveLength(2);
    expect(queue.idle()).toBe(true);
  });

  test("a coalesced snapshot's notify flag survives being superseded", async () => {
    const { resolvers, push } = controllablePush();
    const notified: boolean[] = [];
    const queue = createCloudPushQueue({ push, onConflict: (n) => void notified.push(n), stopped: never });

    queue.enqueue(save(1), false);
    queue.enqueue(save(2), true); // wants to warn...
    queue.enqueue(save(3), false); // ...and is then superseded by one that doesn't

    resolvers[0]("saved");
    await Promise.resolve();
    await Promise.resolve();
    resolvers[1]("conflict");
    await Promise.resolve();
    await Promise.resolve();
    // Dropping a snapshot must not silently drop its warning.
    expect(notified).toEqual([true]);
  });

  test("a conflict reports once and stops draining", async () => {
    const { calls, resolvers, push } = controllablePush();
    let conflicts = 0;
    let latched = false;
    const queue = createCloudPushQueue({
      push,
      onConflict: () => {
        conflicts += 1;
        latched = true;
      },
      stopped: () => latched
    });

    queue.enqueue(save(1), true);
    queue.enqueue(save(2), true);
    resolvers[0]("conflict");
    await Promise.resolve();
    await Promise.resolve();

    expect(conflicts).toBe(1);
    expect(calls).toHaveLength(1); // the queued snapshot is abandoned, not clobbering the winner
    queue.enqueue(save(3), true);
    expect(calls).toHaveLength(1); // and nothing new is accepted
  });

  test("an error doesn't wedge the queue — the next save retries", async () => {
    const { calls, resolvers, push } = controllablePush();
    const queue = createCloudPushQueue({ push, onConflict: noop, stopped: never });

    queue.enqueue(save(1), false);
    resolvers[0]("error");
    await Promise.resolve();
    await Promise.resolve();
    expect(queue.idle()).toBe(true);

    queue.enqueue(save(2), false);
    expect(calls).toHaveLength(2);
  });
});
