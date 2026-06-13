import * as THREE from "three";
import { HELD_BLOCK_COLORS, HELD_BLOCK_FALLBACK_COLOR } from "@/lib/world";
import type { InventorySlot } from "@/lib/game/types";
import { renderSpritePixels } from "@/lib/ui/spritePixels";
import { buildExtrudedSpriteGeometry } from "./extrudedSprite";

export type ItemModel = {
  object: THREE.Object3D;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
};

const blockColor = (blockId: number | undefined): number =>
  (blockId !== undefined ? HELD_BLOCK_COLORS[blockId as keyof typeof HELD_BLOCK_COLORS] : undefined) ?? HELD_BLOCK_FALLBACK_COLOR;

/**
 * Builds the 3D model for an inventory item — shared between the first-person
 * held-item overlay and the third-person hand. The caller owns disposal of the
 * returned geometry and material. Returns null for empty/invalid slots.
 */
export function buildItemModel(slot: InventorySlot | undefined): ItemModel | null {
  if (!slot?.id || slot.count <= 0 || !slot.kind) return null;

  if (slot.kind === "block" && slot.id !== "door") {
    const geometry = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    const material = new THREE.MeshStandardMaterial({ color: blockColor(slot.blockId), roughness: 0.7, metalness: 0.05 });
    return { object: new THREE.Mesh(geometry, material), geometry, material };
  }

  // Doors, tools, weapons, food, armor: extrude the same 16x16 pixel grid the
  // inventory icon uses, so the in-hand model always matches the sprite.
  const geometry = buildExtrudedSpriteGeometry(renderSpritePixels(slot.id));
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 });
  return { object: new THREE.Mesh(geometry, material), geometry, material };
}
