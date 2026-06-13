import * as THREE from "three";
import { WALK_SPEED } from "@/lib/game/config";
import type { CameraMode } from "@/lib/game/engine/state";
import type { InventorySlot } from "@/lib/game/types";
import type { PlayerPalette } from "@/lib/game/playerSkins";
import { buildItemModel, type ItemModel } from "./itemModel";
import { applyPalette, createPlayerModel } from "./playerModel";
import { computePlayerPose } from "./playerPose";

/** The slice of GameState the player body needs — narrow so tests stay light. */
export type PlayerVisualsState = {
  cameraMode: CameraMode;
  isDead: boolean;
  player: {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    yaw: number;
    pitch: number;
    onGround: boolean;
  };
  inventory: InventorySlot[];
  selectedSlot: number;
  mining: { targetKey: string };
};

export type PlayerVisuals = {
  /** Positions, animates, and shows/hides the body. Call once per frame. */
  sync(state: PlayerVisualsState, timeMs: number): void;
  /** Queues a one-shot arm swing (attack click); latched on the next sync. */
  triggerSwing(): void;
  /** Recolors the body in place (skin preset change) — live-safe. */
  setPalette(palette: PlayerPalette): void;
  dispose(): void;
};

export function createPlayerVisuals(scene: THREE.Scene): PlayerVisuals {
  const model = createPlayerModel();
  model.group.visible = false;
  scene.add(model.group);

  let heldModel: ItemModel | null = null;
  let heldKey = "";
  let swingQueued = false;
  let swingStartMs = -Infinity;
  let wasMining = false;

  const clearHeldModel = () => {
    if (!heldModel) return;
    model.itemHolder.remove(heldModel.object);
    heldModel.geometry.dispose();
    heldModel.material.dispose();
    heldModel = null;
    heldKey = "";
  };

  const syncHeldItem = (slot: InventorySlot | undefined) => {
    const nextKey = slot?.id && slot.count > 0 && slot.kind ? slot.id : "";
    if (nextKey === heldKey) return;
    clearHeldModel();
    const built = buildItemModel(slot);
    if (built) {
      heldModel = built;
      heldKey = nextKey;
      model.itemHolder.add(built.object);
    }
  };

  return {
    sync(state, timeMs) {
      const visible = state.cameraMode !== "first" && !state.isDead;
      model.group.visible = visible;
      if (!visible) {
        // Don't replay stale swings when the body next becomes visible.
        swingQueued = false;
        return;
      }

      const { player } = state;
      model.group.position.copy(player.position);
      model.group.rotation.y = player.yaw;
      model.head.rotation.x = player.pitch;

      syncHeldItem(state.inventory[state.selectedSlot]);

      const miningActive = state.mining.targetKey !== "";
      if (swingQueued) {
        swingQueued = false;
        swingStartMs = timeMs;
      }
      if (miningActive && !wasMining) swingStartMs = timeMs;
      wasMining = miningActive;

      const moveFactor = player.onGround ? Math.min(1, Math.hypot(player.velocity.x, player.velocity.z) / WALK_SPEED) : 0;
      const pose = computePlayerPose({ timeMs, moveFactor, miningActive, swingStartMs });
      model.leftArm.rotation.x = pose.leftArmX;
      model.rightArm.rotation.x = pose.rightArmX;
      model.leftLeg.rotation.x = pose.leftLegX;
      model.rightLeg.rotation.x = pose.rightLegX;
    },

    triggerSwing() {
      swingQueued = true;
    },

    setPalette(palette) {
      applyPalette(model, palette);
    },

    dispose() {
      clearHeldModel();
      scene.remove(model.group);
      for (const material of model.materials) material.dispose();
      for (const geometry of model.geometries) geometry.dispose();
    }
  };
}
