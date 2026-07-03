import { BlockId } from "@/lib/world";
import { GEN } from "@/lib/world/generation";
import {
  CROP_GROWTH_CHANCE,
  GRASS_SPREAD_CHANCE,
  KELP_GROWTH_CHANCE,
  RANDOM_TICK_INTERVAL_SECONDS,
  RANDOM_TICK_RADIUS,
  RANDOM_TICK_SAMPLES,
  SAPLING_GROWTH_CHANCE
} from "@/lib/game/config";
import type { GameState } from "../state";
import { growTreeAt } from "./treeGrowth";

/**
 * Random block ticks: on a fixed interval, sample columns near the player and
 * run a per-block handler on the top block. This is the growth/spread engine —
 * crops grow, saplings become trees, and bare dirt re-grasses. Every result is
 * an ordinary block edit, so it rides blockChanges and the save diff with no
 * extra state. The handler registry is the extension point for new behaviours.
 */

type RandomTickHandler = (state: GameState, x: number, y: number, z: number, rng: () => number) => void;

/** Advances a wheat crop one stage. Stage ids are consecutive, so +1 is the next stage. */
function growCrop(state: GameState, x: number, y: number, z: number, rng: () => number): void {
  if (rng() >= CROP_GROWTH_CHANCE) return;
  const next = (state.world.get(x, y, z) + 1) as BlockId;
  state.blockChanges.set(x, y, z, next);
  state.worldMeshDirty = true;
}

/** A sapling sitting on soil matures into a tree. Off-soil saplings never grow. */
function growSapling(state: GameState, x: number, y: number, z: number, rng: () => number): void {
  if (rng() >= SAPLING_GROWTH_CHANCE) return;
  const below = state.world.get(x, y - 1, z) as BlockId;
  if (below !== BlockId.Grass && below !== BlockId.Dirt && below !== BlockId.Farmland) return;
  growTreeAt(state, x, y, z, rng);
}

/** Exposed dirt re-grasses when an adjacent column's top block is grass. */
const GRASS_SPREAD_NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];
function spreadGrass(state: GameState, x: number, y: number, z: number, rng: () => number): void {
  if (rng() >= GRASS_SPREAD_CHANCE) return;
  const { world } = state;
  for (const [dx, dz] of GRASS_SPREAD_NEIGHBORS) {
    const ny = world.highestSolidY(x + dx, z + dz);
    if (world.get(x + dx, ny, z + dz) === BlockId.Grass) {
      state.blockChanges.set(x, y, z, BlockId.Grass);
      state.worldMeshDirty = true;
      return;
    }
  }
}

/**
 * A kelp stalk's top grows one block up into the water above. Growth keeps the
 * worldgen invariants (GEN.oceanFlora): the stalk caps at kelpMaxHeight, and
 * kelpSurfaceClearance water blocks must remain above the new top — kelp is a
 * solid block, so the clearance keeps boats and fishing casts clear of it.
 */
function growKelp(state: GameState, x: number, y: number, z: number, rng: () => number): void {
  if (rng() >= KELP_GROWTH_CHANCE) return;
  const { world } = state;
  const { kelpMaxHeight, kelpSurfaceClearance } = GEN.oceanFlora;

  let height = 1;
  while (world.get(x, y - height, z) === BlockId.Kelp) height += 1;
  if (height >= kelpMaxHeight) return;

  // The growth target plus the clearance band above it must all be water.
  for (let dy = 1; dy <= kelpSurfaceClearance + 1; dy += 1) {
    if (world.get(x, y + dy, z) !== BlockId.Water) return;
  }
  state.blockChanges.set(x, y + 1, z, BlockId.Kelp);
  state.worldMeshDirty = true;
}

const RANDOM_TICK_HANDLERS: Partial<Record<BlockId, RandomTickHandler>> = {
  [BlockId.WheatStage0]: growCrop,
  [BlockId.WheatStage1]: growCrop,
  [BlockId.WheatStage2]: growCrop,
  // WheatStage3 has no handler — mature crops stop growing.
  [BlockId.Sapling]: growSapling,
  [BlockId.Dirt]: spreadGrass,
  [BlockId.Kelp]: growKelp
};

export function tickRandomBlocks(state: GameState, dt: number, rng: () => number): void {
  state.timers.randomTickTimer += dt;
  if (state.timers.randomTickTimer < RANDOM_TICK_INTERVAL_SECONDS) return;
  state.timers.randomTickTimer = 0;

  const { world } = state;
  if (state.players.size === 0) return; // an idle server room grows nothing
  // The sample budget splits across players (each interval stays constant-cost),
  // so crops grow around everyone. Single-player: the full budget around the
  // one player — exactly the old behavior, same rng stream.
  const players = [...state.players.values()];
  const perPlayer = Math.max(1, Math.floor(RANDOM_TICK_SAMPLES / players.length));
  for (const player of players) {
    const px = Math.floor(player.position.x);
    const pz = Math.floor(player.position.z);
    for (let i = 0; i < perPlayer; i += 1) {
      const x = px + Math.floor((rng() * 2 - 1) * RANDOM_TICK_RADIUS);
      const z = pz + Math.floor((rng() * 2 - 1) * RANDOM_TICK_RADIUS);
      if (!world.inBounds(x, 0, z)) continue;
      const y = world.highestSolidY(x, z);
      const handler = RANDOM_TICK_HANDLERS[world.get(x, y, z) as BlockId];
      if (handler) handler(state, x, y, z, rng);
    }
  }
}
