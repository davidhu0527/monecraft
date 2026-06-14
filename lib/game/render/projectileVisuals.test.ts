import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { createProjectileVisuals } from "@/lib/game/render/projectileVisuals";
import type { ProjectileState } from "@/lib/game/engine/state";

function arrow(id: number, velocity: THREE.Vector3): ProjectileState {
  return { id, position: new THREE.Vector3(0, 10, 0), velocity, yaw: 0, pitch: 0, damage: 9, knockback: 0.5, fromPlayer: true, ttl: 4 };
}

describe("projectileVisuals", () => {
  test("adds and removes meshes to match the projectile list", () => {
    const scene = new THREE.Scene();
    const visuals = createProjectileVisuals(scene);
    const a = arrow(1, new THREE.Vector3(0, 0, -34));
    const b = arrow(2, new THREE.Vector3(34, 0, 0));

    visuals.sync([a, b]);
    expect(scene.children).toHaveLength(2);

    visuals.sync([a]); // b despawned
    expect(scene.children).toHaveLength(1);

    visuals.dispose();
    expect(scene.children).toHaveLength(0);
  });

  test("orients the arrow's long axis along its velocity", () => {
    const scene = new THREE.Scene();
    const visuals = createProjectileVisuals(scene);
    visuals.sync([arrow(1, new THREE.Vector3(0, 0, -34))]); // flying along -z

    const mesh = scene.children[0] as THREE.Mesh;
    const longAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion); // sprite +Y after rotation
    expect(longAxis.z).toBeLessThan(-0.9);

    visuals.dispose();
  });
});
