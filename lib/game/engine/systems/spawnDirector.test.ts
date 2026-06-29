import { describe, expect, test } from "bun:test";
import { HOSTILE_CAP } from "@/lib/game/config";
import { VoxelWorld, generateWorld } from "@/lib/world";
import { GEN } from "@/lib/world/generation";
import { GameEngine } from "@/lib/game/engine/GameEngine";
import { createSurfaceYAt } from "@/lib/game/spawn";
import {
  assignVillagerProfessions,
  pushMob,
  spawnVillageResidents,
  tickHostileSpawnDirector,
  tickSpawnerDirector
} from "@/lib/game/engine/systems/spawnDirector";
import { PROFESSIONS } from "@/lib/game/trades";
import type { GameState } from "@/lib/game/engine/state";
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

describe("spawnVillageResidents", () => {
  test("seeds villagersPerVillage residents (faction villager, passive) at each site", () => {
    const world = new VoxelWorld(64, 64, 64, 1);
    generateWorld(world);
    const state = { world, mobs: [], nextMobId: 1 } as unknown as GameState;

    spawnVillageResidents(
      state,
      [
        { x: 20, z: 20 },
        { x: 44, z: 44 }
      ],
      mulberry32(1),
      createSurfaceYAt(world)
    );

    expect(state.mobs).toHaveLength(GEN.villagersPerVillage * 2);
    expect(state.mobs.every((m) => m.kind === "villager" && m.faction === "villager" && !m.hostile)).toBe(true);
  });

  test("assignVillagerProfessions fills professionless villagers round-robin, leaving assigned ones alone", () => {
    const world = new VoxelWorld(64, 64, 64, 1);
    generateWorld(world);
    const state = { world, mobs: [], nextMobId: 1 } as unknown as GameState;
    spawnVillageResidents(state, [{ x: 20, z: 20 }], mulberry32(1), createSurfaceYAt(world));
    state.mobs[0].profession = "cleric"; // a "restored" resident keeps its profession

    assignVillagerProfessions(state);

    expect(state.mobs[0].profession).toBe("cleric"); // untouched
    expect(state.mobs.slice(1).map((m) => m.profession)).toEqual(PROFESSIONS.slice(0, state.mobs.length - 1)); // the rest cycle
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

  test("at cap-1, a rolled 2-pack is clamped so the cap is never overshot", () => {
    const e = makeEngine("easy"); // cap 8 — the tightest, so the 2-pack edge bites soonest
    // Sweep seeds so at least one roll is a 2-pack: without the count clamp, that
    // seed would push 7 → 9 and overshoot; the clamp holds every seed at ≤ 8.
    for (let seed = 1; seed <= 12; seed += 1) {
      e.state.mobs = [];
      const { x, y, z } = e.state.player.position;
      const seeder = mulberry32(100 + seed);
      for (let i = 0; i < 7; i += 1) pushMob(e.state, "zombie", true, x + (i % 4), y, z + i, seeder); // cap - 1
      e.state.daylight = 0.1;
      e.state.timers.hostileSpawnTimer = 1000;
      tickHostileSpawnDirector(e.state, 0.1, mulberry32(seed), createSurfaceYAt(e.state.world));
      expect(hostileCount(e)).toBeLessThanOrEqual(8);
    }
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
