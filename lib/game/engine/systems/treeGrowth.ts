import { BlockId } from "@/lib/world";
import type { GameState } from "../state";

/**
 * Grows a tree from a sapling cell at the top of its column. Mirrors the
 * worldgen canopy shape (generation.ts `placeTrees`) but writes through
 * `state.blockChanges` (so the tree persists in the save diff and relights) and
 * uses the engine rng — it shares no determinism contract with worldgen, so the
 * hash-pinned `placeTrees` is deliberately left untouched.
 *
 * `topY` is the sapling's own y: the trunk base replaces the sapling, the grass
 * or dirt it was planted on stays below. The canopy only fills Air, so it never
 * eats the trunk or a neighbouring structure.
 */
export function growTreeAt(state: GameState, x: number, topY: number, z: number, rng: () => number): void {
  const { world, blockChanges } = state;
  const trunkHeight = 3 + Math.floor(rng() * 3); // 3..5 tall
  for (let y = 0; y < trunkHeight; y += 1) blockChanges.set(x, topY + y, z, BlockId.Wood);

  const leafStart = topY + trunkHeight - 1;
  for (let ox = -2; ox <= 2; ox += 1) {
    for (let oz = -2; oz <= 2; oz += 1) {
      for (let oy = 0; oy <= 2; oy += 1) {
        if (Math.abs(ox) + Math.abs(oz) + oy > 4) continue;
        if (world.get(x + ox, leafStart + oy, z + oz) !== BlockId.Air) continue;
        blockChanges.set(x + ox, leafStart + oy, z + oz, BlockId.Leaves);
      }
    }
  }
  state.worldMeshDirty = true;
}
