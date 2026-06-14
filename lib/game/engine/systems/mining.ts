import * as THREE from "three";
import { BlockId, collidesAt, doorBlock, doorFacingFromYaw, doorState, isDoorBlock, voxelRaycast } from "@/lib/world";
import { BARE_HAND_MINE_POWER, CHEST_SLOTS, EYE_HEIGHT, MINE_REACH, MINING_RATE, PLAYER_HALF_WIDTH, PLAYER_HEIGHT } from "@/lib/game/config";
import { BREAK_HARDNESS, createEmptySlot, rollBlockDrops } from "@/lib/game/items";
import { adjustSlotCount, consumeToolDurability, tryInsertSlots } from "@/lib/game/inventory";
import type { EmitGameEvent, FrameInput, GameState } from "../state";
import { fillDungeonChestIfUnlooted } from "./dungeon";
import { lookDirection } from "./playerMotion";
import type { InventorySlot } from "@/lib/game/types";

const scratchEye = new THREE.Vector3();
const scratchDir = new THREE.Vector3();

function eyePosition(state: GameState, out: THREE.Vector3): THREE.Vector3 {
  const { position } = state.player;
  return out.set(position.x, position.y + EYE_HEIGHT, position.z);
}

export function selectedTool(state: GameState): InventorySlot | null {
  const slot = state.inventory[state.selectedSlot];
  return slot?.kind === "tool" && slot.count > 0 ? slot : null;
}

export function canMineBlock(block: BlockId, toolTier: number): boolean {
  if (block === BlockId.Stone || block === BlockId.Cobblestone || block === BlockId.Brick) return toolTier >= 1;
  if (block === BlockId.SliverOre) return toolTier >= 2;
  if (block === BlockId.RubyOre) return toolTier >= 3;
  if (block === BlockId.GoldOre) return toolTier >= 3;
  if (block === BlockId.SapphireOre) return toolTier >= 4;
  if (block === BlockId.DiamondOre) return toolTier >= 4;
  return true;
}

export function miningSpeed(tool: InventorySlot | null): number {
  return tool?.minePower ?? BARE_HAND_MINE_POWER;
}

export function resetMining(state: GameState): void {
  state.mining.targetKey = "";
  state.mining.progress = 0;
}

function addBlockDrop(state: GameState, block: BlockId, rng: () => number): void {
  for (const drop of rollBlockDrops(block, rng)) {
    state.inventory = adjustSlotCount(state.inventory, drop.itemId, drop.count) ?? state.inventory;
  }
}

/**
 * Empties a broken chest into the inventory. Returns true if the break may
 * proceed (the chest was empty, or its contents all fit), false to refuse it
 * (no room — the chest is left intact). On success the container entry is
 * removed and a pickedUp toast announces what was retrieved.
 */
function spillChestOnBreak(state: GameState, idx: number, emit: EmitGameEvent): boolean {
  // Breaking an unopened dungeon chest still pays out its loot.
  fillDungeonChestIfUnlooted(state, idx);
  const container = state.containers.get(idx);
  const items = container?.filter((slot) => slot.id && slot.count > 0) ?? [];
  if (items.length > 0) {
    const merged = tryInsertSlots(state.inventory, items);
    if (!merged) {
      emit({ type: "breakBlocked", reason: "containerFull" });
      return false;
    }
    state.inventory = merged;
    const picked = new Map<string, number>();
    for (const slot of items) picked.set(slot.id!, (picked.get(slot.id!) ?? 0) + slot.count);
    emit({ type: "pickedUp", items: [...picked].map(([itemId, count]) => ({ itemId, count })) });
  }
  state.containers.delete(idx);
  return true;
}

/** Advances mining progress while the mouse is held; breaks the block at full progress. */
export function tickMining(state: GameState, input: FrameInput, dt: number, emit: EmitGameEvent, rng: () => number): void {
  if (!input.leftMouseHeld) {
    // Releasing the button abandons progress (matching the crack overlay).
    if (state.mining.progress > 0) resetMining(state);
    return;
  }
  if (state.inventoryOpen || state.isDead || !input.pointerLocked) return;

  const { world, mining } = state;
  const origin = eyePosition(state, scratchEye);
  const direction = lookDirection(state.player.yaw, state.player.pitch, scratchDir);
  const result = voxelRaycast(world, origin, direction, MINE_REACH);
  if (!result) {
    resetMining(state);
    return;
  }

  const bx = result.hit.x;
  const by = result.hit.y;
  const bz = result.hit.z;
  const targetBlock = world.get(bx, by, bz);
  const tool = selectedTool(state);
  const tier = tool?.mineTier ?? 0;

  if (targetBlock === BlockId.Bedrock || targetBlock === BlockId.Air || !canMineBlock(targetBlock as BlockId, tier)) {
    resetMining(state);
    return;
  }

  const key = `${bx},${by},${bz}`;
  if (mining.targetKey !== key) {
    mining.targetKey = key;
    mining.progress = 0;
  }

  const hardness = BREAK_HARDNESS[targetBlock as BlockId] ?? 2;
  mining.progress += dt * miningSpeed(tool) * MINING_RATE;
  if (mining.progress < hardness) return;

  // Breaking a chest empties it into the inventory first; if it does not all
  // fit, refuse the break so nothing is lost (the chest stays intact).
  if (targetBlock === BlockId.Chest && !spillChestOnBreak(state, world.index(bx, by, bz), emit)) {
    resetMining(state);
    return;
  }

  if (isDoorBlock(targetBlock)) {
    const door = doorState(targetBlock)!;
    const other = doorState(world.get(bx, door.upper ? by - 1 : by + 1, bz));
    state.blockChanges.set(bx, by, bz, BlockId.Air);
    if (other && other.upper !== door.upper) {
      state.blockChanges.set(bx, door.upper ? by - 1 : by + 1, bz, BlockId.Air);
    }
  } else {
    state.blockChanges.set(bx, by, bz, BlockId.Air);
  }
  if (tool) state.inventory = consumeToolDurability(state.inventory, state.selectedSlot, 1) ?? state.inventory;
  addBlockDrop(state, targetBlock as BlockId, rng);
  state.worldMeshDirty = true;
  resetMining(state);
  emit({ type: "blockBroken", blockId: targetBlock as BlockId, x: bx, y: by, z: bz });
}

/** Places the selected block against the targeted face, refusing self-entombment. */
export function placeSelectedBlock(state: GameState, emit: EmitGameEvent): void {
  const { world } = state;
  const origin = eyePosition(state, scratchEye);
  const direction = lookDirection(state.player.yaw, state.player.pitch, scratchDir);
  const result = voxelRaycast(world, origin, direction, MINE_REACH);
  if (!result) return;

  const tx = result.previous.x;
  const ty = result.previous.y;
  const tz = result.previous.z;
  if (!world.inBounds(tx, ty, tz)) return;
  const replacedBlock = world.get(tx, ty, tz);
  if (replacedBlock !== BlockId.Air && replacedBlock !== BlockId.Water) return;

  const slot = state.inventory[state.selectedSlot];
  if (!slot || !slot.id || slot.kind !== "block" || slot.count <= 0 || slot.blockId === undefined) return;
  if (slot.blockId === BlockId.Bedrock) return;

  const afterTake = adjustSlotCount(state.inventory, slot.id, -1, state.selectedSlot);
  if (!afterTake) return;
  state.inventory = afterTake;
  let replacedUpper: BlockId | null = null;
  if (slot.id === "door") {
    const support = world.get(tx, ty - 1, tz);
    replacedUpper = world.get(tx, ty + 1, tz) as BlockId;
    if (ty + 1 >= world.sizeY || (replacedUpper !== BlockId.Air && replacedUpper !== BlockId.Water) || !world.isSolid(tx, ty - 1, tz) || isDoorBlock(support)) {
      state.inventory = adjustSlotCount(state.inventory, slot.id, 1, state.selectedSlot) ?? state.inventory;
      return;
    }
    const facing = doorFacingFromYaw(state.player.yaw);
    state.blockChanges.set(tx, ty, tz, doorBlock(facing, false, false));
    state.blockChanges.set(tx, ty + 1, tz, doorBlock(facing, false, true));
  } else {
    state.blockChanges.set(tx, ty, tz, slot.blockId);
  }
  if (collidesAt(world, state.player.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT)) {
    state.blockChanges.set(tx, ty, tz, replacedBlock as BlockId);
    if (replacedUpper !== null) state.blockChanges.set(tx, ty + 1, tz, replacedUpper);
    state.inventory = adjustSlotCount(state.inventory, slot.id, 1, state.selectedSlot) ?? state.inventory;
    return;
  }

  // A placed chest gets a fresh, empty block-entity store.
  if (slot.blockId === BlockId.Chest) {
    state.containers.set(
      world.index(tx, ty, tz),
      Array.from({ length: CHEST_SLOTS }, () => createEmptySlot())
    );
  }

  state.worldMeshDirty = true;
  emit({ type: "blockPlaced", blockId: slot.blockId, x: tx, y: ty, z: tz });
}
