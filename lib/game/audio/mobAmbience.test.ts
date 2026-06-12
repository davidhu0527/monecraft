import { describe, expect, test } from "bun:test";
import type { MobKind } from "@/lib/game/types";
import { createMobAmbienceScheduler, MOB_EARSHOT, type AmbientCall, type AmbientMob } from "./mobAmbience";

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function mob(id: number, kind: MobKind, x: number, z: number): AmbientMob {
  return { id, kind, x, z };
}

/** Runs the scheduler for `seconds` at 20 Hz and collects every emitted call. */
function collect(mobs: AmbientMob[], seconds: number, yaw = 0, seed = 1): AmbientCall[] {
  const scheduler = createMobAmbienceScheduler(mulberry32(seed));
  const out: AmbientCall[] = [];
  const dt = 0.05;
  for (let t = 0; t < seconds; t += dt) out.push(...scheduler.tick(dt, mobs, 0, 0, yaw));
  return out;
}

describe("mob ambience scheduler", () => {
  test("a nearby mob calls repeatedly, at randomized intervals", () => {
    const calls = collect([mob(1, "sheep", 4, 0)], 60);
    // Sheep call every 6–14 s → roughly 4–9 calls in a minute.
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.length).toBeLessThanOrEqual(10);
    expect(calls.every((call) => call.kind === "sheep")).toBe(true);
  });

  test("mobs outside earshot stay silent", () => {
    expect(collect([mob(1, "zombie", MOB_EARSHOT + 1, 0)], 60).length).toBe(0);
  });

  test("closer mobs are louder", () => {
    const near = collect([mob(1, "zombie", 3, 0)], 30);
    const far = collect([mob(1, "zombie", 20, 0)], 30);
    expect(near.length).toBeGreaterThan(0);
    expect(far.length).toBeGreaterThan(0);
    expect(near[0].gain).toBeGreaterThan(far[0].gain);
    for (const call of [...near, ...far]) {
      expect(call.gain).toBeGreaterThan(0);
      expect(call.gain).toBeLessThanOrEqual(1);
    }
  });

  test("pan follows the look direction", () => {
    // Yaw 0 looks down -Z; a mob at +X is to the player's right.
    const right = collect([mob(1, "chicken", 6, 0)], 30);
    expect(right[0].pan).toBeGreaterThan(0.9);
    // Turn 180°: the same mob is now on the left.
    const behind = collect([mob(1, "chicken", 6, 0)], 30, Math.PI);
    expect(behind[0].pan).toBeLessThan(-0.9);
  });

  test("a despawned mob's timer does not leak into a replacement", () => {
    const scheduler = createMobAmbienceScheduler(mulberry32(7));
    const herd = Array.from({ length: 12 }, (_, i) => mob(i + 1, "sheep", 5, 0));
    for (let t = 0; t < 3; t += 0.05) scheduler.tick(0.05, herd, 0, 0, 0);
    // Replace the herd with one fresh mob: the sweep clears stale timers and
    // the newcomer starts a full interval (no call on its first tick).
    const fresh = [mob(99, "zombie", 5, 0)];
    expect(scheduler.tick(0.05, fresh, 0, 0, 0).length).toBe(0);
  });
});
