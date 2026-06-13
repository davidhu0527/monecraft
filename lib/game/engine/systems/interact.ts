import * as THREE from "three";
import { BlockId, voxelRaycast } from "@/lib/world";
import {
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
import { lookDirection } from "./playerMotion";

const scratchEye = new THREE.Vector3();
const scratchDir = new THREE.Vector3();

/** Blocks whose right-click runs a handler instead of placing the held block. */
export type InteractiveKind = "bed" | "furnace" | "chest";

export const INTERACTIVE_BLOCKS: Partial<Record<BlockId, InteractiveKind>> = {
  [BlockId.Bed]: "bed",
  [BlockId.Furnace]: "furnace",
  [BlockId.Chest]: "chest"
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
  if (kind === "chest") return interactChest(state, emit, result.hit.x, result.hit.y, result.hit.z);
  return false;
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
  state.openContainerIndex = idx;
  state.inventoryOpen = true;
  emit({ type: "openedContainer" });
  return true;
}

/** What each breedable animal is fed to enter "in love" mode. */
const FEED_ITEMS: Partial<Record<MobKind, string>> = {
  sheep: "wheat",
  horse: "wheat",
  chicken: "seeds"
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
  void rng; // reserved for future randomized uses (bone meal, …)
  const slot = state.inventory[state.selectedSlot];
  if (!slot?.id || slot.count <= 0) return false;
  const isHoe = slot.id.endsWith("_hoe");
  const isSeeds = slot.id === "seeds";
  if (!isHoe && !isSeeds) return false;

  const { world, player } = state;
  scratchEye.set(player.position.x, player.position.y + EYE_HEIGHT, player.position.z);
  lookDirection(player.yaw, player.pitch, scratchDir);
  const result = voxelRaycast(world, scratchEye, scratchDir, MINE_REACH);
  if (!result) return false;
  const { x, y, z } = result.hit;
  const block = world.get(x, y, z) as BlockId;

  if (isHoe) {
    if (block !== BlockId.Grass && block !== BlockId.Dirt) return false;
    state.blockChanges.set(x, y, z, BlockId.Farmland);
    state.inventory = consumeToolDurability(state.inventory, state.selectedSlot, 1) ?? state.inventory;
    state.worldMeshDirty = true;
    emit({ type: "tilledSoil" });
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
