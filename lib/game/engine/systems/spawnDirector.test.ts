import { describe, expect, test } from "bun:test";
import { HOSTILE_CAP } from "@/lib/game/config";
import { GameEngine } from "@/lib/game/engine/GameEngine";
import { createSurfaceYAt } from "@/lib/game/spawn";
import { pushMob, tickHostileSpawnDirector, tickSpawnerDirector } from "@/lib/game/engine/systems/spawnDirector";
import type { Difficulty } from "@/lib/game/difficulties";

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeEngine(difficulty: Difficulty): GameEngine {
  return new GameEngine({ seed: 1337, difficulty, rng: mulberry32(42), worldSize: { x: 64, y: 150, z: 64 } });
}

const hostileCount = (e: GameEngine) => e.state.mobs.filter((m) => m.hostile).length;

describe("spawnInitialMobs difficulty gating (via the constructor)", () => {
  test("Peaceful seeds passives but no hostiles", () => {
    const e = makeEngine("peaceful");
    expect(hostileCount(e)).toBe(0);
    expect(e.state.mobs.some((m) => !m.hostile)).toBe(true); // animals still populate
  });

  test("Normal seeds the usual hostile population", () => {
    const e = makeEngine("normal");
    expect(hostileCount(e)).toBeGreaterThan(0);
  });
});

describe("tickHostileSpawnDirector", () => {
  /** Puts the world at night with the spawn timer already past any interval. */
  function primeForSpawn(e: GameEngine): void {
    e.state.mobs = [];
    e.state.daylight = 0.1; // below HOSTILE_SPAWN_BELOW_DAYLIGHT
    e.state.timers.hostileSpawnTimer = 1000;
  }

  test("Peaceful never trickles a hostile, even at night past the interval", () => {
    const e = makeEngine("peaceful");
    primeForSpawn(e);
    tickHostileSpawnDirector(e.state, 0.1, mulberry32(3), createSurfaceYAt(e.state.world));
    expect(hostileCount(e)).toBe(0);
  });

  test("Normal trickles at least one hostile under the same conditions", () => {
    const e = makeEngine("normal");
    primeForSpawn(e);
    tickHostileSpawnDirector(e.state, 0.1, mulberry32(3), createSurfaceYAt(e.state.world));
    expect(hostileCount(e)).toBeGreaterThan(0);
  });

  test("Hard honours its raised cap (16 × 1.5 = 24): no spawn once full", () => {
    const e = makeEngine("hard");
    primeForSpawn(e);
    const { x, y, z } = e.state.player.position;
    const rng = mulberry32(9);
    for (let i = 0; i < 24; i += 1) pushMob(e.state, "zombie", true, x + (i % 5), y, z + i, rng);
    tickHostileSpawnDirector(e.state, 0.1, rng, createSurfaceYAt(e.state.world));
    expect(hostileCount(e)).toBe(24); // already at the Hard cap — nothing added
  });

  test("Easy's lowered cap (16 × 0.5 = 8) blocks spawns the Normal cap would allow", () => {
    const e = makeEngine("easy");
    primeForSpawn(e);
    const { x, y, z } = e.state.player.position;
    const rng = mulberry32(11);
    for (let i = 0; i < 8; i += 1) pushMob(e.state, "zombie", true, x + (i % 4), y, z + i, rng);
    expect(8).toBeLessThan(HOSTILE_CAP); // would still be under the baseline cap
    tickHostileSpawnDirector(e.state, 0.1, rng, createSurfaceYAt(e.state.world));
    expect(hostileCount(e)).toBe(8); // but Easy is already capped
  });
});

describe("tickSpawnerDirector", () => {
  test("Peaceful keeps dungeon spawners inert", () => {
    const e = makeEngine("peaceful");
    e.state.mobs = [];
    // Pretend a spawner is active right on top of the player; Peaceful returns first.
    e.state.dungeonSpawnerIndices = new Set([0]);
    e.state.timers.spawnerTimer = 1000;
    tickSpawnerDirector(e.state, 0.1, mulberry32(5), () => {});
    expect(hostileCount(e)).toBe(0);
  });
});
