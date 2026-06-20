import * as THREE from "three";
import { BlockId, doorBlock, doorState, voxelRaycast } from "@/lib/world";
import {
  BONE_MEAL_CROP_STAGES_MAX,
  BREED_FED_WINDOW_SECONDS,
  CHEST_SLOTS,
  EYE_HEIGHT,
  MINE_REACH,
  SLEEP_ALLOWED_BELOW_DAYLIGHT,
  SLEEP_FADE_SECONDS,
  SLEEP_HOSTILE_RADIUS
} from "@/lib/game/config";
import { adjustSlotCount, consumeToolDurability } from "@/lib/game/inventory";
import { createEmptySlot } from "@/lib/game/items";
import type { MobKind } from "@/lib/game/types";
import type { EmitGameEvent, GameState } from "../state";
import { findAimedMobIndex } from "./combat";
import { fillDungeonChestIfUnlooted } from "./dungeon";
import { primeTnt } from "./explosion";
import { lookDirection } from "./playerMotion";
import { growTreeAt } from "./treeGrowth";

const scratchEye = new THREE.Vector3();
const scratchDir = new THREE.Vector3();

/** Blocks whose right-click runs a handler instead of placing the held block. */
export type InteractiveKind = "bed" | "furnace" | "chest" | "door" | "brewing" | "enchanting";

export const INTERACTIVE_BLOCKS: Partial<Record<BlockId, InteractiveKind>> = {
  [BlockId.Bed]: "bed",
  [BlockId.Furnace]: "furnace",
  [BlockId.BrewingStand]: "brewing",
  [BlockId.EnchantingTable]: "enchanting",
  [BlockId.Chest]: "chest",
  [BlockId.DoorNorthLower]: "door",
  [BlockId.DoorNorthUpper]: "door",
  [BlockId.DoorEastLower]: "door",
  [BlockId.DoorEastUpper]: "door",
  [BlockId.DoorSouthLower]: "door",
  [BlockId.DoorSouthUpper]: "door",
  [BlockId.DoorWestLower]: "door",
  [BlockId.DoorWestUpper]: "door",
  [BlockId.DoorNorthOpenLower]: "door",
  [BlockId.DoorNorthOpenUpper]: "door",
  [BlockId.DoorEastOpenLower]: "door",
  [BlockId.DoorEastOpenUpper]: "door",
  [BlockId.DoorSouthOpenLower]: "door",
  [BlockId.DoorSouthOpenUpper]: "door",
  [BlockId.DoorWestOpenLower]: "door",
  [BlockId.DoorWestOpenUpper]: "door"
};

/**
 * Right-click "use" on the aimed block. Returns true when the click was an
 * interaction (consumed — the caller must NOT then place a block), false when
 * the aimed block has no behavior and placement should proceed.
 *
 * This is the shared hook future interactive blocks (furnace, …) plug into:
 * add a `BlockId → kind` entry and a branch below.
 */
export function tryInteractBlock(state: GameState, emit: EmitGameEvent): boolean {
  const { world, player } = state;
  scratchEye.set(player.position.x, player.position.y + EYE_HEIGHT, player.position.z);
  lookDirection(player.yaw, player.pitch, scratchDir);
  const result = voxelRaycast(world, scratchEye, scratchDir, MINE_REACH);
  if (!result) return false;

  const block = world.get(result.hit.x, result.hit.y, result.hit.z) as BlockId;
  const kind = INTERACTIVE_BLOCKS[block];
  if (!kind) return false;

  if (kind === "bed") return interactBed(state, emit, result.hit.x, result.hit.y, result.hit.z);
  if (kind === "furnace") return interactFurnace(state, emit);
  if (kind === "brewing") return interactBrewingStand(state, emit);
  if (kind === "enchanting") return interactEnchantingTable(state, emit);
  if (kind === "chest") return interactChest(state, emit, result.hit.x, result.hit.y, result.hit.z);
  if (kind === "door") return interactDoor(state, emit, result.hit.x, result.hit.y, result.hit.z);
  return false;
}

function interactDoor(state: GameState, emit: EmitGameEvent, x: number, y: number, z: number): boolean {
  const current = doorState(state.world.get(x, y, z));
  if (!current) return false;
  const lowerY = current.upper ? y - 1 : y;
  const lower = doorState(state.world.get(x, lowerY, z));
  const upper = doorState(state.world.get(x, lowerY + 1, z));
  if (!lower || lower.upper || !upper?.upper || lower.facing !== upper.facing || lower.open !== upper.open) return true;
  state.blockChanges.set(x, lowerY, z, doorBlock(lower.facing, !lower.open, false));
  state.blockChanges.set(x, lowerY + 1, z, doorBlock(lower.facing, !lower.open, true));
  state.worldMeshDirty = true;
  emit({ type: "doorToggled", open: !lower.open });
  return true;
}

/** Opens the chest at (x,y,z) in the inventory panel, creating its (lazy) empty store. */
function interactChest(state: GameState, emit: EmitGameEvent, x: number, y: number, z: number): boolean {
  const idx = state.world.index(x, y, z);
  if (!state.containers.has(idx)) {
    state.containers.set(
      idx,
      Array.from({ length: CHEST_SLOTS }, () => createEmptySlot())
    );
  }
  // A worldgen dungeon chest rolls its loot here, on first open (then never again).
  fillDungeonChestIfUnlooted(state, idx);
  state.openContainerIndex = idx;
  state.inventoryOpen = true;
  emit({ type: "openedContainer" });
  return true;
}

/** What each breedable animal is fed to enter "in love" mode. */
const FEED_ITEMS: Partial<Record<MobKind, string>> = {
  sheep: "wheat",
  horse: "wheat",
  cow: "wheat",
  chicken: "seeds",
  pig: "seeds"
};

/**
 * Right-click an adult animal with its feed item to put it "in love" (toward
 * breeding). First in the right-click precedence so feeding wins over placing or
 * tilling when an animal is in the crosshair. Returns true when an animal was fed.
 */
export function tryFeedAimedMob(state: GameState, emit: EmitGameEvent): boolean {
  const slot = state.inventory[state.selectedSlot];
  if (!slot?.id || slot.count <= 0) return false;
  const index = findAimedMobIndex(state);
  if (index < 0) return false;
  const mob = state.mobs[index];
  if (mob.hostile || FEED_ITEMS[mob.kind] !== slot.id) return false;
  if (mob.ageTimer > 0 || mob.fedTimer > 0) return false; // babies and already-in-love animals decline

  state.inventory = adjustSlotCount(state.inventory, slot.id, -1, state.selectedSlot) ?? state.inventory;
  mob.fedTimer = BREED_FED_WINDOW_SECONDS;
  emit({ type: "mobFed", kind: mob.kind });
  return true;
}

/** Opens the inventory in furnace mode so its smelting recipes unlock. */
function interactFurnace(state: GameState, emit: EmitGameEvent): boolean {
  state.inventoryOpen = true;
  state.craftingStation = "furnace";
  emit({ type: "openedStation", station: "furnace" });
  return true;
}

/** Opens the inventory in brewing mode so its potion recipes unlock. */
function interactBrewingStand(state: GameState, emit: EmitGameEvent): boolean {
  state.inventoryOpen = true;
  state.craftingStation = "brewing";
  emit({ type: "openedStation", station: "brewing" });
  return true;
}

/** Opens the inventory in enchanting mode so the enchanting panel unlocks. */
function interactEnchantingTable(state: GameState, emit: EmitGameEvent): boolean {
  state.inventoryOpen = true;
  state.craftingStation = "enchanting";
  emit({ type: "openedStation", station: "enchanting" });
  return true;
}

/**
 * Right-click a villager to open its trades (the inventory in "villager" station
 * mode, which unlocks the trade offers in the recipe book). Returns true when an
 * aimed villager consumed the click. Runs after feeding in the right-click
 * precedence, but villagers aren't breedable so the two never collide.
 */
export function tryTradeAimedVillager(state: GameState, emit: EmitGameEvent): boolean {
  const index = findAimedMobIndex(state);
  if (index < 0 || state.mobs[index].kind !== "villager") return false;
  state.inventoryOpen = true;
  state.craftingStation = "villager";
  emit({ type: "openedStation", station: "villager" });
  return true;
}

/** Sleep in a bed: only at night, only when no hostile is near. Sets the respawn point. */
function interactBed(state: GameState, emit: EmitGameEvent, x: number, y: number, z: number): boolean {
  if (state.daylight >= SLEEP_ALLOWED_BELOW_DAYLIGHT) {
    emit({ type: "sleepDenied", reason: "daylight" });
    return true;
  }
  for (const mob of state.mobs) {
    if (mob.hostile && mob.position.distanceTo(state.player.position) <= SLEEP_HOSTILE_RADIUS) {
      emit({ type: "sleepDenied", reason: "hostiles" });
      return true;
    }
  }

  state.spawnPoint = { x, y, z };
  state.sleepTimer = SLEEP_FADE_SECONDS;
  emit({ type: "sleepStarted" });
  return true;
}

/**
 * Right-click "use" of the held item on the aimed block: a hoe tills grass/dirt
 * into farmland, seeds plant wheat on farmland. Returns true when an action
 * happened (consumes the click), false to fall through to block placement.
 */
export function tryUseHeldItem(state: GameState, emit: EmitGameEvent, rng: () => number): boolean {
  const slot = state.inventory[state.selectedSlot];
  if (!slot?.id || slot.count <= 0) return false;
  const isHoe = slot.id.endsWith("_hoe");
  const isSeeds = slot.id === "seeds";
  const isTorch = slot.id === "torch";
  const isSapling = slot.id === "sapling";
  const isBoneMeal = slot.id === "bone_meal";
  if (!isHoe && !isSeeds && !isTorch && !isSapling && !isBoneMeal) return false;

  const { world, player } = state;
  scratchEye.set(player.position.x, player.position.y + EYE_HEIGHT, player.position.z);
  lookDirection(player.yaw, player.pitch, scratchDir);
  const result = voxelRaycast(world, scratchEye, scratchDir, MINE_REACH);
  if (!result) return false;
  const { x, y, z } = result.hit;
  const block = world.get(x, y, z) as BlockId;

  // Light TNT with a torch (the torch is not consumed). Only consumes the click
  // when actually aimed at TNT, so a torch otherwise still places normally.
  if (isTorch) {
    if (block !== BlockId.Tnt) return false;
    primeTnt(state, x, y, z, emit);
    return true;
  }

  // Bone meal: fertilize. Instantly grows an aimed sapling into a tree, or
  // advances an immature crop a random 1..MAX stages. Consumes one per use.
  if (isBoneMeal) {
    if (block === BlockId.Sapling) {
      growTreeAt(state, x, y, z, rng);
    } else if (block >= BlockId.WheatStage0 && block <= BlockId.WheatStage2) {
      const next = Math.min(block + 1 + Math.floor(rng() * BONE_MEAL_CROP_STAGES_MAX), BlockId.WheatStage3) as BlockId;
      state.blockChanges.set(x, y, z, next);
      state.worldMeshDirty = true;
    } else {
      return false;
    }
    state.inventory = adjustSlotCount(state.inventory, slot.id, -1, state.selectedSlot) ?? state.inventory;
    emit({ type: "usedBoneMeal" });
    return true;
  }

  if (isHoe) {
    if (block !== BlockId.Grass && block !== BlockId.Dirt) return false;
    state.blockChanges.set(x, y, z, BlockId.Farmland);
    state.inventory = consumeToolDurability(state.inventory, state.selectedSlot, 1, rng) ?? state.inventory;
    state.worldMeshDirty = true;
    emit({ type: "tilledSoil" });
    return true;
  }

  // Sapling: plant on grass/dirt when the cell above is clear. Falls through to
  // normal placement elsewhere, so a sapling stays a placeable block too.
  if (isSapling) {
    if ((block !== BlockId.Grass && block !== BlockId.Dirt) || world.get(x, y + 1, z) !== BlockId.Air) return false;
    state.blockChanges.set(x, y + 1, z, BlockId.Sapling);
    state.inventory = adjustSlotCount(state.inventory, slot.id, -1, state.selectedSlot) ?? state.inventory;
    state.worldMeshDirty = true;
    emit({ type: "plantedSapling" });
    return true;
  }

  // Seeds: plant on farmland when the cell above is clear.
  if (block !== BlockId.Farmland || world.get(x, y + 1, z) !== BlockId.Air) return false;
  state.blockChanges.set(x, y + 1, z, BlockId.WheatStage0);
  state.inventory = adjustSlotCount(state.inventory, slot.id, -1, state.selectedSlot) ?? state.inventory;
  state.worldMeshDirty = true;
  emit({ type: "plantedSeed" });
  return true;
}
