import { DAY_CYCLE_SECONDS } from "@/lib/game/config";
import type { GameState } from "../state";

/** Daylight level 0.04–1.0 for a given day clock. The single source of the formula. */
export function daylightAt(dayClock: number): number {
  const phase = (dayClock % DAY_CYCLE_SECONDS) / DAY_CYCLE_SECONDS;
  return Math.max(0.04, Math.sin(phase * Math.PI * 2) * 0.95 + 0.05);
}

/** Sun angle in radians for a given day clock (renderer positions lights from it). */
export function sunAngleAt(dayClock: number): number {
  return ((dayClock % DAY_CYCLE_SECONDS) / DAY_CYCLE_SECONDS) * Math.PI * 2;
}

export function tickDayNight(state: GameState, dt: number): void {
  state.dayClock += dt;
  state.daylight = daylightAt(state.dayClock);

  // The HUD percentage refreshes at 4 Hz to avoid re-rendering React every frame.
  state.timers.daylightHudTimer += dt;
  if (state.timers.daylightHudTimer >= 0.25) {
    state.timers.daylightHudTimer = 0;
    state.daylightPercent = Math.round(state.daylight * 100);
  }
}
