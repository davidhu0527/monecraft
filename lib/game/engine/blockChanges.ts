import { applyEdit, BlockId, VoxelWorld } from "@/lib/world";

/**
 * Tracks player edits to the generated world as deltas against the worldgen
 * baseline — the heart of the save format. A block restored to its original
 * value drops out of the delta set, keeping saves minimal.
 *
 * The tracker also journals every write since the last drain: a multiplayer
 * server broadcasts exactly that journal each tick, because gameplay events
 * alone can't reconstruct multi-cell edits (an explosion crater, a kelp
 * stalk refilling with water, a door's two cells).
 */
export type DetailedEdit = { idx: number; block: number; prev: number };

export type BlockChangeTracker = {
  /** Tracked write: updates the world and the delta set. */
  set(x: number, y: number, z: number, block: BlockId): void;
  /** Replays saved deltas onto a freshly generated world (boot only). */
  applySavedChanges(changes: Array<[number, number]>): void;
  /** Current deltas as [voxelIndex, blockId] pairs, ready to persist. */
  changes(): Array<[number, number]>;
  /** Every write since the last drain (a server's per-tick block broadcast). */
  drainEdits(): Array<[number, number]>;
  /** Same drain window, with each cell's pre-window value — what a client's prediction ledger needs to revert. */
  drainEditsDetailed(): DetailedEdit[];
};

export function createBlockChangeTracker(world: VoxelWorld): BlockChangeTracker {
  const changedBlocks = new Map<number, number>();
  const baselineByIndex = new Map<number, number>();
  // Last-write-wins within a tick window (prev = the pre-window value, kept
  // across same-cell rewrites); drained by the server each tick — or by a
  // replica capturing its own predicted edits.
  let editJournal = new Map<number, { block: number; prev: number }>();

  return {
    set(x, y, z, block) {
      if (!world.inBounds(x, y, z)) return;
      const idx = world.index(x, y, z);
      if (!baselineByIndex.has(idx)) baselineByIndex.set(idx, world.get(x, y, z));
      const prev = editJournal.get(idx)?.prev ?? world.get(x, y, z);
      world.set(x, y, z, block);
      // Patch lighting locally now the block changed. This is the single
      // chokepoint for every gameplay edit (mining, doors, farming, crop
      // growth), so each one relights without the renderer doing anything; the
      // load path (applySavedChanges) bypasses this and the full bake covers it.
      applyEdit(world, world.light, x, y, z);
      const baseline = baselineByIndex.get(idx) ?? BlockId.Air;
      if (block === baseline) changedBlocks.delete(idx);
      else changedBlocks.set(idx, block);
      editJournal.set(idx, { block, prev });
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
    },

    drainEdits() {
      if (editJournal.size === 0) return [];
      const drained = [...editJournal.entries()].map(([idx, e]): [number, number] => [idx, e.block]);
      editJournal = new Map();
      return drained;
    },

    drainEditsDetailed() {
      if (editJournal.size === 0) return [];
      const drained = [...editJournal.entries()].map(([idx, e]) => ({ idx, block: e.block, prev: e.prev }));
      editJournal = new Map();
      return drained;
    }
  };
}
