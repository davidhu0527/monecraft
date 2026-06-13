import { WEATHER_CYCLE_SECONDS, WEATHER_RAIN_FRACTION } from "@/lib/game/config";
import { BiomeId } from "@/lib/world";
import type { GameState, WeatherKind } from "../state";

/**
 * Cosmetic, transient weather. Deterministic from `dayClock` + world seed: time
 * is split into fixed windows, a seeded hash of the window index decides whether
 * it precipitates, and a triangular envelope ramps intensity 0→1→0 across the
 * window so it eases in and out.
 *
 * Being a pure function of `dayClock` (no internal accumulator) makes it immune
 * to the engine's substep catch-up loop — slicing the same elapsed time into
 * more or fewer steps yields the identical result. Weather is NEVER persisted
 * and NEVER touches spawn/daylight balance — it only sets `state.weather`.
 */

function hash01(n: number, seed: number): number {
  const v = Math.sin((n + 1) * 12.9898 + seed * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

export function weatherAt(dayClock: number, seed: number): { active: boolean; intensity: number } {
  const cycle = Math.floor(dayClock / WEATHER_CYCLE_SECONDS);
  if (hash01(cycle, seed) >= WEATHER_RAIN_FRACTION) return { active: false, intensity: 0 };
  const phase = (dayClock % WEATHER_CYCLE_SECONDS) / WEATHER_CYCLE_SECONDS; // 0..1
  return { active: true, intensity: 1 - Math.abs(phase * 2 - 1) };
}

/** Snowy biomes get snow; dry biomes stay clear; everything else rains. */
function precipKindFor(biome: BiomeId): WeatherKind {
  if (biome === BiomeId.Mountains) return "snow";
  if (biome === BiomeId.Desert || biome === BiomeId.Ocean) return "clear";
  return "rain";
}

export function tickWeather(state: GameState): void {
  const { active, intensity } = weatherAt(state.dayClock, state.world.seed);
  if (!active) {
    state.weather.kind = "clear";
    state.weather.intensity = 0;
    return;
  }
  const kind = precipKindFor(state.world.getBiome(Math.floor(state.player.position.x), Math.floor(state.player.position.z)));
  state.weather.kind = kind;
  state.weather.intensity = kind === "clear" ? 0 : intensity;
}
