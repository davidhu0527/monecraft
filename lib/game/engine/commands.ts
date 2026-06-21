/**
 * Discrete player intents. Every state mutation triggered by the UI or input
 * controller goes through GameEngine.dispatch with one of these — the single
 * auditable entry point into the simulation.
 */
import type { EnchantmentId } from "@/lib/game/types";

/**
 * Slot indices passed to `moveStack` at or above this base address the open
 * chest (local index = value - base); below it they address the player
 * inventory. This lets one move command span both grids.
 */
export const CONTAINER_SLOT_BASE = 1000;

export type Command =
  | { type: "selectSlot"; index: number }
  | { type: "toggleInventory" }
  | { type: "craft"; recipeId: string }
  | { type: "swapSlots"; from: number; to: number }
  | { type: "moveStack"; from: number; to: number }
  | { type: "toggleEquipArmor"; index: number }
  | { type: "eatFood" }
  | { type: "drinkPotion" }
  | { type: "enchant"; enchant: EnchantmentId }
  | { type: "placeBlock" }
  | { type: "attack" }
  | { type: "toggleFlight" }
  | { type: "creativeGiveItem"; itemId: string }
  | { type: "unstuck" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "toggleDebug" }
  | { type: "toggleCameraView" }
  | { type: "respawn" }
  | { type: "dismissVictory" };
