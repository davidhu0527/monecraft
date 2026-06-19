import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { createBobberVisuals } from "@/lib/game/render/bobberVisuals";

describe("bobberVisuals", () => {
  test("shows the bobber + line while fishing and clears them when not", () => {
    const scene = new THREE.Scene();
    const visuals = createBobberVisuals(scene);
    const eye = new THREE.Vector3(0, 2, 0);

    visuals.sync({ position: new THREE.Vector3(3, 1, 3), timer: 2, biting: false }, eye);
    expect(scene.children).toHaveLength(2); // bobber mesh + line

    visuals.sync(null, eye); // reeled in
    expect(scene.children).toHaveLength(0);

    visuals.dispose();
    expect(scene.children).toHaveLength(0);
  });

  test("positions the bobber at the cast point", () => {
    const scene = new THREE.Scene();
    const visuals = createBobberVisuals(scene);
    visuals.sync({ position: new THREE.Vector3(5, 7, 9), timer: 1, biting: false }, new THREE.Vector3(0, 2, 0));
    const bobber = scene.children.find((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh;
    expect(bobber.position.x).toBe(5);
    expect(bobber.position.z).toBe(9);
    visuals.dispose();
  });
});
