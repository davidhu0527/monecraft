import * as THREE from "three";
import { BlockId, collidesAt, voxelRaycast } from "@/lib/world";
import { BARE_HAND_MINE_POWER, EYE_HEIGHT, MINE_REACH, MINING_RATE, PLAYER_HALF_WIDTH, PLAYER_HEIGHT } from "@/lib/game/config";
import { BLOCK_TO_SLOT, BREAK_HARDNESS } from "@/lib/game/items";
import { adjustSlotCount, consumeToolDurability } from "@/lib/game/inventory";
import type { FrameInput, GameState } from "../state";
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

function addBlockDrop(state: GameState, block: BlockId): void {
  const slotId = BLOCK_TO_SLOT[block];
  if (!slotId) return;
  state.inventory = adjustSlotCount(state.inventory, slotId, 1) ?? state.inventory;
}

/** Advances mining progress while the mouse is held; breaks the block at full progress. */
export function tickMining(state: GameState, input: FrameInput, dt: number): void {
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

  state.blockChanges.set(bx, by, bz, BlockId.Air);
  if (tool) state.inventory = consumeToolDurability(state.inventory, state.selectedSlot, 1) ?? state.inventory;
  addBlockDrop(state, targetBlock as BlockId);
  state.worldMeshDirty = true;
  resetMining(state);
}

/** Places the selected block against the targeted face, refusing self-entombment. */
export function placeSelectedBlock(state: GameState): void {
  const { world } = state;
  const origin = eyePosition(state, scratchEye);
  const direction = lookDirection(state.player.yaw, state.player.pitch, scratchDir);
  const result = voxelRaycast(world, origin, direction, MINE_REACH);
  if (!result) return;

  const tx = result.previous.x;
  const ty = result.previous.y;
  const tz = result.previous.z;
  if (!world.inBounds(tx, ty, tz) || world.get(tx, ty, tz) !== BlockId.Air) return;

  const slot = state.inventory[state.selectedSlot];
  if (!slot || !slot.id || slot.kind !== "block" || slot.count <= 0 || slot.blockId === undefined) return;
  if (slot.blockId === BlockId.Bedrock) return;

  const afterTake = adjustSlotCount(state.inventory, slot.id, -1, state.selectedSlot);
  if (!afterTake) return;
  state.inventory = afterTake;
  state.blockChanges.set(tx, ty, tz, slot.blockId);
  if (collidesAt(world, state.player.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT)) {
    state.blockChanges.set(tx, ty, tz, BlockId.Air);
    state.inventory = adjustSlotCount(state.inventory, slot.id, 1, state.selectedSlot) ?? state.inventory;
    return;
  }

  state.worldMeshDirty = true;
}
