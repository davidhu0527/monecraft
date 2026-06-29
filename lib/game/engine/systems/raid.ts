import { RAID_RADIUS, RAID_REWARD_EMERALDS, RAID_REWARD_XP, RAID_WAVE_COUNT, RAID_WAVE_DELAY_SECONDS, RAID_WAVE_SIZE } from "@/lib/game/config";
import { hostilesSpawn } from "@/lib/game/difficulties";
import { adjustSlotCount } from "@/lib/game/inventory";
import { randomLandPointNear, type SurfaceYAtFn } from "@/lib/game/spawn";
import type { EmitGameEvent, GameState } from "../state";
import { pushMob } from "./spawnDirector";
import { awardXp } from "./xp";

export type RaidDeps = {
  surfaceYAt: SurfaceYAtFn;
  rng: () => number;
  emit: EmitGameEvent;
};

/** Living raiders in the world. */
function countRaiders(state: GameState): number {
  return state.mobs.reduce((n, mob) => n + (mob.faction === "raider" ? 1 : 0), 0);
}

/** Living villagers within the raid radius of its center — once zero, the village has fallen. */
function residentsNearCenter(state: GameState, center: { x: number; z: number }): number {
  const r2 = RAID_RADIUS * RAID_RADIUS;
  return state.mobs.reduce((n, mob) => {
    if (mob.faction !== "villager") return n;
    const dx = mob.position.x - center.x;
    const dz = mob.position.z - center.z;
    return n + (dx * dx + dz * dz <= r2 ? 1 : 0);
  }, 0);
}

/**
 * Begins a raid centered on (cx, cz). Refused (returns false) when one is already
 * running or hostiles can't spawn (Peaceful). The first wave drops on the next tick.
 */
export function startRaid(state: GameState, cx: number, cz: number): boolean {
  if (state.raid || !hostilesSpawn(state.difficulty)) return false;
  state.raid = { center: { x: cx, z: cz }, wavesSpawned: 0, totalWaves: RAID_WAVE_COUNT, waveTimer: 0 };
  return true;
}

function spawnWave(state: GameState, deps: RaidDeps): void {
  const raid = state.raid;
  if (!raid) return;
  for (let i = 0; i < RAID_WAVE_SIZE; i += 1) {
    const pos = randomLandPointNear(state.world, deps.surfaceYAt, raid.center.x, raid.center.z, RAID_RADIUS, deps.rng, RAID_RADIUS * 0.6);
    pushMob(state, "raider", true, pos.x, pos.y, pos.z, deps.rng);
    deps.emit({ type: "mobSpawned", kind: "raider", x: pos.x, y: pos.y, z: pos.z });
  }
  raid.wavesSpawned += 1;
  deps.emit({ type: "raidWaveStarted", wave: raid.wavesSpawned, totalWaves: raid.totalWaves });
}

/**
 * Drives the active raid's wave state machine: spawn a wave, wait for it to be
 * cleared, then (after a delay) spawn the next, until all waves are beaten (win:
 * emeralds + XP) or every nearby villager is dead (loss). Switching to Peaceful
 * cancels it (raiders despawn via despawnHostiles).
 */
export function tickRaid(state: GameState, dt: number, deps: RaidDeps): void {
  const raid = state.raid;
  if (!raid) return;
  if (!hostilesSpawn(state.difficulty)) {
    state.raid = null; // Peaceful cancels the raid cleanly
    return;
  }

  // The village fell — only checked once raiders are actually in play, so a raid
  // can't lose on the tick before its first wave even spawns.
  if (raid.wavesSpawned > 0 && residentsNearCenter(state, raid.center) === 0) {
    state.raid = null;
    deps.emit({ type: "raidLost" });
    return;
  }

  if (countRaiders(state) > 0) return; // a wave is still standing

  if (raid.wavesSpawned >= raid.totalWaves) {
    // Every wave beaten — the village holds.
    state.raid = null;
    state.inventory = adjustSlotCount(state.inventory, "emerald", RAID_REWARD_EMERALDS) ?? state.inventory;
    awardXp(state, RAID_REWARD_XP, deps.emit);
    deps.emit({ type: "raidWon" });
    return;
  }

  // Between waves: count down (the first wave starts immediately, waveTimer 0).
  raid.waveTimer -= dt;
  if (raid.waveTimer <= 0) {
    spawnWave(state, deps);
    raid.waveTimer = RAID_WAVE_DELAY_SECONDS;
  }
}
