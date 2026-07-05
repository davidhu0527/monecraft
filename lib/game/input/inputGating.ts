import type { GameEngine } from "@/lib/game/engine/GameEngine";

/**
 * True while gameplay input (movement/look/mine/discrete actions) must be
 * suppressed for a UI panel or death. Shared by BOTH input controllers —
 * desktop and touch are independent input paths that must respect the same
 * panel-gating contract, so a future blocking UI state gets added here once
 * instead of drifting between them.
 */
export function isUiBlocked(engine: GameEngine): boolean {
  return engine.state.inventoryOpen || engine.state.advancementsOpen || engine.state.isDead || engine.state.paused;
}
