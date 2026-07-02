import { CHEST_SLOTS } from "@/lib/game/config";
import { rollDungeonLoot, seededRng } from "@/lib/game/dungeonLoot";
import { rollShipwreckLoot } from "@/lib/game/shipwreckLoot";
import { createEmptySlot, createSlot } from "@/lib/game/items";
import { tryInsertSlots } from "@/lib/game/inventory";
import type { GameState } from "../state";

/**
 * Fills a worldgen loot chest (dungeon or shipwreck) on its FIRST access (open
 * or break) and marks it looted. The chest's family — which site set holds its
 * voxel index — picks the loot table, and each family mixes a distinct constant
 * into the seed so a dungeon chest and a shipwreck chest at a colliding index
 * could never share a roll. The loot is seeded from the world seed + the
 * chest's voxel index, so it is reproducible until the chest is accessed.
 *
 * Marking the index in the persisted `lootedWorldgenChests` set (the save's
 * `lootedChests` field) — rather than relying on the chest being non-empty — is
 * what closes the re-roll exploit: an emptied chest is dropped from the save's
 * `blockEntities`, so without this marker the lazy fill would run again on
 * reload and hand out fresh loot.
 *
 * A no-op for player-placed chests (in no site set) and for chests already looted.
 */
export function fillWorldgenChestIfUnlooted(state: GameState, idx: number): void {
  if (state.lootedWorldgenChests.has(idx)) return;
  let loot: Array<{ itemId: string; count: number }>;
  if (state.dungeonChestIndices.has(idx)) {
    loot = rollDungeonLoot(seededRng((state.world.seed ^ idx ^ 0x9e3779b1) >>> 0));
  } else if (state.shipwreckChestIndices.has(idx)) {
    loot = rollShipwreckLoot(seededRng((state.world.seed ^ idx ^ 0x68e31da4) >>> 0));
  } else {
    return;
  }
  const slots = state.containers.get(idx) ?? Array.from({ length: CHEST_SLOTS }, () => createEmptySlot());
  const incoming = loot.map((drop) => createSlot(drop.itemId, drop.count));
  // The loot tables have far fewer entries than CHEST_SLOTS (each yields one
  // slot), so the insert always fits and the `?? slots` fallback is unreachable —
  // the loot-table tests pin that invariant so growing the tables can't silently
  // drop loot here.
  state.containers.set(idx, tryInsertSlots(slots, incoming) ?? slots);
  state.lootedWorldgenChests.add(idx);
}
