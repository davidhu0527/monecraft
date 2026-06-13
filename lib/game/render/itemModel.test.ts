import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { buildItemModel } from "@/lib/game/render/itemModel";
import { createEmptySlot, createSlot } from "@/lib/game/items";

describe("buildItemModel", () => {
  test("blocks become a small solid-color cube", () => {
    const model = buildItemModel(createSlot("dirt", 5));
    expect(model).not.toBeNull();
    const mesh = model!.object as THREE.Mesh;
    expect(mesh.geometry).toBeInstanceOf(THREE.BoxGeometry);
    expect((mesh.material as THREE.MeshStandardMaterial).vertexColors).toBe(false);
  });

  test("tools become a vertex-colored extruded sprite", () => {
    const model = buildItemModel(createSlot("wood_pickaxe", 1));
    expect(model).not.toBeNull();
    const mesh = model!.object as THREE.Mesh;
    expect((mesh.material as THREE.MeshStandardMaterial).vertexColors).toBe(true);
    expect(mesh.geometry.getAttribute("position").count).toBeGreaterThan(0);
  });

  test("empty and depleted slots build nothing", () => {
    expect(buildItemModel(undefined)).toBeNull();
    expect(buildItemModel(createEmptySlot())).toBeNull();
    expect(buildItemModel({ ...createSlot("dirt", 1), count: 0 })).toBeNull();
  });
});
