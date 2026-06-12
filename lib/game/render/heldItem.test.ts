import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { createHeldItemView, type HeldItemFrame } from "@/lib/game/render/heldItem";
import { BASE_POSE, SWING_MS } from "@/lib/game/render/heldItemPose";
import { createEmptySlot, createSlot } from "@/lib/game/items";

function heldHolder(camera: THREE.Camera): THREE.Group {
  const root = camera.children[0] as THREE.Group;
  return root.children[0] as THREE.Group;
}

function frame(timeMs = 0, overrides: Partial<HeldItemFrame> = {}): HeldItemFrame {
  return { timeMs, miningActive: false, moveFactor: 0, ...overrides };
}

describe("heldItem", () => {
  test("builds a model for block, tool, and weapon slots", () => {
    const camera = new THREE.PerspectiveCamera();
    const view = createHeldItemView(camera);
    const holder = heldHolder(camera);

    view.update(createSlot("dirt", 5), frame());
    expect(holder.children).toHaveLength(1);

    view.update(createSlot("wood_pickaxe", 1), frame());
    expect(holder.children).toHaveLength(1);
    const tool = holder.children[0] as THREE.Mesh;
    expect((tool.material as THREE.MeshStandardMaterial).vertexColors).toBe(true);
    expect(tool.geometry.getAttribute("position").count).toBeGreaterThan(0);

    view.update(createSlot("knife", 1), frame());
    expect(holder.children).toHaveLength(1);
    view.dispose();
  });

  test("keeps the same model while the item id is unchanged, swaps when it changes", () => {
    const camera = new THREE.PerspectiveCamera();
    const view = createHeldItemView(camera);
    const holder = heldHolder(camera);

    view.update(createSlot("dirt", 5), frame());
    const mesh = holder.children[0];
    view.update(createSlot("dirt", 3), frame()); // count changed, same item
    expect(holder.children[0]).toBe(mesh);

    view.update(createSlot("stone", 3), frame());
    expect(holder.children[0]).not.toBe(mesh);
    view.dispose();
  });

  test("clears on empty or exhausted slots and on dispose", () => {
    const camera = new THREE.PerspectiveCamera();
    const view = createHeldItemView(camera);
    const holder = heldHolder(camera);

    view.update(createSlot("dirt", 5), frame());
    view.update(createEmptySlot(), frame());
    expect(holder.children).toHaveLength(0);

    view.update(createSlot("dirt", 5), frame());
    view.update(undefined, frame());
    expect(holder.children).toHaveLength(0);

    view.update(createSlot("dirt", 5), frame());
    view.dispose();
    expect(camera.children).toHaveLength(0); // root removed from the camera
  });

  test("rests at the base pose once equip settles", () => {
    const camera = new THREE.PerspectiveCamera();
    const view = createHeldItemView(camera);
    const holder = heldHolder(camera);

    view.update(createSlot("knife", 1), frame(-1000)); // equip starts well in the past
    view.update(createSlot("knife", 1), frame(0)); // timeMs 0: idle sway sine terms are zero
    expect(holder.position.x).toBeCloseTo(BASE_POSE.posX);
    expect(holder.position.y).toBeCloseTo(BASE_POSE.posY);
    expect(holder.rotation.x).toBeCloseTo(BASE_POSE.rotX);
    view.dispose();
  });

  test("triggerSwing animates the holder and returns to base", () => {
    const camera = new THREE.PerspectiveCamera();
    const view = createHeldItemView(camera);
    const holder = heldHolder(camera);
    const slot = createSlot("knife", 1);

    view.update(slot, frame(-1000));
    view.triggerSwing();
    view.update(slot, frame(0)); // swing latches at timeMs 0
    view.update(slot, frame(SWING_MS / 2));
    expect(holder.rotation.x).toBeLessThan(BASE_POSE.rotX - 0.5);

    view.update(slot, frame(SWING_MS * 2));
    expect(holder.rotation.x).toBeGreaterThan(BASE_POSE.rotX - 0.1);
    view.dispose();
  });

  test("mining keeps the swing looping across cycles", () => {
    const camera = new THREE.PerspectiveCamera();
    const view = createHeldItemView(camera);
    const holder = heldHolder(camera);
    const slot = createSlot("wood_pickaxe", 1);

    view.update(slot, frame(-1000));
    view.update(slot, frame(0, { miningActive: true })); // rising edge starts the loop
    view.update(slot, frame(SWING_MS * 1.5, { miningActive: true })); // mid-arc of a later cycle
    expect(holder.rotation.x).toBeLessThan(BASE_POSE.rotX - 0.5);
    view.dispose();
  });

  test("switching items mid-swing does not carry the swing to the new item", () => {
    const camera = new THREE.PerspectiveCamera();
    const view = createHeldItemView(camera);
    const holder = heldHolder(camera);

    view.update(createSlot("knife", 1), frame(-1000));
    view.triggerSwing();
    view.update(createSlot("knife", 1), frame(0));
    view.update(createSlot("wood_pickaxe", 1), frame(SWING_MS / 2)); // switch mid-swing
    // The swing arc pushes posZ forward; equip and idle sway never touch it.
    expect(holder.position.z).toBeCloseTo(BASE_POSE.posZ);
    view.dispose();
  });

  test("switching items while mining does not carry the swing to the new item", () => {
    const camera = new THREE.PerspectiveCamera();
    const view = createHeldItemView(camera);
    const holder = heldHolder(camera);

    view.update(createSlot("wood_pickaxe", 1), frame(-1000));
    view.update(createSlot("wood_pickaxe", 1), frame(0, { miningActive: true }));
    view.update(createSlot("knife", 1), frame(SWING_MS / 2)); // mining stopped by the switch
    expect(holder.position.z).toBeCloseTo(BASE_POSE.posZ);
    view.dispose();
  });

  test("equip dips the item after an item switch", () => {
    const camera = new THREE.PerspectiveCamera();
    const view = createHeldItemView(camera);
    const holder = heldHolder(camera);

    view.update(createSlot("dirt", 5), frame(-1000));
    view.update(createSlot("knife", 1), frame(0)); // switch: equip starts now
    expect(holder.position.y).toBeCloseTo(BASE_POSE.posY - 0.4);
    view.dispose();
  });
});
