import * as THREE from "three";
import {
  BlockId,
  collidesAt,
  doorBlock,
  doorFacingFromYaw,
  doorState,
  isDoorBlock,
  isPartialBlock,
  isRailBlock,
  isRedstoneBlock,
  isRedstoneOverlay,
  isStairBlock,
  orientStair,
  voxelRaycast
} from "@/lib/world";
import { BARE_HAND_MINE_POWER, CHEST_SLOTS, EYE_HEIGHT, MINE_REACH, MINING_RATE, PLAYER_HALF_WIDTH, PLAYER_HEIGHT } from "@/lib/game/config";
import { BREAK_HARDNESS, createEmptySlot, rollBlockDrops } from "@/lib/game/items";
import { adjustSlotCount, consumeToolDurability, tryInsertSlots } from "@/lib/game/inventory";
import { canEditBlocks, freeBuild } from "@/lib/game/gameModes";
import type { EmitGameEvent, FrameInput, GameState, PlayerState } from "../state";
import { efficiencyMultiplier, fortuneLevel } from "@/lib/game/enchantments";
import { fillWorldgenChestIfUnlooted } from "./dungeon";
import { clearAttachedPortal } from "./portal";
import { lookDirection } from "./playerMotion";
import { awardXp, xpForBlock } from "./xp";
import { hasteMultiplier } from "./statusEffects";
import { trackRedstoneCell } from "./redstone";
import type { InventorySlot } from "@/lib/game/types";

const scratchEye = new THREE.Vector3();
const scratchDir = new THREE.Vector3();

function eyePosition(player: PlayerState, out: THREE.Vector3): THREE.Vector3 {
  const { position } = player;
  return out.set(position.x, position.y + EYE_HEIGHT, position.z);
}

export function selectedTool(player: PlayerState): InventorySlot | null {
  const slot = player.inventory[player.selectedSlot];
  return slot?.kind === "tool" && slot.count > 0 ? slot : null;
}

export function canMineBlock(block: BlockId, toolTier: number): boolean {
  if (block === BlockId.Stone || block === BlockId.Cobblestone || block === BlockId.Brick) return toolTier >= 1;
  if (block === BlockId.CoalOre) return toolTier >= 1;
  if (block === BlockId.SliverOre) return toolTier >= 2;
  if (block === BlockId.RubyOre) return toolTier >= 3;
  if (block === BlockId.GoldOre) return toolTier >= 3;
  if (block === BlockId.SapphireOre) return toolTier >= 4;
  if (block === BlockId.DiamondOre) return toolTier >= 4;
  // Obsidian yields only to the top pickaxe tier (diamond, mineTier 7).
  if (block === BlockId.Obsidian) return toolTier >= 7;
  // Nether rock needs any pickaxe; its deep ore is diamond-gated like obsidian.
  if (block === BlockId.Netherrack) return toolTier >= 1;
  if (block === BlockId.BlaziteOre) return toolTier >= 7;
  return true;
}

export function miningSpeed(tool: InventorySlot | null): number {
  return (tool?.minePower ?? BARE_HAND_MINE_POWER) * efficiencyMultiplier(tool);
}

export function resetMining(player: PlayerState): void {
  player.mining.targetKey = "";
  player.mining.progress = 0;
}

function addBlockDrop(player: PlayerState, block: BlockId, rng: () => number, tool: InventorySlot | null): void {
  for (const drop of rollBlockDrops(block, rng, fortuneLevel(tool))) {
    player.inventory = adjustSlotCount(player.inventory, drop.itemId, drop.count) ?? player.inventory;
  }
}

/**
 * Empties a broken chest into the inventory. Returns true if the break may
 * proceed (the chest was empty, or its contents all fit), false to refuse it
 * (no room — the chest is left intact). On success the container entry is
 * removed and a pickedUp toast announces what was retrieved.
 */
function spillChestOnBreak(state: GameState, player: PlayerState, idx: number, emit: EmitGameEvent): boolean {
  // Breaking an unopened worldgen chest still pays out its loot.
  fillWorldgenChestIfUnlooted(state, idx, emit);
  const container = state.containers.get(idx);
  const items = container?.filter((slot) => slot.id && slot.count > 0) ?? [];
  if (items.length > 0) {
    const merged = tryInsertSlots(player.inventory, items);
    if (!merged) {
      emit({ type: "breakBlocked", reason: "containerFull" });
      return false;
    }
    player.inventory = merged;
    const picked = new Map<string, number>();
    for (const slot of items) picked.set(slot.id!, (picked.get(slot.id!) ?? 0) + slot.count);
    emit({ type: "pickedUp", items: [...picked].map(([itemId, count]) => ({ itemId, count })) });
  }
  state.containers.delete(idx);
  return true;
}

/**
 * Advances mining progress while the mouse is held; breaks the block at full
 * progress. The `authority` mode shapes what a full crack does:
 * - `"full"` (default, single-player and the server): the real break — block,
 *   drops, XP, tool wear, chest spill.
 * - `"cosmetic"`: accrues progress for the crack overlay but never commits —
 *   the server's blockBroken event does (retained for chests on a replica).
 * - `"predict"` (a multiplayer replica): commits a REDUCED break the moment
 *   the crack completes — the block write (relight + remesh ride the
 *   chokepoint) and the blockBroken emit for instant sound/particles, but NO
 *   drops/XP/durability (those stay server-owned and arrive on the deltas).
 *   Chests fall back to cosmetic: their spill is too entangled with
 *   server-owned containers, and a delayed chest break is honest. The caller
 *   captures the written cells for its prediction ledger.
 */
export function tickMining(
  state: GameState,
  player: PlayerState,
  input: FrameInput,
  dt: number,
  emit: EmitGameEvent,
  rng: () => number,
  opts: { authority?: "full" | "cosmetic" | "predict" } = {}
): void {
  if (!input.mineHeld) {
    // Releasing the button abandons progress (matching the crack overlay).
    if (player.mining.progress > 0) resetMining(player);
    return;
  }
  if (player.inventoryOpen || player.isDead) return;
  // Adventure and Spectator can't break terrain.
  if (!canEditBlocks(player.gameMode)) {
    resetMining(player);
    return;
  }

  const { world } = state;
  const { mining } = player;
  const origin = eyePosition(player, scratchEye);
  const direction = lookDirection(player.yaw, player.pitch, scratchDir);
  const result = voxelRaycast(world, origin, direction, MINE_REACH);
  if (!result) {
    resetMining(player);
    return;
  }

  const bx = result.hit.x;
  const by = result.hit.y;
  const bz = result.hit.z;
  const targetBlock = world.get(bx, by, bz);
  const tool = selectedTool(player);
  const tier = tool?.mineTier ?? 0;
  // Creative breaks anything (bar bedrock) instantly, regardless of tool tier.
  const creative = freeBuild(player.gameMode);

  if (targetBlock === BlockId.Bedrock || targetBlock === BlockId.Air || (!creative && !canMineBlock(targetBlock as BlockId, tier))) {
    resetMining(player);
    return;
  }

  const key = `${bx},${by},${bz}`;
  if (mining.targetKey !== key) {
    mining.targetKey = key;
    mining.progress = 0;
  }

  const authority = opts.authority ?? "full";
  // Chests are never predicted — hold at the final crack stage like cosmetic.
  const holdShort = authority === "cosmetic" || (authority === "predict" && targetBlock === BlockId.Chest);
  if (!creative) {
    const hardness = BREAK_HARDNESS[targetBlock as BlockId] ?? 2;
    mining.progress += dt * miningSpeed(tool) * MINING_RATE * hasteMultiplier(player);
    // A replica shows the final crack stage and waits for the server's break.
    if (holdShort) {
      mining.progress = Math.min(mining.progress, hardness * 0.99);
      return;
    }
    if (mining.progress < hardness) return;
  } else if (holdShort) {
    return; // creative replica chest / cosmetic: even the instant break is the server's call
  }
  const predict = authority === "predict";

  // Breaking a chest empties it into the inventory first; if it does not all
  // fit, refuse the break so nothing is lost (the chest stays intact). Creative
  // breaks for free — the chest and its contents just vanish (no spill, no refusal).
  const chestIndex = targetBlock === BlockId.Chest ? world.index(bx, by, bz) : null;
  if (chestIndex !== null) {
    if (creative) state.containers.delete(chestIndex);
    else if (!spillChestOnBreak(state, player, chestIndex, emit)) {
      resetMining(player);
      return;
    }
  }

  if (isDoorBlock(targetBlock)) {
    const door = doorState(targetBlock)!;
    const other = doorState(world.get(bx, door.upper ? by - 1 : by + 1, bz));
    state.blockChanges.set(bx, by, bz, BlockId.Air);
    if (other && other.upper !== door.upper) {
      state.blockChanges.set(bx, door.upper ? by - 1 : by + 1, bz, BlockId.Air);
    }
  } else if (targetBlock === BlockId.Kelp) {
    // Breaking a kelp cell breaks the whole stalk above it (each cell drops),
    // and a submerged stalk refills with water — never air — so harvesting
    // doesn't leave air pockets in the ocean. The targeted cell's own drop
    // rides the shared addBlockDrop call below.
    let top = by;
    while (world.get(bx, top + 1, bz) === BlockId.Kelp) top += 1;
    const fill = world.get(bx, top + 1, bz) === BlockId.Water ? BlockId.Water : BlockId.Air;
    for (let y = by; y <= top; y += 1) {
      state.blockChanges.set(bx, y, bz, fill);
      if (!creative && !predict && y > by) addBlockDrop(player, BlockId.Kelp, rng, tool);
    }
  } else {
    state.blockChanges.set(bx, by, bz, BlockId.Air);
    // Breaking a frame block de-frames its portal: the attached surface
    // flood-clears so a lit portal can never outlive its obsidian.
    if (targetBlock === BlockId.Obsidian) clearAttachedPortal(state, bx, by, bz);
    // A redstone overlay (wire, lever, …) or rail standing on the broken block
    // pops off with it and drops its item to the miner (the kelp-cascade rule).
    const above = world.get(bx, by + 1, bz) as BlockId;
    if (isRedstoneOverlay(above) || isRailBlock(above)) {
      state.blockChanges.set(bx, by + 1, bz, BlockId.Air);
      if (!creative && !predict) addBlockDrop(player, above, rng, tool);
    }
  }
  // Creative breaks for free: no tool wear, no drops, no XP. A predicted
  // break skips them too — the server owns them and its deltas deliver.
  if (tool && !creative && !predict) player.inventory = consumeToolDurability(player.inventory, player.selectedSlot, 1, rng) ?? player.inventory;
  if (!creative && !predict) {
    addBlockDrop(player, targetBlock as BlockId, rng, tool); // Fortune on the tool multiplies ore drops
    awardXp(player, xpForBlock(targetBlock as BlockId), emit); // ore blocks grant XP; everything else is 0
  }
  state.worldMeshDirty = true;
  resetMining(player);
  emit({ type: "blockBroken", blockId: targetBlock as BlockId, x: bx, y: by, z: bz });
}

/** Places the selected block against the targeted face, refusing self-entombment. */
export function placeSelectedBlock(state: GameState, player: PlayerState, emit: EmitGameEvent): void {
  if (!canEditBlocks(player.gameMode)) return; // Adventure and Spectator can't place
  const { world } = state;
  const origin = eyePosition(player, scratchEye);
  const direction = lookDirection(player.yaw, player.pitch, scratchDir);
  const result = voxelRaycast(world, origin, direction, MINE_REACH);
  if (!result) return;

  const tx = result.previous.x;
  const ty = result.previous.y;
  const tz = result.previous.z;
  if (!world.inBounds(tx, ty, tz)) return;
  const replacedBlock = world.get(tx, ty, tz);
  if (replacedBlock !== BlockId.Air && replacedBlock !== BlockId.Water) return;

  const slot = player.inventory[player.selectedSlot];
  if (!slot || !slot.id || slot.kind !== "block" || slot.count <= 0 || slot.blockId === undefined) return;
  if (slot.blockId === BlockId.Bedrock) return;

  // Creative builds without spending the held stack (so no take, no refund).
  const consume = !freeBuild(player.gameMode);
  if (consume) {
    const afterTake = adjustSlotCount(player.inventory, slot.id, -1, player.selectedSlot);
    if (!afterTake) return;
    player.inventory = afterTake;
  }
  let replacedUpper: BlockId | null = null;
  if (slot.id === "door") {
    const support = world.get(tx, ty - 1, tz);
    replacedUpper = world.get(tx, ty + 1, tz) as BlockId;
    if (
      ty + 1 >= world.sizeY ||
      (replacedUpper !== BlockId.Air && replacedUpper !== BlockId.Water) ||
      !world.isSolid(tx, ty - 1, tz) ||
      isDoorBlock(support) ||
      isPartialBlock(support)
    ) {
      if (consume) player.inventory = adjustSlotCount(player.inventory, slot.id, 1, player.selectedSlot) ?? player.inventory;
      return;
    }
    const facing = doorFacingFromYaw(player.yaw);
    state.blockChanges.set(tx, ty, tz, doorBlock(facing, false, false));
    state.blockChanges.set(tx, ty + 1, tz, doorBlock(facing, false, true));
  } else {
    // Redstone overlays and rails are floor-mounted: they need a solid,
    // FULL-cube block under them (the door support rule — a slab's half-height
    // top or another overlay would leave them floating) or the placement refunds.
    if (isRedstoneOverlay(slot.blockId) || isRailBlock(slot.blockId)) {
      const support = world.get(tx, ty - 1, tz);
      if (!world.isSolid(tx, ty - 1, tz) || isRedstoneOverlay(support) || isDoorBlock(support) || isRailBlock(support) || isPartialBlock(support)) {
        if (consume) player.inventory = adjustSlotCount(player.inventory, slot.id, 1, player.selectedSlot) ?? player.inventory;
        return;
      }
    }
    // A stair item carries its north id; the placed block faces the way the
    // player looks (raised back away from them — walk straight up it).
    const placed = isStairBlock(slot.blockId) ? orientStair(slot.blockId, doorFacingFromYaw(player.yaw)) : slot.blockId;
    state.blockChanges.set(tx, ty, tz, placed);
  }
  if (collidesAt(world, player.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT)) {
    state.blockChanges.set(tx, ty, tz, replacedBlock as BlockId);
    if (replacedUpper !== null) state.blockChanges.set(tx, ty + 1, tz, replacedUpper);
    if (consume) player.inventory = adjustSlotCount(player.inventory, slot.id, 1, player.selectedSlot) ?? player.inventory;
    return;
  }

  // A placed chest gets a fresh, empty block-entity store.
  if (slot.blockId === BlockId.Chest) {
    state.containers.set(
      world.index(tx, ty, tz),
      Array.from({ length: CHEST_SLOTS }, () => createEmptySlot())
    );
  }
  // A placed redstone component (lamp included) or rail joins the tracked set
  // so the power pass sees it; removals self-heal, so placement is the only seam.
  if (isRedstoneBlock(slot.blockId) || isRailBlock(slot.blockId)) trackRedstoneCell(state, tx, ty, tz);

  state.worldMeshDirty = true;
  emit({ type: "blockPlaced", blockId: slot.blockId, x: tx, y: ty, z: tz });
}
