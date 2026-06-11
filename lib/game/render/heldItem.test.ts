import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { createHeldItemView } from "@/lib/game/render/heldItem";
import { createEmptySlot, createSlot } from "@/lib/game/items";

function heldRoot(camera: THREE.Camera): THREE.Group {
  return camera.children[0] as THREE.Group;
}

describe("heldItem", () => {
  test("builds a model for block, tool, and weapon slots", () => {
    const camera = new THREE.PerspectiveCamera();
    const view = createHeldItemView(camera);
    const root = heldRoot(camera);

    view.update(createSlot("dirt", 5));
    expect(root.children).toHaveLength(1);

    view.update(createSlot("wood_pickaxe", 1));
    expect(root.children).toHaveLength(1);
    expect(root.children[0].children.length).toBeGreaterThan(1); // handle + head group

    view.update(createSlot("knife", 1));
    expect(root.children).toHaveLength(1);
    view.dispose();
  });

  test("keeps the same model while the item id is unchanged, swaps when it changes", () => {
    const camera = new THREE.PerspectiveCamera();
    const view = createHeldItemView(camera);
    const root = heldRoot(camera);

    view.update(createSlot("dirt", 5));
    const mesh = root.children[0];
    view.update(createSlot("dirt", 3)); // count changed, same item
    expect(root.children[0]).toBe(mesh);

    view.update(createSlot("stone", 3));
    expect(root.children[0]).not.toBe(mesh);
    view.dispose();
  });

  test("clears on empty or exhausted slots and on dispose", () => {
    const camera = new THREE.PerspectiveCamera();
    const view = createHeldItemView(camera);
    const root = heldRoot(camera);

    view.update(createSlot("dirt", 5));
    view.update(createEmptySlot());
    expect(root.children).toHaveLength(0);

    view.update(createSlot("dirt", 5));
    view.update(undefined);
    expect(root.children).toHaveLength(0);

    view.update(createSlot("dirt", 5));
    view.dispose();
    expect(camera.children).toHaveLength(0); // root removed from the camera
  });
});
