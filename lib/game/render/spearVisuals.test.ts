import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { createSpearVisuals } from "@/lib/game/render/spearVisuals";
import type { ThrownSpearState } from "@/lib/game/engine/state";

function spear(id: number, overrides: Partial<ThrownSpearState> = {}): ThrownSpearState {
  return {
    id,
    itemId: "stone_spear",
    position: new THREE.Vector3(1, 2, 3),
    velocity: new THREE.Vector3(0, 0, -10),
    damage: 21,
    age: 0,
    stuckTimer: null,
    ...overrides
  };
}

describe("spearVisuals", () => {
  test("creates, updates, and removes projectile models by id", () => {
    const scene = new THREE.Scene();
    const visuals = createSpearVisuals(scene);
    const baseChildren = scene.children.length;

    visuals.sync([spear(1)]);
    expect(scene.children.length).toBe(baseChildren + 1);
    const model = scene.children[scene.children.length - 1];
    expect(model.position.toArray()).toEqual([1, 2, 3]);

    visuals.sync([spear(1, { position: new THREE.Vector3(4, 5, 6) })]);
    expect(scene.children[scene.children.length - 1]).toBe(model);
    expect(model.position.toArray()).toEqual([4, 5, 6]);

    visuals.sync([]);
    expect(scene.children.length).toBe(baseChildren);
    visuals.dispose();
  });
});
