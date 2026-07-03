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
import type { EmitGameEvent, GameState, PlayerState } from "../state";
import { lookDirection } from "./playerMotion";
import { awardXp } from "./xp";

const scratchEye = new THREE.Vector3();
const scratchDir = new THREE.Vector3();

function nextBiteDelay(rng: () => number): number {
  return FISHING_BITE_MIN_SECONDS + rng() * (FISHING_BITE_MAX_SECONDS - FISHING_BITE_MIN_SECONDS);
}

function isHoldingRod(player: PlayerState): boolean {
  const slot = player.inventory[player.selectedSlot];
  return slot?.id === "fishing_rod" && slot.count > 0;
}

/**
 * Right-click with a fishing rod: reel in the active cast (a catch if the bobber
 * is biting, otherwise nothing), or cast a new bobber at the aimed water surface.
 * Returns true whenever a rod is held (it always consumes the right-click), false
 * for any other item so the normal held-item/placement path runs.
 */
export function tryFish(state: GameState, player: PlayerState, emit: EmitGameEvent, rng: () => number): boolean {
  if (!isHoldingRod(player)) return false;

  if (player.fishing) {
    if (player.fishing.biting) {
      const items = rollFishingCatch(rng);
      const { x, y, z } = player.fishing.position;
      for (const drop of items) {
        player.inventory = adjustSlotCount(player.inventory, drop.itemId, drop.count) ?? player.inventory;
      }
      player.inventory = consumeToolDurability(player.inventory, player.selectedSlot, 1, rng) ?? player.inventory;
      awardXp(player, FISHING_XP, emit);
      emit({ type: "fishingCaught", items, x, y, z });
    } else {
      emit({ type: "fishingReeledEmpty" });
    }
    player.fishing = null;
    return true;
  }

  const { world } = state;
  scratchEye.set(player.position.x, player.position.y + EYE_HEIGHT, player.position.z);
  lookDirection(player.yaw, player.pitch, scratchDir);
  const cell = waterSurfaceRaycast(world, scratchEye, scratchDir, FISHING_REACH);
  if (!cell) return true; // the rod still claims the click; there's just no water to cast at

  const position = new THREE.Vector3(cell.x + 0.5, cell.y + 1, cell.z + 0.5);
  player.fishing = { position, timer: nextBiteDelay(rng), biting: false };
  emit({ type: "fishingCast", x: position.x, y: position.y, z: position.z });
  return true;
}

/**
 * Advances the active cast: count down to a bite, open the reel window, then let
 * the catch escape (restarting the wait) if it isn't reeled in time. Auto-cancels
 * the cast when the rod is no longer held, the player dies, the targeted water is
 * gone, or the player wanders past the tether.
 */
export function tickFishing(state: GameState, player: PlayerState, dt: number, rng: () => number, emit: EmitGameEvent): void {
  const fishing = player.fishing;
  if (!fishing) return;

  const wx = Math.floor(fishing.position.x);
  const wy = Math.floor(fishing.position.y) - 1;
  const wz = Math.floor(fishing.position.z);
  if (
    player.isDead ||
    !isHoldingRod(player) ||
    state.world.get(wx, wy, wz) !== BlockId.Water ||
    player.position.distanceTo(fishing.position) > FISHING_TETHER_DISTANCE
  ) {
    player.fishing = null;
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
