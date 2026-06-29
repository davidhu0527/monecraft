import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { applyPalette, createPlayerModel } from "@/lib/game/render/playerModel";
import { ARMOR_SLOTS } from "@/lib/game/items";
import { getSkinPreset } from "@/lib/game/playerSkins";

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

  test("builds with a given palette on named materials", () => {
    const zombie = getSkinPreset("zombie").palette;
    const model = createPlayerModel(zombie);
    expect(model.paletteMaterials.skin.color.getHex()).toBe(zombie.skin);
    expect(model.paletteMaterials.shirt.color.getHex()).toBe(zombie.shirt);
    expect(model.paletteMaterials.eyeWhite.color.getHex()).toBe(zombie.eyeWhite);
  });

  test("applyPalette recolors the same material instances without allocating", () => {
    const model = createPlayerModel();
    const skinMat = model.paletteMaterials.skin;
    const materialCount = model.materials.length;

    const robot = getSkinPreset("robot").palette;
    applyPalette(model, robot);

    expect(model.paletteMaterials.skin).toBe(skinMat);
    expect(skinMat.color.getHex()).toBe(robot.skin);
    expect(model.paletteMaterials.eyeWhite.color.getHex()).toBe(robot.eyeWhite);
    expect(model.materials.length).toBe(materialCount);
  });

  test("palette materials are all tracked for disposal", () => {
    const model = createPlayerModel();
    for (const mat of Object.values(model.paletteMaterials)) {
      expect(model.materials).toContain(mat);
    }
  });

  test("builds armor shells for every slot, hidden until worn and tracked for disposal", () => {
    const model = createPlayerModel();
    for (const slot of ARMOR_SLOTS) {
      expect(model.armor[slot].length).toBeGreaterThan(0);
      for (const mesh of model.armor[slot]) {
        expect(mesh.visible).toBe(false); // shown only when worn (playerVisuals)
        expect(model.geometries).toContain(mesh.geometry);
        expect(model.materials).toContain(mesh.material as THREE.Material);
      }
    }
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
