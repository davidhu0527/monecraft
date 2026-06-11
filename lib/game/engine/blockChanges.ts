import { BlockId, VoxelWorld } from "@/lib/world";

/**
 * Tracks player edits to the generated world as deltas against the worldgen
 * baseline — the heart of the save format. A block restored to its original
 * value drops out of the delta set, keeping saves minimal.
 */
export type BlockChangeTracker = {
  /** Tracked write: updates the world and the delta set. */
  set(x: number, y: number, z: number, block: BlockId): void;
  /** Replays saved deltas onto a freshly generated world (boot only). */
  applySavedChanges(changes: Array<[number, number]>): void;
  /** Current deltas as [voxelIndex, blockId] pairs, ready to persist. */
  changes(): Array<[number, number]>;
};

export function createBlockChangeTracker(world: VoxelWorld): BlockChangeTracker {
  const changedBlocks = new Map<number, number>();
  const baselineByIndex = new Map<number, number>();

  return {
    set(x, y, z, block) {
      if (!world.inBounds(x, y, z)) return;
      const idx = world.index(x, y, z);
      if (!baselineByIndex.has(idx)) baselineByIndex.set(idx, world.get(x, y, z));
      world.set(x, y, z, block);
      const baseline = baselineByIndex.get(idx) ?? BlockId.Air;
      if (block === baseline) changedBlocks.delete(idx);
      else changedBlocks.set(idx, block);
    },

    applySavedChanges(changes) {
      const layer = world.sizeX * world.sizeZ;
      for (const [idx, block] of changes) {
        const y = Math.floor(idx / layer);
        const rem = idx - y * layer;
        const z = Math.floor(rem / world.sizeX);
        const x = rem - z * world.sizeX;
        if (!world.inBounds(x, y, z)) continue;
        world.set(x, y, z, block as BlockId);
        changedBlocks.set(idx, block);
      }
    },

    changes() {
      return [...changedBlocks.entries()];
    }
  };
}
