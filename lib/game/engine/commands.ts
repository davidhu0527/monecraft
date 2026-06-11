/**
 * Discrete player intents. Every state mutation triggered by the UI or input
 * controller goes through GameEngine.dispatch with one of these — the single
 * auditable entry point into the simulation.
 */
export type Command =
  | { type: "selectSlot"; index: number }
  | { type: "toggleInventory" }
  | { type: "craft"; recipeId: string }
  | { type: "swapSlots"; from: number; to: number }
  | { type: "toggleEquipArmor"; index: number }
  | { type: "eatFood" }
  | { type: "placeBlock" }
  | { type: "attack" }
  | { type: "unstuck" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "toggleDebug" }
  | { type: "respawn" };
