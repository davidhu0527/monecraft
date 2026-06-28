import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { createPlayerVisuals, type PlayerVisualsState } from "@/lib/game/render/playerVisuals";
import { createEmptyArmorEquipment, createEmptySlot, createSlot } from "@/lib/game/items";
import { getSkinPreset } from "@/lib/game/playerSkins";

function makeState(overrides: Partial<PlayerVisualsState> = {}): PlayerVisualsState {
  return {
    cameraMode: "third-rear",
    gameMode: "survival",
    isDead: false,
    player: {
      position: new THREE.Vector3(10, 20, 30),
      velocity: new THREE.Vector3(),
      yaw: 0.7,
      pitch: -0.2,
      onGround: true
    },
    inventory: [createSlot("dirt", 5)],
    equippedArmor: createEmptyArmorEquipment(),
    selectedSlot: 0,
    mining: { targetKey: "" },
    fishing: null,
    ...overrides
  };
}

function bodyGroup(scene: THREE.Scene): THREE.Group {
  return scene.children[0] as THREE.Group;
}

describe("playerVisuals", () => {
  test("hidden in first person, visible in both third-person modes", () => {
    const scene = new THREE.Scene();
    const visuals = createPlayerVisuals(scene);
    const group = bodyGroup(scene);

    visuals.sync(makeState({ cameraMode: "first" }), 0);
    expect(group.visible).toBe(false);
    visuals.sync(makeState({ cameraMode: "third-rear" }), 0);
    expect(group.visible).toBe(true);
    visuals.sync(makeState({ cameraMode: "third-front" }), 0);
    expect(group.visible).toBe(true);
    visuals.dispose();
  });

  test("hidden while dead so the corpse never floats behind the death screen", () => {
    const scene = new THREE.Scene();
    const visuals = createPlayerVisuals(scene);
    visuals.sync(makeState({ isDead: true }), 0);
    expect(bodyGroup(scene).visible).toBe(false);
    visuals.dispose();
  });

  test("follows the player's feet position and yaw, pitch only tilts the head", () => {
    const scene = new THREE.Scene();
    const visuals = createPlayerVisuals(scene);
    const state = makeState();
    visuals.sync(state, 0);

    const group = bodyGroup(scene);
    expect(group.position.toArray()).toEqual([10, 20, 30]);
    expect(group.rotation.y).toBeCloseTo(0.7);
    expect(group.rotation.x).toBe(0);
    const head = group.getObjectByName("head")!;
    expect(head.rotation.x).toBeCloseTo(-0.2);
    visuals.dispose();
  });

  test("rebuilds the hand item when the selected slot changes", () => {
    const scene = new THREE.Scene();
    const visuals = createPlayerVisuals(scene);

    const holderChildren = () => bodyGroup(scene).getObjectByName("itemHolder")!.children.length;

    visuals.sync(makeState({ inventory: [createSlot("dirt", 5)] }), 0);
    expect(holderChildren()).toBe(1);
    visuals.sync(makeState({ inventory: [createSlot("wood_pickaxe", 1)] }), 16);
    expect(holderChildren()).toBe(1);
    visuals.sync(makeState({ inventory: [createEmptySlot()] }), 32);
    expect(holderChildren()).toBe(0);
    visuals.dispose();
  });

  test("a queued swing fires on the next visible sync, not after re-show", () => {
    const scene = new THREE.Scene();
    const visuals = createPlayerVisuals(scene);
    const group = bodyGroup(scene);
    const rightArm = group.getObjectByName("rightArm")!;

    // Swing queued while hidden is dropped.
    visuals.triggerSwing();
    visuals.sync(makeState({ cameraMode: "first" }), 0);
    visuals.sync(makeState(), 130);
    expect(rightArm.rotation.x).toBe(0);

    // Swing queued while visible animates the arm at mid-swing.
    visuals.triggerSwing();
    visuals.sync(makeState(), 1000);
    visuals.sync(makeState(), 1130);
    expect(rightArm.rotation.x).toBeLessThan(-1);
    visuals.dispose();
  });

  test("setPalette recolors the visible body live", () => {
    const scene = new THREE.Scene();
    const visuals = createPlayerVisuals(scene);
    visuals.sync(makeState(), 0);

    const knight = getSkinPreset("knight").palette;
    visuals.setPalette(knight);

    const head = bodyGroup(scene).getObjectByName("head")!;
    const skull = head.children[0] as THREE.Mesh;
    expect((skull.material as THREE.MeshStandardMaterial).color.getHex()).toBe(knight.skin);
    visuals.dispose();
  });

  test("shows a worn armor piece's shells and hides the rest", () => {
    const scene = new THREE.Scene();
    const visuals = createPlayerVisuals(scene);
    const armor = (slot: "helmet" | "chestplate") => bodyGroup(scene).getObjectByName(`armor-${slot}`);

    // Nothing worn → all armor shells hidden (sample helmet + chestplate torso).
    visuals.sync(makeState(), 0);
    expect(armor("helmet")!.visible).toBe(false);
    expect(armor("chestplate")!.visible).toBe(false);

    // Wearing a helmet shows its shell, leaves the chestplate hidden.
    visuals.sync(makeState({ equippedArmor: { ...createEmptyArmorEquipment(), helmet: createSlot("helmet", 1) } }), 16);
    expect(armor("helmet")!.visible).toBe(true);
    expect(armor("chestplate")!.visible).toBe(false);

    // Unequipping hides it again.
    visuals.sync(makeState(), 32);
    expect(armor("helmet")!.visible).toBe(false);
    visuals.dispose();
  });

  test("dispose removes the body from the scene", () => {
    const scene = new THREE.Scene();
    const visuals = createPlayerVisuals(scene);
    visuals.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
