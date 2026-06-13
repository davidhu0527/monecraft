import { BlockId } from "@/lib/world";
import { CROP_GROWTH_CHANCE, RANDOM_TICK_INTERVAL_SECONDS, RANDOM_TICK_RADIUS, RANDOM_TICK_SAMPLES } from "@/lib/game/config";
import type { GameState } from "../state";

/**
 * Random block ticks: on a fixed interval, sample columns near the player and
 * run a per-block handler on the top block. This is the growth/spread engine —
 * today only crops, but the handler registry is the extension point for
 * saplings, grass spread, etc. Crops persist for free: they are ordinary block
 * edits, so they ride blockChanges and the save diff with no extra state.
 */

type RandomTickHandler = (state: GameState, x: number, y: number, z: number, rng: () => number) => void;

/** Advances a wheat crop one stage. Stage ids are consecutive, so +1 is the next stage. */
function growCrop(state: GameState, x: number, y: number, z: number, rng: () => number): void {
  if (rng() >= CROP_GROWTH_CHANCE) return;
  const next = (state.world.get(x, y, z) + 1) as BlockId;
  state.blockChanges.set(x, y, z, next);
  state.worldMeshDirty = true;
}

const RANDOM_TICK_HANDLERS: Partial<Record<BlockId, RandomTickHandler>> = {
  [BlockId.WheatStage0]: growCrop,
  [BlockId.WheatStage1]: growCrop,
  [BlockId.WheatStage2]: growCrop
  // WheatStage3 has no handler — mature crops stop growing.
};

export function tickRandomBlocks(state: GameState, dt: number, rng: () => number): void {
  state.timers.randomTickTimer += dt;
  if (state.timers.randomTickTimer < RANDOM_TICK_INTERVAL_SECONDS) return;
  state.timers.randomTickTimer = 0;

  const { world, player } = state;
  const px = Math.floor(player.position.x);
  const pz = Math.floor(player.position.z);
  for (let i = 0; i < RANDOM_TICK_SAMPLES; i += 1) {
    const x = px + Math.floor((rng() * 2 - 1) * RANDOM_TICK_RADIUS);
    const z = pz + Math.floor((rng() * 2 - 1) * RANDOM_TICK_RADIUS);
    if (!world.inBounds(x, 0, z)) continue;
    const y = world.highestSolidY(x, z);
    const handler = RANDOM_TICK_HANDLERS[world.get(x, y, z) as BlockId];
    if (handler) handler(state, x, y, z, rng);
  }
}
