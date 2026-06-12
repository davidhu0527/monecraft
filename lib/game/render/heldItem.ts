import * as THREE from "three";
import { HELD_BLOCK_COLORS, HELD_BLOCK_FALLBACK_COLOR } from "@/lib/world";
import type { InventorySlot } from "@/lib/game/types";
import { renderSpritePixels } from "@/lib/ui/spritePixels";
import { buildExtrudedSpriteGeometry } from "./extrudedSprite";
import { computeHeldPose } from "./heldItemPose";

export type HeldItemFrame = {
  timeMs: number;
  /** True while the player is actively mining a block — loops the swing arc. */
  miningActive: boolean;
  /** 0..1 horizontal speed relative to walk speed — scales the walk bob. */
  moveFactor: number;
};

export type HeldItemView = {
  /** Applies the animated pose every frame and rebuilds the model when the selected item changes. */
  update(slot: InventorySlot | undefined, frame: HeldItemFrame): void;
  /** Queues a one-shot swing (attack click); latched on the next update. */
  triggerSwing(): void;
  dispose(): void;
};

export function createHeldItemView(camera: THREE.Camera): HeldItemView {
  const root = new THREE.Group();
  camera.add(root);

  // The holder carries the animated pose; the model inside stays geometry-local.
  const holder = new THREE.Group();
  root.add(holder);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  let mesh: THREE.Object3D | null = null;
  let key = "";

  let swingQueued = false;
  let swingStartMs = -Infinity;
  let equipStartMs = -Infinity;
  let wasMining = false;

  const clear = () => {
    if (mesh) holder.remove(mesh);
    mesh = null;
    key = "";
    while (geometries.length) geometries.pop()?.dispose();
    while (materials.length) materials.pop()?.dispose();
  };

  const blockColor = (blockId: number | undefined): number =>
    (blockId !== undefined ? HELD_BLOCK_COLORS[blockId as keyof typeof HELD_BLOCK_COLORS] : undefined) ?? HELD_BLOCK_FALLBACK_COLOR;

  const buildModel = (slot: InventorySlot, id: string): THREE.Object3D => {
    if (slot.kind === "block") {
      const geometry = new THREE.BoxGeometry(0.22, 0.22, 0.22);
      const material = new THREE.MeshStandardMaterial({ color: blockColor(slot.blockId), roughness: 0.7, metalness: 0.05 });
      geometries.push(geometry);
      materials.push(material);
      return new THREE.Mesh(geometry, material);
    }
    // Tools, weapons, food, armor: extrude the same 16x16 pixel grid the
    // inventory icon uses, so the in-hand model always matches the sprite.
    const geometry = buildExtrudedSpriteGeometry(renderSpritePixels(id));
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 });
    geometries.push(geometry);
    materials.push(material);
    return new THREE.Mesh(geometry, material);
  };

  return {
    update(slot, frame) {
      const nextKey = slot?.id && slot.count > 0 && slot.kind ? `${slot.id}` : "";
      if (nextKey !== key) {
        clear();
        if (slot && nextKey) {
          mesh = buildModel(slot, nextKey);
          holder.add(mesh);
          key = nextKey;
          equipStartMs = frame.timeMs;
        }
      }

      if (swingQueued) {
        swingQueued = false;
        swingStartMs = frame.timeMs;
      }
      if (frame.miningActive && !wasMining) swingStartMs = frame.timeMs;
      wasMining = frame.miningActive;

      const pose = computeHeldPose({
        timeMs: frame.timeMs,
        swingStartMs,
        continuousSwing: frame.miningActive,
        equipStartMs,
        moveFactor: frame.moveFactor
      });
      holder.position.set(pose.posX, pose.posY, pose.posZ);
      holder.rotation.set(pose.rotX, pose.rotY, pose.rotZ);
    },

    triggerSwing() {
      swingQueued = true;
    },

    dispose() {
      clear();
      camera.remove(root);
    }
  };
}
