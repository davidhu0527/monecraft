import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { createMobVisuals } from "@/lib/game/render/mobVisuals";
import { mobHalfHeight } from "@/lib/game/mobs";
import type { MobState } from "@/lib/game/engine/state";

function makeMob(id: number, overrides: Partial<MobState> = {}): MobState {
  return {
    id,
    kind: "sheep",
    hostile: false,
    hp: 10,
    position: new THREE.Vector3(10, 50, 10),
    direction: new THREE.Vector3(1, 0, 0),
    yaw: 0.5,
    turnTimer: 1,
    speed: 0.9,
    moveSpeed: 0.9,
    detectRange: 0,
    attackDamage: 0,
    attackCooldown: 0,
    attackTimer: 0,
    halfHeight: mobHalfHeight("sheep"),
    bobSeed: 1,
    fedTimer: 0,
    ageTimer: 0,
    ...overrides
  };
}

describe("mobVisuals", () => {
  test("creates one model per mob and removes models for despawned mobs", () => {
    const scene = new THREE.Scene();
    const visuals = createMobVisuals(scene);
    const baseChildren = scene.children.length;

    visuals.sync([makeMob(1), makeMob(2, { kind: "zombie" })], 0);
    expect(scene.children.length).toBe(baseChildren + 2);

    visuals.sync([makeMob(2, { kind: "zombie" })], 0); // mob 1 despawned
    expect(scene.children.length).toBe(baseChildren + 1);

    visuals.dispose();
    expect(scene.children.length).toBe(baseChildren);
  });

  test("reuses the same model across frames for the same mob id", () => {
    const scene = new THREE.Scene();
    const visuals = createMobVisuals(scene);

    visuals.sync([makeMob(7)], 0);
    const group = scene.children[scene.children.length - 1];
    visuals.sync([makeMob(7)], 100);
    expect(scene.children[scene.children.length - 1]).toBe(group);
    visuals.dispose();
  });

  test("applies position, yaw, and a time-varying bob offset", () => {
    const scene = new THREE.Scene();
    const visuals = createMobVisuals(scene);
    const mob = makeMob(1, { yaw: 1.25 });

    visuals.sync([mob], 0);
    const group = scene.children[scene.children.length - 1];
    expect(group.position.x).toBe(10);
    expect(group.position.z).toBe(10);
    expect(group.rotation.y).toBe(1.25);
    expect(Math.abs(group.position.y - 50)).toBeLessThanOrEqual(0.04); // bob amplitude

    const y1 = group.position.y;
    visuals.sync([mob], 100); // quarter of the bob period later
    expect(group.position.y).not.toBe(y1);
    visuals.dispose();
  });
});
