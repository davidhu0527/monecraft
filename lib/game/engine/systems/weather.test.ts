import { describe, expect, test } from "bun:test";
import { WEATHER_CYCLE_SECONDS } from "@/lib/game/config";
import { tickWeather, weatherAt } from "@/lib/game/engine/systems/weather";
import type { GameState } from "@/lib/game/engine/state";
import { BiomeId } from "@/lib/world";

/** Finds a dayClock at the mid-point (peak intensity) of an active window. */
function activeDayClock(seed: number): number {
  for (let cycle = 0; cycle < 200; cycle += 1) {
    const t = cycle * WEATHER_CYCLE_SECONDS + WEATHER_CYCLE_SECONDS / 2;
    if (weatherAt(t, seed).active) return t;
  }
  throw new Error("no active weather window found");
}

function stubState(biome: BiomeId, dayClock: number, seed: number): GameState {
  return {
    dayClock,
    weather: { kind: "clear", intensity: 0 },
    player: { position: { x: 5, y: 64, z: 5 } },
    world: { seed, getBiome: () => biome }
  } as unknown as GameState;
}

describe("weatherAt", () => {
  test("is deterministic and bounded to [0,1]", () => {
    for (let t = 0; t < 2000; t += 37) {
      const a = weatherAt(t, 42);
      const b = weatherAt(t, 42);
      expect(a).toEqual(b);
      expect(a.intensity).toBeGreaterThanOrEqual(0);
      expect(a.intensity).toBeLessThanOrEqual(1);
    }
  });

  test("intensity peaks at the middle of an active window", () => {
    const seed = 42;
    const mid = activeDayClock(seed);
    expect(weatherAt(mid, seed).intensity).toBeCloseTo(1, 5);
    // Window edges ramp to ~0.
    expect(weatherAt(mid - WEATHER_CYCLE_SECONDS / 2 + 0.001, seed).intensity).toBeLessThan(0.02);
  });

  test("only a fraction of windows precipitate", () => {
    let active = 0;
    const windows = 400;
    for (let c = 0; c < windows; c += 1) {
      if (weatherAt(c * WEATHER_CYCLE_SECONDS + 1, 9).active) active += 1;
    }
    const fraction = active / windows;
    expect(fraction).toBeGreaterThan(0.15);
    expect(fraction).toBeLessThan(0.6);
  });
});

describe("tickWeather", () => {
  test("snows in the mountains, rains elsewhere, during an active window", () => {
    const seed = 42;
    const t = activeDayClock(seed);

    const snowy = stubState(BiomeId.Mountains, t, seed);
    tickWeather(snowy);
    expect(snowy.weather.kind).toBe("snow");
    expect(snowy.weather.intensity).toBeGreaterThan(0);

    const rainy = stubState(BiomeId.Forest, t, seed);
    tickWeather(rainy);
    expect(rainy.weather.kind).toBe("rain");

    const dry = stubState(BiomeId.Desert, t, seed);
    tickWeather(dry);
    expect(dry.weather.kind).toBe("clear");
    expect(dry.weather.intensity).toBe(0);
  });

  test("clears outside an active window regardless of biome", () => {
    const seed = 42;
    // Find an inactive window.
    let t = 0;
    for (let cycle = 0; cycle < 200; cycle += 1) {
      const candidate = cycle * WEATHER_CYCLE_SECONDS + WEATHER_CYCLE_SECONDS / 2;
      if (!weatherAt(candidate, seed).active) {
        t = candidate;
        break;
      }
    }
    const state = stubState(BiomeId.Forest, t, seed);
    tickWeather(state);
    expect(state.weather.kind).toBe("clear");
    expect(state.weather.intensity).toBe(0);
  });
});
