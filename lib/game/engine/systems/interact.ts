import * as THREE from "three";
import { BlockId, collidesAt, doorBlock, doorState, voxelRaycast, waterSurfaceRaycast } from "@/lib/world";
import {
  BONE_MEAL_CROP_STAGES_MAX,
  BREED_FED_WINDOW_SECONDS,
  CHEST_SLOTS,
  EYE_HEIGHT,
  MINE_REACH,
  PET_FIGHT_RANGE,
  PET_TAMED_HP,
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT,
  SLEEP_ALLOWED_BELOW_DAYLIGHT,
  SLEEP_FADE_SECONDS,
  SLEEP_HOSTILE_RADIUS,
  TAME_CHANCE
} from "@/lib/game/config";
import { adjustSlotCount, consumeToolDurability, countsById } from "@/lib/game/inventory";
import { createEmptySlot, createSlot } from "@/lib/game/items";
import type { MobKind } from "@/lib/game/types";
import type { EmitGameEvent, GameState, PlayerState } from "../state";
import { allEligiblePlayersSleeping } from "../players";
import { findAimedMobIndex } from "./combat";
import { fillWorldgenChestIfUnlooted } from "./dungeon";
import { primeTnt } from "./explosion";
import { lookDirection } from "./playerMotion";
import { pressButton, toggleLever } from "./redstone";
import { growTreeAt } from "./treeGrowth";

const scratchEye = new THREE.Vector3();
const scratchDir = new THREE.Vector3();

/** Blocks whose right-click runs a handler instead of placing the held block. */
export type InteractiveKind = "bed" | "furnace" | "chest" | "door" | "brewing" | "enchanting" | "anvil" | "grindstone" | "lever" | "button";

export const INTERACTIVE_BLOCKS: Partial<Record<BlockId, InteractiveKind>> = {
  [BlockId.Bed]: "bed",
  [BlockId.Furnace]: "furnace",
  [BlockId.BrewingStand]: "brewing",
  [BlockId.EnchantingTable]: "enchanting",
  [BlockId.Anvil]: "anvil",
  [BlockId.Grindstone]: "grindstone",
  [BlockId.Chest]: "chest",
  [BlockId.Lever]: "lever",
  [BlockId.LeverOn]: "lever",
  [BlockId.RedstoneButton]: "button",
  [BlockId.RedstoneButtonOn]: "button",
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
export function tryInteractBlock(state: GameState, player: PlayerState, emit: EmitGameEvent): boolean {
  const { world } = state;
  scratchEye.set(player.position.x, player.position.y + EYE_HEIGHT, player.position.z);
  lookDirection(player.yaw, player.pitch, scratchDir);
  const result = voxelRaycast(world, scratchEye, scratchDir, MINE_REACH);
  if (!result) return false;

  const block = world.get(result.hit.x, result.hit.y, result.hit.z) as BlockId;
  const kind = INTERACTIVE_BLOCKS[block];
  if (!kind) return false;

  if (kind === "bed") return interactBed(state, player, emit, result.hit.x, result.hit.y, result.hit.z);
  if (kind === "furnace") return interactFurnace(player, emit);
  if (kind === "brewing") return interactBrewingStand(player, emit);
  if (kind === "enchanting") return interactEnchantingTable(player, emit);
  if (kind === "anvil") return interactAnvil(player, emit);
  if (kind === "grindstone") return interactGrindstone(player, emit);
  if (kind === "chest") return interactChest(state, player, emit, result.hit.x, result.hit.y, result.hit.z);
  if (kind === "door") return interactDoor(state, emit, result.hit.x, result.hit.y, result.hit.z);
  if (kind === "lever") return toggleLever(state, emit, result.hit.x, result.hit.y, result.hit.z);
  if (kind === "button") return pressButton(state, emit, result.hit.x, result.hit.y, result.hit.z);
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
function interactChest(state: GameState, player: PlayerState, emit: EmitGameEvent, x: number, y: number, z: number): boolean {
  const idx = state.world.index(x, y, z);
  if (!state.containers.has(idx)) {
    state.containers.set(
      idx,
      Array.from({ length: CHEST_SLOTS }, () => createEmptySlot())
    );
  }
  // A worldgen chest (dungeon/shipwreck/buried) rolls its loot here, on first open (then never again).
  fillWorldgenChestIfUnlooted(state, idx, emit);
  player.openContainerIndex = idx;
  player.inventoryOpen = true;
  emit({ type: "openedContainer" });
  return true;
}

/** What each breedable animal is fed to enter "in love" mode (pets only breed once owned). */
const FEED_ITEMS: Partial<Record<MobKind, string>> = {
  sheep: "wheat",
  horse: "wheat",
  cow: "wheat",
  chicken: "seeds",
  pig: "seeds",
  wolf: "bone",
  cat: "raw_fish"
};

/** What item tames each wild companion. Both ids exist in ITEM_DEFS already. */
const TAME_ITEMS: Partial<Record<MobKind, string>> = {
  wolf: "bone",
  cat: "raw_fish"
};

/**
 * Right-click an adult animal with its feed item to put it "in love" (toward
 * breeding). First in the right-click precedence so feeding wins over placing or
 * tilling when an animal is in the crosshair. Returns true when an animal was fed.
 */
export function tryFeedAimedMob(state: GameState, player: PlayerState, emit: EmitGameEvent): boolean {
  const slot = player.inventory[player.selectedSlot];
  if (!slot?.id || slot.count <= 0) return false;
  const index = findAimedMobIndex(state, player);
  if (index < 0) return false;
  const mob = state.mobs[index];
  if (mob.hostile || FEED_ITEMS[mob.kind] !== slot.id) return false;
  // A tameable kind only breeds once owned — a wild one is tamed (handled earlier
  // in the precedence), never put "in love".
  if (TAME_ITEMS[mob.kind] !== undefined && mob.owner == null) return false;
  if (mob.ageTimer > 0 || mob.fedTimer > 0) return false; // babies and already-in-love animals decline

  player.inventory = adjustSlotCount(player.inventory, slot.id, -1, player.selectedSlot) ?? player.inventory;
  mob.fedTimer = BREED_FED_WINDOW_SECONDS;
  emit({ type: "mobFed", kind: mob.kind });
  return true;
}

/**
 * Right-click a WILD wolf/cat holding its treat (bone / raw fish) to attempt to
 * tame it. The treat is consumed whether or not the TAME_CHANCE roll succeeds (as
 * in Minecraft); on success the mob becomes an owned "ally" with boosted hp and an
 * enemy-detect range so it fights for the player. Runs before feeding/breeding in
 * the precedence so a bone tames a wild wolf rather than (no-op) feeding it.
 */
export function tryTameAimedMob(state: GameState, player: PlayerState, emit: EmitGameEvent, rng: () => number): boolean {
  const slot = player.inventory[player.selectedSlot];
  if (!slot?.id || slot.count <= 0) return false;
  const index = findAimedMobIndex(state, player);
  if (index < 0) return false;
  const mob = state.mobs[index];
  if (mob.owner != null || TAME_ITEMS[mob.kind] !== slot.id) return false;

  player.inventory = adjustSlotCount(player.inventory, slot.id, -1, player.selectedSlot) ?? player.inventory;
  if (rng() < TAME_CHANCE) {
    mob.owner = player.id;
    mob.faction = "ally";
    mob.hp = PET_TAMED_HP;
    mob.detectRange = PET_FIGHT_RANGE;
    emit({ type: "mobTamed", kind: mob.kind, x: mob.position.x, y: mob.position.y, z: mob.position.z });
  }
  return true; // the treat is eaten either way
}

/**
 * Right-click your OWN pet (with anything that isn't its breeding treat) to toggle
 * its sit/stay. A sitting pet stays put — it won't follow, wander, or fight. Runs
 * after taming and feeding, so a treat still tames a wild one / breeds an owned one.
 */
export function tryToggleSitPet(state: GameState, player: PlayerState, emit: EmitGameEvent): boolean {
  const index = findAimedMobIndex(state, player);
  if (index < 0) return false;
  const mob = state.mobs[index];
  if (mob.owner == null) return false; // only your own pet
  // Holding the pet's breeding treat means "breed", not "sit" — so a feed that was
  // declined (a baby, or one already in love) doesn't fall through and flip sitting.
  const slot = player.inventory[player.selectedSlot];
  if (slot?.id && FEED_ITEMS[mob.kind] === slot.id) return false;
  mob.sitting = !mob.sitting;
  emit({ type: "petSitToggled", kind: mob.kind, sitting: mob.sitting === true });
  return true;
}

/** Opens the inventory in furnace mode so its smelting recipes unlock. */
function interactFurnace(player: PlayerState, emit: EmitGameEvent): boolean {
  player.inventoryOpen = true;
  player.craftingStation = "furnace";
  emit({ type: "openedStation", station: "furnace" });
  return true;
}

/** Opens the inventory in brewing mode so its potion recipes unlock. */
function interactBrewingStand(player: PlayerState, emit: EmitGameEvent): boolean {
  player.inventoryOpen = true;
  player.craftingStation = "brewing";
  emit({ type: "openedStation", station: "brewing" });
  return true;
}

/** Opens the inventory in enchanting mode so the enchanting panel unlocks. */
function interactEnchantingTable(player: PlayerState, emit: EmitGameEvent): boolean {
  player.inventoryOpen = true;
  player.craftingStation = "enchanting";
  emit({ type: "openedStation", station: "enchanting" });
  return true;
}

/** Opens the inventory in anvil mode so the repair/combine/rename panel unlocks. */
function interactAnvil(player: PlayerState, emit: EmitGameEvent): boolean {
  player.inventoryOpen = true;
  player.craftingStation = "anvil";
  emit({ type: "openedStation", station: "anvil" });
  return true;
}

/** Opens the inventory in grindstone mode so the disenchant panel unlocks. */
function interactGrindstone(player: PlayerState, emit: EmitGameEvent): boolean {
  player.inventoryOpen = true;
  player.craftingStation = "grindstone";
  emit({ type: "openedStation", station: "grindstone" });
  return true;
}

/**
 * Right-click a villager to open its trades (the inventory in "villager" station
 * mode, which unlocks the trade offers in the recipe book). Returns true when an
 * aimed villager consumed the click. Runs after feeding in the right-click
 * precedence, but villagers aren't breedable so the two never collide.
 */
export function tryTradeAimedVillager(state: GameState, player: PlayerState, emit: EmitGameEvent): boolean {
  const index = findAimedMobIndex(state, player);
  const mob = index < 0 ? null : state.mobs[index];
  if (!mob || mob.kind !== "villager") return false;
  player.inventoryOpen = true;
  player.craftingStation = "villager";
  // The open villager's profession filters the Trading panel to its offers and
  // gates which trades the craft command will accept.
  player.activeVillagerProfession = mob.profession ?? null;
  emit({ type: "openedStation", station: "villager" });
  return true;
}

/** Sleep in a bed: only at night, only when no hostile is near. Sets the respawn point. */
function interactBed(state: GameState, player: PlayerState, emit: EmitGameEvent, x: number, y: number, z: number): boolean {
  if (state.daylight >= SLEEP_ALLOWED_BELOW_DAYLIGHT) {
    emit({ type: "sleepDenied", reason: "daylight" });
    return true;
  }
  for (const mob of state.mobs) {
    if (mob.hostile && mob.position.distanceTo(player.position) <= SLEEP_HOSTILE_RADIUS) {
      emit({ type: "sleepDenied", reason: "hostiles" });
      return true;
    }
  }

  player.spawnPoint = { x, y, z };
  // Into bed; the fade (and the night skip) only engages once EVERY eligible
  // player sleeps — single-player: immediately, exactly the old behavior.
  player.sleeping = true;
  if (allEligiblePlayersSleeping(state)) state.sleepTimer = SLEEP_FADE_SECONDS;
  emit({ type: "sleepStarted" });
  return true;
}

/**
 * Swaps one unit of the held item for `resultId` (the bucket fill/empty trade).
 * When the hand empties, the result lands right back in it; otherwise it joins
 * the inventory wherever it fits. Returns false — no change — when it can't fit.
 */
function swapHeldForItem(player: PlayerState, resultId: string): boolean {
  const slot = player.inventory[player.selectedSlot];
  if (!slot?.id) return false;
  const removed = adjustSlotCount(player.inventory, slot.id, -1, player.selectedSlot);
  if (!removed) return false;
  const hand = removed[player.selectedSlot];
  if (hand.id === null) {
    removed[player.selectedSlot] = createSlot(resultId, 1);
    player.inventory = removed;
    return true;
  }
  // The hand still holds a stack, so the result must fit elsewhere. Positive
  // adjustSlotCount is best-effort — verify the count actually grew.
  const added = adjustSlotCount(removed, resultId, 1);
  if (!added || (countsById(added).get(resultId) ?? 0) !== (countsById(removed).get(resultId) ?? 0) + 1) return false;
  player.inventory = added;
  return true;
}

/**
 * Right-click "use" of the held item on the aimed block: a hoe tills grass/dirt
 * into farmland, seeds plant wheat on farmland, buckets scoop and pour fluids.
 * Returns true when an action happened (consumes the click), false to fall
 * through to block placement.
 */
export function tryUseHeldItem(state: GameState, player: PlayerState, emit: EmitGameEvent, rng: () => number): boolean {
  const slot = player.inventory[player.selectedSlot];
  if (!slot?.id || slot.count <= 0) return false;
  const isHoe = slot.id.endsWith("_hoe");
  const isSeeds = slot.id === "seeds";
  const isTorch = slot.id === "torch";
  const isSapling = slot.id === "sapling";
  const isBoneMeal = slot.id === "bone_meal";
  const isBucket = slot.id === "bucket";
  const isWaterBucket = slot.id === "water_bucket";
  const isLavaBucket = slot.id === "lava_bucket";
  if (!isHoe && !isSeeds && !isTorch && !isSapling && !isBoneMeal && !isBucket && !isWaterBucket && !isLavaBucket) return false;

  const { world } = state;
  scratchEye.set(player.position.x, player.position.y + EYE_HEIGHT, player.position.z);
  lookDirection(player.yaw, player.pitch, scratchDir);
  const result = voxelRaycast(world, scratchEye, scratchDir, MINE_REACH);

  // Empty bucket: scoop the aimed fluid up — its cell becomes air. There is no
  // flow simulation, so the scooped hole simply remains (even mid-ocean). Runs
  // before the solid-hit guard: aiming at open water yields no solid hit at all.
  if (isBucket) {
    // Lava is solid, so the normal raycast hits it directly.
    if (result && world.get(result.hit.x, result.hit.y, result.hit.z) === BlockId.Lava) {
      if (!swapHeldForItem(player, "lava_bucket")) return false;
      state.blockChanges.set(result.hit.x, result.hit.y, result.hit.z, BlockId.Air);
      state.worldMeshDirty = true;
      emit({ type: "bucketFilled", fluid: "lava" });
      return true;
    }
    // Water is passed through by the solid raycast (it treats water as empty),
    // so aim at the water surface the fishing-bobber way.
    const water = waterSurfaceRaycast(world, scratchEye, scratchDir, MINE_REACH);
    if (!water) return false;
    if (!swapHeldForItem(player, "water_bucket")) return false;
    state.blockChanges.set(water.x, water.y, water.z, BlockId.Air);
    state.worldMeshDirty = true;
    emit({ type: "bucketFilled", fluid: "water" });
    return true;
  }

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

  // Water poured ON a lava block quenches it into obsidian — the game's only
  // obsidian source. The cell keeps its place in the world; only the block
  // (and its max-light emission, via applyEdit) changes.
  if (isWaterBucket && block === BlockId.Lava) {
    if (!swapHeldForItem(player, "bucket")) return false;
    state.blockChanges.set(x, y, z, BlockId.Obsidian);
    state.worldMeshDirty = true;
    emit({ type: "lavaSolidified" });
    return true;
  }

  // Filled bucket: pour into the empty cell in front of the aimed face. Lava is
  // a solid block, so a pour that would entomb the player rolls back (the
  // placeSelectedBlock rule); the click is still consumed.
  if (isWaterBucket || isLavaBucket) {
    const px = result.previous.x;
    const py = result.previous.y;
    const pz = result.previous.z;
    if (!world.inBounds(px, py, pz) || world.get(px, py, pz) !== BlockId.Air) return false;
    state.blockChanges.set(px, py, pz, isWaterBucket ? BlockId.Water : BlockId.Lava);
    if (collidesAt(world, player.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT)) {
      state.blockChanges.set(px, py, pz, BlockId.Air);
      return true;
    }
    if (!swapHeldForItem(player, "bucket")) {
      state.blockChanges.set(px, py, pz, BlockId.Air);
      return false;
    }
    state.worldMeshDirty = true;
    emit({ type: "bucketEmptied", fluid: isWaterBucket ? "water" : "lava" });
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
    player.inventory = adjustSlotCount(player.inventory, slot.id, -1, player.selectedSlot) ?? player.inventory;
    emit({ type: "usedBoneMeal" });
    return true;
  }

  if (isHoe) {
    if (block !== BlockId.Grass && block !== BlockId.Dirt) return false;
    state.blockChanges.set(x, y, z, BlockId.Farmland);
    player.inventory = consumeToolDurability(player.inventory, player.selectedSlot, 1, rng) ?? player.inventory;
    state.worldMeshDirty = true;
    emit({ type: "tilledSoil" });
    return true;
  }

  // Sapling: plant on grass/dirt when the cell above is clear. Falls through to
  // normal placement elsewhere, so a sapling stays a placeable block too.
  if (isSapling) {
    if ((block !== BlockId.Grass && block !== BlockId.Dirt) || world.get(x, y + 1, z) !== BlockId.Air) return false;
    state.blockChanges.set(x, y + 1, z, BlockId.Sapling);
    player.inventory = adjustSlotCount(player.inventory, slot.id, -1, player.selectedSlot) ?? player.inventory;
    state.worldMeshDirty = true;
    emit({ type: "plantedSapling" });
    return true;
  }

  // Seeds: plant on farmland when the cell above is clear.
  if (block !== BlockId.Farmland || world.get(x, y + 1, z) !== BlockId.Air) return false;
  state.blockChanges.set(x, y + 1, z, BlockId.WheatStage0);
  player.inventory = adjustSlotCount(player.inventory, slot.id, -1, player.selectedSlot) ?? player.inventory;
  state.worldMeshDirty = true;
  emit({ type: "plantedSeed" });
  return true;
}
