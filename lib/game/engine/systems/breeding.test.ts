import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { BABY_SCALE, BREED_CHECK_INTERVAL_SECONDS, BREED_FED_WINDOW_SECONDS, PASSIVE_CAP } from "@/lib/game/config";
import { mobHalfHeight } from "@/lib/game/mobs";
import { createTimers, type GameEvent, type GameState, type MobState } from "@/lib/game/engine/state";
import { tickBreeding } from "@/lib/game/engine/systems/breeding";

function makeSheep(id: number, x: number, z: number, fedTimer = 0, ageTimer = 0): MobState {
  return {
    id,
    kind: "sheep",
    hostile: false,
    hp: 10,
    position: new THREE.Vector3(x, 50, z),
    direction: new THREE.Vector3(1, 0, 0),
    yaw: 0,
    turnTimer: 1,
    speed: 0.9,
    moveSpeed: 0.9,
    detectRange: 0,
    attackDamage: 0,
    attackCooldown: 0,
    attackTimer: 0,
    halfHeight: mobHalfHeight("sheep"),
    bobSeed: 0,
    fedTimer,
    ageTimer
  };
}

function makeState(mobs: MobState[]): GameState {
  return { mobs, nextMobId: 1000, timers: createTimers() } as unknown as GameState;
}

const surfaceYAt = () => 49;
const rng = () => 0.7;

describe("breeding", () => {
  test("two fed adults nearby produce one baby and clear their love timers", () => {
    const a = makeSheep(1, 0, 0, BREED_FED_WINDOW_SECONDS);
    const b = makeSheep(2, 1, 0, BREED_FED_WINDOW_SECONDS); // distance 1 < radius 3
    const state = makeState([a, b]);
    const events: GameEvent[] = [];
    tickBreeding(state, BREED_CHECK_INTERVAL_SECONDS, rng, surfaceYAt, (e) => events.push(e));

    expect(state.mobs).toHaveLength(3);
    const baby = state.mobs[2];
    expect(baby.kind).toBe("sheep");
    expect(baby.ageTimer).toBeGreaterThan(0);
    expect(baby.halfHeight).toBeCloseTo(mobHalfHeight("sheep") * BABY_SCALE, 5);
    expect(a.fedTimer).toBe(0);
    expect(b.fedTimer).toBe(0);
    expect(events.some((e) => e.type === "mobBred" && e.kind === "sheep")).toBe(true);
  });

  test("far-apart fed adults do not breed", () => {
    const a = makeSheep(1, 0, 0, BREED_FED_WINDOW_SECONDS);
    const b = makeSheep(2, 10, 0, BREED_FED_WINDOW_SECONDS); // beyond radius
    const state = makeState([a, b]);
    tickBreeding(state, BREED_CHECK_INTERVAL_SECONDS, rng, surfaceYAt, () => {});
    expect(state.mobs).toHaveLength(2);
  });

  test("breeding stops at the passive cap", () => {
    const mobs = Array.from({ length: PASSIVE_CAP }, (_, i) => makeSheep(i, i * 0.1, 0, BREED_FED_WINDOW_SECONDS));
    const state = makeState(mobs);
    tickBreeding(state, BREED_CHECK_INTERVAL_SECONDS, rng, surfaceYAt, () => {});
    expect(state.mobs).toHaveLength(PASSIVE_CAP); // no new baby past the cap
  });

  test("a baby grows up and regains full size", () => {
    const baby = makeSheep(1, 0, 0);
    baby.ageTimer = 0.3;
    baby.halfHeight = mobHalfHeight("sheep") * BABY_SCALE;
    const state = makeState([baby]);
    tickBreeding(state, 0.5, rng, surfaceYAt, () => {}); // dt past the remaining age
    expect(baby.ageTimer).toBe(0);
    expect(baby.halfHeight).toBeCloseTo(mobHalfHeight("sheep"), 5);
  });

  test("an unfed pair does not breed", () => {
    const a = makeSheep(1, 0, 0); // fedTimer 0
    const b = makeSheep(2, 1, 0);
    const state = makeState([a, b]);
    tickBreeding(state, BREED_CHECK_INTERVAL_SECONDS, rng, surfaceYAt, () => {});
    expect(state.mobs).toHaveLength(2);
  });

  test("new passive kinds (cow) breed through the same generic path", () => {
    const cow = (id: number, x: number): MobState => ({ ...makeSheep(id, x, 0, BREED_FED_WINDOW_SECONDS), kind: "cow", halfHeight: mobHalfHeight("cow") });
    const state = makeState([cow(1, 0), cow(2, 1)]);
    const events: GameEvent[] = [];
    tickBreeding(state, BREED_CHECK_INTERVAL_SECONDS, rng, surfaceYAt, (e) => events.push(e));
    expect(state.mobs).toHaveLength(3);
    expect(state.mobs[2].kind).toBe("cow");
    expect(state.mobs[2].halfHeight).toBeCloseTo(mobHalfHeight("cow") * BABY_SCALE, 5);
    expect(events.some((e) => e.type === "mobBred" && e.kind === "cow")).toBe(true);
  });
});
