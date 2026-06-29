import { describe, expect, test } from "bun:test";
import { RAID_REWARD_EMERALDS, RAID_WAVE_COUNT, RAID_WAVE_DELAY_SECONDS, RAID_WAVE_SIZE } from "@/lib/game/config";
import { GameEngine } from "@/lib/game/engine/GameEngine";
import { createSurfaceYAt } from "@/lib/game/spawn";
import { countsById } from "@/lib/game/inventory";
import { pushMob } from "@/lib/game/engine/systems/spawnDirector";
import { startRaid, tickRaid, type RaidDeps } from "@/lib/game/engine/systems/raid";
import type { GameEvent } from "@/lib/game/engine/state";

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeEngine(): GameEngine {
  return new GameEngine({ seed: 1337, rng: mulberry32(42), worldSize: { x: 64, y: 150, z: 64 } });
}

function raidDeps(e: GameEngine): { deps: RaidDeps; events: GameEvent[] } {
  const events: GameEvent[] = [];
  return { deps: { surfaceYAt: createSurfaceYAt(e.state.world), rng: mulberry32(7), emit: (ev) => events.push(ev) }, events };
}

const raiders = (e: GameEngine) => e.state.mobs.filter((m) => m.faction === "raider").length;

describe("startRaid", () => {
  test("begins a raid, and refuses a second one or one in Peaceful", () => {
    const e = makeEngine();
    expect(startRaid(e.state, 30, 30)).toBe(true);
    expect(e.state.raid?.totalWaves).toBe(RAID_WAVE_COUNT);
    expect(startRaid(e.state, 30, 30)).toBe(false); // already running

    e.state.raid = null;
    e.state.difficulty = "peaceful";
    expect(startRaid(e.state, 30, 30)).toBe(false); // Peaceful never raids
  });
});

describe("tickRaid", () => {
  function seedVillager(e: GameEngine): void {
    pushMob(e.state, "villager", false, 30, 30, 30, () => 0.5); // a resident at the raid center
  }

  test("clearing every wave wins the raid with an emerald reward", () => {
    const e = makeEngine();
    e.state.mobs = [];
    seedVillager(e);
    startRaid(e.state, 30, 30);
    const { deps, events } = raidDeps(e);

    tickRaid(e.state, 0.1, deps); // the first wave drops immediately
    expect(raiders(e)).toBe(RAID_WAVE_SIZE);
    expect(events.some((ev) => ev.type === "raidWaveStarted" && ev.wave === 1)).toBe(true);

    let guard = 0;
    while (e.state.raid && guard++ < 50) {
      e.state.mobs = e.state.mobs.filter((m) => m.faction !== "raider"); // wipe the wave
      tickRaid(e.state, RAID_WAVE_DELAY_SECONDS + 0.1, deps); // advance past the delay → next wave or win
    }

    expect(e.state.raid).toBeNull();
    expect(events.some((ev) => ev.type === "raidWon")).toBe(true);
    expect(events.filter((ev) => ev.type === "raidWaveStarted")).toHaveLength(RAID_WAVE_COUNT);
    expect(countsById(e.state.inventory).get("emerald")).toBe(RAID_REWARD_EMERALDS);
  });

  test("the raid is lost when every nearby villager dies", () => {
    const e = makeEngine();
    e.state.mobs = [];
    seedVillager(e);
    startRaid(e.state, 30, 30);
    const { deps, events } = raidDeps(e);

    tickRaid(e.state, 0.1, deps); // wave 1 spawns
    e.state.mobs = e.state.mobs.filter((m) => m.faction !== "villager"); // the village falls
    tickRaid(e.state, 0.1, deps);

    expect(e.state.raid).toBeNull();
    expect(events.some((ev) => ev.type === "raidLost")).toBe(true);
  });

  test("switching to Peaceful cancels an in-progress raid", () => {
    const e = makeEngine();
    startRaid(e.state, 30, 30);
    e.state.difficulty = "peaceful";
    const { deps } = raidDeps(e);

    tickRaid(e.state, 0.1, deps);
    expect(e.state.raid).toBeNull();
  });
});
