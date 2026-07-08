import { DAY_CYCLE_SECONDS, NETHER_DAYLIGHT } from "@/lib/game/config";
import { portableSin } from "@/lib/world/noise";
import type { DimensionId } from "@/lib/game/types";
import type { GameState } from "../state";

/** Daylight level 0.04–1.0 for a given day clock. The single source of the formula. */
export function daylightAt(dayClock: number): number {
  // portableSin: daylight gates hostile spawn/burn, so an authoritative server
  // and its clients must agree on it bit-for-bit — see lib/world/noise.ts.
  const phase = (dayClock % DAY_CYCLE_SECONDS) / DAY_CYCLE_SECONDS;
  return Math.max(0.04, portableSin(phase * Math.PI * 2) * 0.95 + 0.05);
}

/**
 * Daylight for a dimension: the sky formula in the overworld, a skyless pinned
 * dusk in the nether (spawn/burn/sleep gates all read daylight, so pinning it
 * below the spawn threshold makes hostiles perpetual without special-casing).
 * The day clock itself keeps ticking everywhere — it is shared world time.
 */
export function dimensionDaylightAt(dimension: DimensionId, dayClock: number): number {
  return dimension === "nether" ? NETHER_DAYLIGHT : daylightAt(dayClock);
}

/** Sun angle in radians for a given day clock (renderer positions lights from it). */
export function sunAngleAt(dayClock: number): number {
  return ((dayClock % DAY_CYCLE_SECONDS) / DAY_CYCLE_SECONDS) * Math.PI * 2;
}

export function tickDayNight(state: GameState, dt: number): void {
  state.dayClock += dt;
  state.daylight = dimensionDaylightAt(state.dimension, state.dayClock);

  // The HUD percentage refreshes at 4 Hz to avoid re-rendering React every frame.
  state.timers.daylightHudTimer += dt;
  if (state.timers.daylightHudTimer >= 0.25) {
    state.timers.daylightHudTimer = 0;
    state.daylightPercent = Math.round(state.daylight * 100);
  }
}
