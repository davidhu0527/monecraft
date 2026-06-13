import { CHEST_SLOTS } from "@/lib/game/config";
import { rollDungeonLoot, seededRng } from "@/lib/game/dungeonLoot";
import { createEmptySlot, createSlot } from "@/lib/game/items";
import { tryInsertSlots } from "@/lib/game/inventory";
import type { GameState } from "../state";

/**
 * Fills a dungeon loot chest on its FIRST access (open or break) and marks it
 * looted. The loot is seeded from the world seed + the chest's voxel index, so
 * it is reproducible until the chest is accessed.
 *
 * Marking the index in the persisted `lootedDungeonChests` set — rather than
 * relying on the chest being non-empty — is what closes the re-roll exploit:
 * an emptied chest is dropped from the save's `blockEntities`, so without this
 * marker the lazy fill would run again on reload and hand out fresh loot.
 *
 * A no-op for player-placed chests (not in `dungeonChestIndices`) and for
 * dungeon chests already looted.
 */
export function fillDungeonChestIfUnlooted(state: GameState, idx: number): void {
  if (!state.dungeonChestIndices.has(idx) || state.lootedDungeonChests.has(idx)) return;
  const slots = state.containers.get(idx) ?? Array.from({ length: CHEST_SLOTS }, () => createEmptySlot());
  const loot = rollDungeonLoot(seededRng((state.world.seed ^ idx ^ 0x9e3779b1) >>> 0));
  const incoming = loot.map((drop) => createSlot(drop.itemId, drop.count));
  // The loot table has far fewer entries than CHEST_SLOTS (each yields one slot),
  // so the insert always fits and the `?? slots` fallback is unreachable —
  // dungeonLoot.test.ts pins that invariant so growing the tables can't silently
  // drop loot here.
  state.containers.set(idx, tryInsertSlots(slots, incoming) ?? slots);
  state.lootedDungeonChests.add(idx);
}
