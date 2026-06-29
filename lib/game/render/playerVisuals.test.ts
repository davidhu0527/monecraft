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

  test("shows every shell of a worn armor piece and hides the rest", () => {
    const scene = new THREE.Scene();
    const visuals = createPlayerVisuals(scene);
    // Collect ALL shells for a slot — multi-part slots (chestplate = torso + 2 shoulders)
    // must toggle together, so a single-mesh check could miss a shell drifting out of sync.
    const meshesFor = (slot: string) => {
      const out: THREE.Mesh[] = [];
      bodyGroup(scene).traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.name === `armor-${slot}`) out.push(obj);
      });
      return out;
    };
    const allHidden = (slot: string) => meshesFor(slot).every((m) => !m.visible);
    const allShown = (slot: string) => meshesFor(slot).length > 0 && meshesFor(slot).every((m) => m.visible);

    // Nothing worn → all armor shells hidden.
    visuals.sync(makeState(), 0);
    expect(allHidden("helmet")).toBe(true);
    expect(allHidden("chestplate")).toBe(true);

    // Wearing the (multi-part) chestplate shows every one of its shells, helmet stays hidden.
    visuals.sync(makeState({ equippedArmor: { ...createEmptyArmorEquipment(), chestplate: createSlot("chestplate", 1) } }), 16);
    expect(meshesFor("chestplate").length).toBeGreaterThan(1);
    expect(allShown("chestplate")).toBe(true);
    expect(allHidden("helmet")).toBe(true);

    // Unequipping hides them again.
    visuals.sync(makeState(), 32);
    expect(allHidden("chestplate")).toBe(true);
    visuals.dispose();
  });

  test("dispose removes the body from the scene", () => {
    const scene = new THREE.Scene();
    const visuals = createPlayerVisuals(scene);
    visuals.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
