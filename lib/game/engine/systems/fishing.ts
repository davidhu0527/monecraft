import * as THREE from "three";
import { BlockId, waterSurfaceRaycast } from "@/lib/world";
import {
  EYE_HEIGHT,
  FISHING_BITE_MAX_SECONDS,
  FISHING_BITE_MIN_SECONDS,
  FISHING_BITE_WINDOW_SECONDS,
  FISHING_REACH,
  FISHING_TETHER_DISTANCE,
  FISHING_XP
} from "@/lib/game/config";
import { rollFishingCatch } from "@/lib/game/fishingLoot";
import { adjustSlotCount, consumeToolDurability } from "@/lib/game/inventory";
import type { EmitGameEvent, GameState } from "../state";
import { lookDirection } from "./playerMotion";
import { awardXp } from "./xp";

const scratchEye = new THREE.Vector3();
const scratchDir = new THREE.Vector3();

function nextBiteDelay(rng: () => number): number {
  return FISHING_BITE_MIN_SECONDS + rng() * (FISHING_BITE_MAX_SECONDS - FISHING_BITE_MIN_SECONDS);
}

function isHoldingRod(state: GameState): boolean {
  const slot = state.inventory[state.selectedSlot];
  return slot?.id === "fishing_rod" && slot.count > 0;
}

/**
 * Right-click with a fishing rod: reel in the active cast (a catch if the bobber
 * is biting, otherwise nothing), or cast a new bobber at the aimed water surface.
 * Returns true whenever a rod is held (it always consumes the right-click), false
 * for any other item so the normal held-item/placement path runs.
 */
export function tryFish(state: GameState, emit: EmitGameEvent, rng: () => number): boolean {
  if (!isHoldingRod(state)) return false;

  if (state.fishing) {
    if (state.fishing.biting) {
      const items = rollFishingCatch(rng);
      const { x, y, z } = state.fishing.position;
      for (const drop of items) {
        state.inventory = adjustSlotCount(state.inventory, drop.itemId, drop.count) ?? state.inventory;
      }
      state.inventory = consumeToolDurability(state.inventory, state.selectedSlot, 1) ?? state.inventory;
      awardXp(state, FISHING_XP, emit);
      emit({ type: "fishingCaught", items, x, y, z });
    } else {
      emit({ type: "fishingReeledEmpty" });
    }
    state.fishing = null;
    return true;
  }

  const { world, player } = state;
  scratchEye.set(player.position.x, player.position.y + EYE_HEIGHT, player.position.z);
  lookDirection(player.yaw, player.pitch, scratchDir);
  const cell = waterSurfaceRaycast(world, scratchEye, scratchDir, FISHING_REACH);
  if (!cell) return true; // the rod still claims the click; there's just no water to cast at

  const position = new THREE.Vector3(cell.x + 0.5, cell.y + 1, cell.z + 0.5);
  state.fishing = { position, timer: nextBiteDelay(rng), biting: false };
  emit({ type: "fishingCast", x: position.x, y: position.y, z: position.z });
  return true;
}

/**
 * Advances the active cast: count down to a bite, open the reel window, then let
 * the catch escape (restarting the wait) if it isn't reeled in time. Auto-cancels
 * the cast when the rod is no longer held, the player dies, the targeted water is
 * gone, or the player wanders past the tether.
 */
export function tickFishing(state: GameState, dt: number, rng: () => number, emit: EmitGameEvent): void {
  const fishing = state.fishing;
  if (!fishing) return;

  const wx = Math.floor(fishing.position.x);
  const wy = Math.floor(fishing.position.y) - 1;
  const wz = Math.floor(fishing.position.z);
  if (
    state.isDead ||
    !isHoldingRod(state) ||
    state.world.get(wx, wy, wz) !== BlockId.Water ||
    state.player.position.distanceTo(fishing.position) > FISHING_TETHER_DISTANCE
  ) {
    state.fishing = null;
    return;
  }

  fishing.timer -= dt;
  if (fishing.timer > 0) return;

  if (fishing.biting) {
    fishing.biting = false;
    fishing.timer = nextBiteDelay(rng);
  } else {
    fishing.biting = true;
    fishing.timer = FISHING_BITE_WINDOW_SECONDS;
    emit({ type: "fishingBite", x: fishing.position.x, y: fishing.position.y, z: fishing.position.z });
  }
}
