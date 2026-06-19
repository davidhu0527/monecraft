import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { createCaughtItemVisuals } from "@/lib/game/render/caughtItemVisuals";

const TARGET = new THREE.Vector3(0, 2, 0);
const meshOf = (scene: THREE.Scene) => scene.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh;

describe("caughtItemVisuals", () => {
  test("spawns a sprite on a catch and removes it after the flight", () => {
    const scene = new THREE.Scene();
    const v = createCaughtItemVisuals(scene);
    v.spawn("raw_fish", 5, 1, 5);

    v.sync(0, TARGET); // first sync latches the start time, k=0
    expect(scene.children).toHaveLength(1);

    v.sync(200, TARGET); // mid-flight (FLIGHT_S 0.4s)
    expect(scene.children).toHaveLength(1);

    v.sync(1000, TARGET); // past the flight → removed
    expect(scene.children).toHaveLength(0);
    v.dispose();
  });

  test("the catch travels from the bobber toward the player", () => {
    const scene = new THREE.Scene();
    const v = createCaughtItemVisuals(scene);
    v.spawn("raw_fish", 5, 1, 5);
    v.sync(0, TARGET);
    const start = meshOf(scene).position.clone();
    v.sync(200, TARGET);
    const mid = meshOf(scene).position;
    // Closer to the target (origin-ish) on x/z than where it started.
    expect(Math.abs(mid.x - TARGET.x)).toBeLessThan(Math.abs(start.x - TARGET.x));
    expect(Math.abs(mid.z - TARGET.z)).toBeLessThan(Math.abs(start.z - TARGET.z));
    v.dispose();
  });

  test("dispose clears any in-flight catches", () => {
    const scene = new THREE.Scene();
    const v = createCaughtItemVisuals(scene);
    v.spawn("emerald", 3, 1, 3);
    v.sync(0, TARGET);
    expect(scene.children).toHaveLength(1);
    v.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
