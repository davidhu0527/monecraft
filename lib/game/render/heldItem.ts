import * as THREE from "three";
import type { InventorySlot } from "@/lib/game/types";
import { computeHeldPose } from "./heldItemPose";
import { buildItemModel } from "./itemModel";

export type HeldItemFrame = {
  timeMs: number;
  /** True while the player is actively mining a block — loops the swing arc. */
  miningActive: boolean;
  /** 0..1 horizontal speed relative to walk speed — scales the walk bob. */
  moveFactor: number;
  /** False in third person — the body's hand shows the item instead. */
  visible: boolean;
  /** True while a fishing cast is active — holds the rod out over the water. */
  fishingActive: boolean;
  /** True during the bite window — adds a rod-tip twitch. */
  fishingBiting: boolean;
};

export type HeldItemView = {
  /** Applies the animated pose every frame and rebuilds the model when the selected item changes. */
  update(slot: InventorySlot | undefined, frame: HeldItemFrame): void;
  /** Queues a one-shot swing (attack click); latched on the next update. */
  triggerSwing(): void;
  /** Queues a one-shot cast flick; latched on the next update. */
  triggerCast(): void;
  /** Queues a one-shot reel pull-back; latched on the next update. */
  triggerReel(): void;
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
  let castQueued = false;
  let castStartMs = -Infinity;
  let reelQueued = false;
  let reelStartMs = -Infinity;
  let equipStartMs = -Infinity;
  let wasMining = false;

  const clear = () => {
    if (mesh) holder.remove(mesh);
    mesh = null;
    key = "";
    while (geometries.length) geometries.pop()?.dispose();
    while (materials.length) materials.pop()?.dispose();
  };

  return {
    update(slot, frame) {
      root.visible = frame.visible;
      if (!frame.visible) {
        // Drop queued one-shots so they don't replay when the view returns.
        swingQueued = false;
        castQueued = false;
        reelQueued = false;
        return;
      }

      const nextKey = slot?.id && slot.count > 0 && slot.kind ? `${slot.id}` : "";
      if (nextKey !== key) {
        clear();
        // The new item starts from its own equip transition — don't let it
        // inherit the previous item's swing/cast/reel phase.
        swingQueued = false;
        swingStartMs = -Infinity;
        castQueued = false;
        castStartMs = -Infinity;
        reelQueued = false;
        reelStartMs = -Infinity;
        wasMining = false;
        const model = buildItemModel(slot);
        if (model) {
          geometries.push(model.geometry);
          materials.push(model.material);
          mesh = model.object;
          holder.add(mesh);
          key = nextKey;
          equipStartMs = frame.timeMs;
        }
      }

      if (swingQueued) {
        swingQueued = false;
        swingStartMs = frame.timeMs;
      }
      if (castQueued) {
        castQueued = false;
        castStartMs = frame.timeMs;
      }
      if (reelQueued) {
        reelQueued = false;
        reelStartMs = frame.timeMs;
      }
      if (frame.miningActive && !wasMining) swingStartMs = frame.timeMs;
      wasMining = frame.miningActive;

      const pose = computeHeldPose({
        timeMs: frame.timeMs,
        swingStartMs,
        continuousSwing: frame.miningActive,
        equipStartMs,
        moveFactor: frame.moveFactor,
        castStartMs,
        reelStartMs,
        fishingActive: frame.fishingActive,
        fishingBiting: frame.fishingBiting
      });
      holder.position.set(pose.posX, pose.posY, pose.posZ);
      holder.rotation.set(pose.rotX, pose.rotY, pose.rotZ);
    },

    triggerSwing() {
      swingQueued = true;
    },

    triggerCast() {
      castQueued = true;
    },

    triggerReel() {
      reelQueued = true;
    },

    dispose() {
      clear();
      camera.remove(root);
    }
  };
}
