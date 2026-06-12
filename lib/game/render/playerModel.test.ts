import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { createPlayerModel } from "@/lib/game/render/playerModel";

describe("createPlayerModel", () => {
  test("builds a humanoid with pivoting limbs and a neck pivot", () => {
    const model = createPlayerModel();
    for (const limb of [model.head, model.leftArm, model.rightArm, model.leftLeg, model.rightLeg]) {
      expect(limb).toBeInstanceOf(THREE.Group);
      expect(limb.parent).toBe(model.group);
    }
    // Pivots sit at the joints, not the limb centers.
    expect(model.leftLeg.position.y).toBeCloseTo(0.72);
    expect(model.leftArm.position.y).toBeCloseTo(1.26);
    expect(model.head.position.y).toBeCloseTo(1.32);
  });

  test("the face is on the -Z side, matching the yaw-forward convention", () => {
    const model = createPlayerModel();
    const eyes = model.head.children.filter((child) => (child as THREE.Mesh).position.z < -0.1);
    expect(eyes.length).toBeGreaterThanOrEqual(2);
  });

  test("the item holder hangs from the right arm", () => {
    const model = createPlayerModel();
    expect(model.itemHolder.parent).toBe(model.rightArm);
    expect(model.itemHolder.position.y).toBeLessThan(-0.5);
  });

  test("tracks every material and geometry for disposal", () => {
    const model = createPlayerModel();
    const meshes: THREE.Mesh[] = [];
    model.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) meshes.push(obj);
    });
    expect(meshes.length).toBeGreaterThanOrEqual(10);
    for (const mesh of meshes) {
      expect(model.geometries).toContain(mesh.geometry);
      expect(model.materials).toContain(mesh.material as THREE.Material);
    }
  });
});
