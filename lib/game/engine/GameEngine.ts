import * as THREE from "three";
import { BlockId, collectDungeonSites, collidesAt, generateWorld, VoxelWorld, WORLD_SIZE_X, WORLD_SIZE_Y, WORLD_SIZE_Z } from "@/lib/world";
import {
  DAY_CYCLE_SECONDS,
  HOTBAR_SLOTS,
  MAX_HUNGER,
  MAX_HEARTS,
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT,
  RENDER_RADIUS,
  STUCK_RESET_SECONDS,
  WAKE_DAY_PHASE
} from "@/lib/game/config";
import { createEmptyArmorEquipment, createInitialInventory } from "@/lib/game/items";
import { RECIPES } from "@/lib/game/recipes";
import * as inv from "@/lib/game/inventory";
import {
  inventorySlotsSnapshot,
  readContainers,
  readLootedChests,
  restoreDayClock,
  restoreEquippedArmor,
  restoreHearts,
  restoreHungerLevel,
  restoreInventorySlots,
  restoreSelectedSlot,
  restoreSpawnPoint,
  serializeContainers,
  serializeLootedChests
} from "@/lib/game/save";
import { createSurfaceYAt, findSpawnOnLand, randomLandPointNear, type SurfaceYAtFn } from "@/lib/game/spawn";
import { rollMobDrops } from "@/lib/game/mobLoot";
import type { InventorySlot, SaveData } from "@/lib/game/types";
import { createBlockChangeTracker } from "./blockChanges";
import { CONTAINER_SLOT_BASE, type Command } from "./commands";
import { createTimers, nextCameraMode, type FrameInput, type GameEvent, type GameSnapshot, type GameState } from "./state";
import { daylightAt, tickDayNight } from "./systems/dayNight";
import { tickWeather } from "./systems/weather";
import { applyDamageWithArmor, applyUnmitigatedDamage, tickRespawnTimer } from "./systems/playerLife";
import { tickPlayerMotion } from "./systems/playerMotion";
import { restoreHunger, tickHungerDrain, tickHealthRegen, tickWaterExposure } from "./systems/playerStats";
import { placeSelectedBlock, resetMining, tickMining } from "./systems/mining";
import { tryFeedAimedMob, tryInteractBlock, tryUseHeldItem } from "./systems/interact";
import { tryAttackMob, weaponDamage, weaponReach } from "./systems/combat";
import { tickThrownSpears, tryThrowSelectedSpear } from "./systems/spears";
import { tickMobs } from "./systems/mobAI";
import { tickRandomBlocks } from "./systems/randomTicks";
import { tickBreeding } from "./systems/breeding";
import { spawnInitialMobs, tickHostileSpawnDirector, tickSpawnerDirector } from "./systems/spawnDirector";

export type GameEngineOptions = {
  /** A parsed save to restore, or null for a fresh world. */
  save?: SaveData | null;
  /** Seed for a fresh world; ignored when a save is provided. */
  seed?: number;
  /** Randomness source for mob spawning/AI — injectable for deterministic tests. */
  rng?: () => number;
  /** World dimensions override for fast headless tests. */
  worldSize?: { x: number; y: number; z: number };
};

/**
 * The framework-agnostic game core. Owns all simulation state, advances it in
 * step(), and accepts player intents through dispatch(). No React, no DOM, no
 * rendering — the renderer reads state, the React shell subscribes to
 * snapshots via subscribe()/getSnapshot() (useSyncExternalStore compatible).
 */
export class GameEngine {
  readonly state: GameState;
  private readonly rng: () => number;
  private readonly surfaceYAt: SurfaceYAtFn;
  private readonly listeners = new Set<() => void>();
  private events: GameEvent[] = [];
  private snapshot: GameSnapshot;

  constructor(options: GameEngineOptions = {}) {
    const save = options.save ?? null;
    this.rng = options.rng ?? Math.random;

    const seed = save?.seed ?? options.seed ?? Math.floor(Math.random() * 2147483647);
    const size = options.worldSize ?? { x: WORLD_SIZE_X, y: WORLD_SIZE_Y, z: WORLD_SIZE_Z };
    const world = new VoxelWorld(size.x, size.y, size.z, seed);
    generateWorld(world);
    // Re-derive the dungeon chest/spawner positions from the seed (the world is
    // regenerated deterministically each load, so these match generation).
    const dungeonSites = collectDungeonSites(world);

    const blockChanges = createBlockChangeTracker(world);
    if (save) blockChanges.applySavedChanges(save.changes);

    this.surfaceYAt = createSurfaceYAt(world);

    const firstSpawn = findSpawnOnLand(world, Math.floor(world.sizeX / 2), Math.floor(world.sizeZ / 2));
    this.state = {
      world,
      blockChanges,
      player: {
        position: new THREE.Vector3(firstSpawn.x, firstSpawn.y, firstSpawn.z),
        velocity: new THREE.Vector3(),
        yaw: 0,
        pitch: 0,
        onGround: false
      },
      inventory: createInitialInventory(),
      equippedArmor: createEmptyArmorEquipment(),
      selectedSlot: 0,
      hearts: MAX_HEARTS,
      hunger: MAX_HUNGER,
      isDead: false,
      respawnTimer: 0,
      inventoryOpen: false,
      craftingStation: null,
      containers: new Map(),
      openContainerIndex: null,
      dungeonChestIndices: new Set(dungeonSites.chestIndices),
      dungeonSpawnerIndices: new Set(dungeonSites.spawnerIndices),
      lootedDungeonChests: new Set(),
      paused: false,
      debugOpen: false,
      debugInfo: null,
      cameraMode: "first",
      capsActive: false,
      mobs: [],
      nextMobId: 1,
      thrownSpears: [],
      nextThrownSpearId: 1,
      dayClock: 0,
      daylight: daylightAt(0),
      daylightPercent: Math.round(daylightAt(0) * 100),
      weather: { kind: "clear", intensity: 0 },
      sleepTimer: 0,
      spawnPoint: null,
      mining: { targetKey: "", progress: 0 },
      timers: createTimers(),
      worldMeshDirty: true
    };

    if (save) {
      this.state.inventory = restoreInventorySlots(save) ?? this.state.inventory;
      this.state.equippedArmor = restoreEquippedArmor(save) ?? this.state.equippedArmor;
      this.state.selectedSlot = restoreSelectedSlot(save) ?? this.state.selectedSlot;
      this.state.hearts = restoreHearts(save) ?? this.state.hearts;
      this.state.hunger = restoreHungerLevel(save) ?? this.state.hunger;
      this.state.spawnPoint = restoreSpawnPoint(save);
      this.state.lootedDungeonChests = new Set(readLootedChests(save));
      // Restore chest contents only for indices that still hold a Chest block.
      for (const { index, slots } of readContainers(save)) {
        if (index >= 0 && index < world.blocks.length && world.blocks[index] === BlockId.Chest) {
          this.state.containers.set(index, slots);
        }
      }
      const savedClock = restoreDayClock(save);
      if (savedClock !== null) {
        this.state.dayClock = savedClock;
        this.state.daylight = daylightAt(savedClock);
        this.state.daylightPercent = Math.round(this.state.daylight * 100);
      }
      if (save.player) this.state.player.position.set(save.player.x, save.player.y, save.player.z);
    }

    // Safety check: if stuck after load, relocate to a plain.
    if (collidesAt(world, this.state.player.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT) || this.state.player.position.y < 2) {
      this.forceUnstuck();
    }

    spawnInitialMobs(this.state, this.rng, this.surfaceYAt);
    // Seed weather from the (possibly restored) dayClock + player position so a
    // loaded save's first frame/snapshot is consistent before the first step().
    tickWeather(this.state);
    this.snapshot = this.buildSnapshot();
  }

  /** Advances the simulation by dt seconds. The renderer draws the state afterwards. */
  step(dt: number, input: FrameInput): void {
    const state = this.state;
    if (state.paused) {
      // Full freeze: mobs, the day clock, mining, and stats all stop.
      this.refreshSnapshot();
      return;
    }
    state.capsActive = input.capsActive;

    // Stuck detection / auto-unstuck.
    const inBadState = collidesAt(state.world, state.player.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT) || state.player.position.y < 2;
    state.timers.stuckTimer = inBadState ? state.timers.stuckTimer + dt : 0;
    if (state.timers.stuckTimer > STUCK_RESET_SECONDS) {
      this.forceUnstuck();
      state.timers.stuckTimer = 0;
    }

    // Death: only mobs and the respawn countdown tick while dead.
    if (state.isDead) {
      if (tickRespawnTimer(state, dt)) this.respawn();
      else tickMobs(state, dt, this.mobTickDeps);
      this.refreshSnapshot();
      return;
    }

    // Sleeping: a full freeze during the fade, then a jump to the next morning.
    if (state.sleepTimer > 0) {
      state.sleepTimer = Math.max(0, state.sleepTimer - dt);
      if (state.sleepTimer === 0) this.wakeToMorning();
      this.refreshSnapshot();
      return;
    }

    const move = tickPlayerMotion(state, input, dt, this.applyDamage);
    if (move.didJump) this.emit({ type: "jumped" });
    if (move.didLand) this.emit({ type: "landed", impact: move.landImpact });
    tickHungerDrain(state, move);
    tickHealthRegen(state, dt);
    tickWaterExposure(state, dt, this.applyEnvironmentalDamage);
    tickMining(state, input, dt, this.emit, this.rng);
    tickThrownSpears(state, dt, this.removeMobAt, this.emit);
    tickDayNight(state, dt);
    tickWeather(state);
    tickRandomBlocks(state, dt, this.rng);
    tickHostileSpawnDirector(state, dt, this.rng, this.surfaceYAt);
    tickSpawnerDirector(state, dt, this.rng, this.emit);
    tickMobs(state, dt, this.mobTickDeps);
    tickBreeding(state, dt, this.rng, this.surfaceYAt, this.emit);
    this.tickDebugInfo(dt);

    this.refreshSnapshot();
  }

  /** Applies a discrete player intent. */
  dispatch(command: Command): void {
    const state = this.state;
    switch (command.type) {
      case "selectSlot": {
        if (command.index >= 0 && command.index < Math.min(HOTBAR_SLOTS, state.inventory.length)) {
          state.selectedSlot = command.index;
        }
        break;
      }
      case "toggleInventory": {
        state.inventoryOpen = !state.inventoryOpen;
        if (!state.inventoryOpen) {
          state.craftingStation = null; // leaving the panel closes the station
          state.openContainerIndex = null; // ...and the open chest
        }
        break;
      }
      case "craft": {
        const recipe = RECIPES.find((entry) => entry.id === command.recipeId);
        if (!recipe || state.isDead) break;
        // Station recipes (e.g. furnace smelting) require that station to be open.
        // The UI gates these too, but dispatch is the spoofable surface to guard.
        if (recipe.station && recipe.station !== state.craftingStation) break;
        const next = inv.craft(state.inventory, recipe);
        if (!next) break;
        state.inventory = next;
        if (recipe.station) this.emit({ type: "smelted" });
        break;
      }
      case "swapSlots": {
        state.inventory = inv.swapSlots(state.inventory, command.from, command.to) ?? state.inventory;
        break;
      }
      case "moveStack": {
        this.applyMoveStack(command.from, command.to);
        break;
      }
      case "toggleEquipArmor": {
        state.equippedArmor = inv.toggleEquipArmor(state.inventory, state.equippedArmor, command.index) ?? state.equippedArmor;
        break;
      }
      case "eatFood": {
        if (state.isDead || state.inventoryOpen || state.sleepTimer > 0) break;
        const slot = state.inventory[state.selectedSlot];
        if (!slot?.id || slot.kind !== "food" || !slot.hunger || slot.count <= 0) break;
        const next = inv.adjustSlotCount(state.inventory, slot.id, -1, state.selectedSlot);
        if (!next) break;
        state.inventory = next;
        state.hunger = restoreHunger(state.hunger, slot.hunger);
        this.emit({ type: "ateFood" });
        break;
      }
      case "placeBlock": {
        if (state.isDead || state.inventoryOpen || state.sleepTimer > 0) break;
        // Spears consume the right-click/E action before all world interaction.
        if (tryThrowSelectedSpear(state, this.emit)) break;
        // Right-click precedence: feed an aimed animal, then interact with the
        // aimed block (bed, furnace), then use the held item (hoe, seeds); only
        // place a block if none of those consumed the click.
        if (tryFeedAimedMob(state, this.emit)) break;
        if (tryInteractBlock(state, this.emit)) break;
        if (tryUseHeldItem(state, this.emit, this.rng)) break;
        placeSelectedBlock(state, this.emit);
        break;
      }
      case "attack": {
        if (state.isDead || state.inventoryOpen || state.sleepTimer > 0) break;
        this.emit({ type: "attackSwung" });
        const hitKind = tryAttackMob(state, weaponDamage(state), this.removeMobAt, weaponReach(state));
        if (hitKind) {
          this.emit({ type: "mobHit", kind: hitKind });
          state.inventory = inv.consumeToolDurability(state.inventory, state.selectedSlot, 1) ?? state.inventory;
          resetMining(state);
        }
        break;
      }
      case "unstuck": {
        if (state.isDead) break;
        this.forceUnstuck();
        break;
      }
      case "pause": {
        // The inventory panel and the death screen own their lock-loss; only
        // plain gameplay lock-loss (or an explicit Escape) opens the pause menu.
        // Sleeping is a brief, atomic freeze — pausing mid-fade would stall the
        // sleep timer (step early-returns on paused before the sleep branch).
        if (state.inventoryOpen || state.isDead || state.sleepTimer > 0) break;
        state.paused = true;
        state.craftingStation = null;
        state.openContainerIndex = null;
        break;
      }
      case "resume": {
        state.paused = false;
        break;
      }
      case "toggleDebug": {
        state.debugOpen = !state.debugOpen;
        state.debugInfo = state.debugOpen ? this.currentDebugInfo() : null;
        break;
      }
      case "toggleCameraView": {
        // Render-only, so it works even while dead or paused (like Minecraft F5).
        state.cameraMode = nextCameraMode(state.cameraMode);
        break;
      }
      case "respawn": {
        // Skip the rest of the countdown; the next step performs the respawn.
        if (state.isDead) state.respawnTimer = 0;
        break;
      }
    }
    this.syncEquippedArmor();
    this.refreshSnapshot();
  }

  /** Mouse-look: applied directly by the input controller (radians). */
  applyLook(deltaYaw: number, deltaPitch: number): void {
    const player = this.state.player;
    player.yaw += deltaYaw;
    player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, player.pitch + deltaPitch));
  }

  /** Current world + player state as a persistable save. */
  serialize(): SaveData {
    const state = this.state;
    return {
      version: 5,
      seed: state.world.seed,
      changes: state.blockChanges.changes(),
      inventorySlots: inventorySlotsSnapshot(state.inventory),
      equippedArmor: { ...state.equippedArmor },
      selectedSlot: state.selectedSlot,
      player: {
        x: state.player.position.x,
        y: state.player.position.y,
        z: state.player.position.z
      },
      dayClock: state.dayClock,
      hearts: state.hearts,
      hunger: state.hunger,
      spawnPoint: state.spawnPoint ? { ...state.spawnPoint } : null,
      blockEntities: serializeContainers(state.containers),
      lootedChests: serializeLootedChests(state.lootedDungeonChests)
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): GameSnapshot => this.snapshot;

  /** Drains queued one-shot gameplay events for the shell (death screen, audio). */
  consumeEvents(): GameEvent[] {
    if (this.events.length === 0) return this.events;
    const drained = this.events;
    this.events = [];
    return drained;
  }

  private emit = (event: GameEvent): void => {
    this.events.push(event);
  };

  /**
   * Moves a slot between the player inventory and the open chest. Indices at or
   * above CONTAINER_SLOT_BASE address the container; below it, the inventory.
   * Writes back whichever of the two arrays the move touched.
   */
  private applyMoveStack(from: number, to: number): void {
    const state = this.state;
    const container = state.openContainerIndex !== null ? state.containers.get(state.openContainerIndex) : undefined;
    const resolve = (index: number): { arr: InventorySlot[]; local: number } | null => {
      if (index >= CONTAINER_SLOT_BASE) return container ? { arr: container, local: index - CONTAINER_SLOT_BASE } : null;
      return { arr: state.inventory, local: index };
    };
    const a = resolve(from);
    const b = resolve(to);
    if (!a || !b) return;
    const moved = inv.moveStack(a.arr, a.local, b.arr, b.local);
    if (!moved) return;

    // Resolve each side's destination BEFORE writing: the first write reassigns
    // state.inventory, which would make a later `arr === state.inventory` check
    // stale and misroute an inventory↔inventory move into the open chest.
    const aIsInventory = a.arr === state.inventory;
    const bIsInventory = b.arr === state.inventory;
    const writeBack = (isInventory: boolean, next: InventorySlot[]): void => {
      if (isInventory) state.inventory = next;
      else if (state.openContainerIndex !== null) state.containers.set(state.openContainerIndex, next);
    };
    writeBack(aIsInventory, moved.a);
    writeBack(bIsInventory, moved.b);
  }

  private applyDamage = (amount: number): void => {
    const heartsBefore = this.state.hearts;
    const died = applyDamageWithArmor(this.state, amount);
    this.syncEquippedArmor();
    if (died) {
      resetMining(this.state);
      this.emit({ type: "died" });
    } else if (this.state.hearts < heartsBefore) {
      this.emit({ type: "playerHurt" });
    }
  };

  private applyEnvironmentalDamage = (amount: number): void => {
    const heartsBefore = this.state.hearts;
    const died = applyUnmitigatedDamage(this.state, amount);
    if (died) {
      resetMining(this.state);
      this.emit({ type: "died" });
    } else if (this.state.hearts < heartsBefore) {
      this.emit({ type: "playerHurt" });
    }
  };

  private removeMobAt = (index: number): void => {
    const state = this.state;
    const mob = state.mobs[index];
    state.mobs.splice(index, 1);
    // Babies drop nothing — only grown animals yield loot.
    const drops = mob.ageTimer <= 0 ? rollMobDrops(mob.kind, this.rng) : [];
    for (const drop of drops) {
      state.inventory = inv.adjustSlotCount(state.inventory, drop.itemId, drop.count) ?? state.inventory;
    }
    this.emit({ type: "mobDied", kind: mob.kind, x: mob.position.x, y: mob.position.y, z: mob.position.z });
    // Drops land straight in inventory (no ground item), so announce them.
    if (drops.length > 0) this.emit({ type: "pickedUp", items: drops });
  };

  private get mobTickDeps() {
    return {
      surfaceYAt: this.surfaceYAt,
      applyDamage: this.applyDamage,
      removeMobAt: this.removeMobAt,
      rng: this.rng,
      emit: this.emit
    };
  }

  private forceUnstuck(): void {
    const state = this.state;
    const safe = findSpawnOnLand(state.world, state.player.position.x, state.player.position.z, true);
    state.player.position.set(safe.x, safe.y, safe.z);
    state.player.velocity.set(0, 0, 0);
    state.player.onGround = false;
    state.worldMeshDirty = true;
  }

  private respawn(): void {
    const state = this.state;
    const bed = state.spawnPoint;
    if (bed && state.world.get(bed.x, bed.y, bed.z) === BlockId.Bed) {
      // Respawn standing on the bed; the bed block is non-solid head room above it.
      state.player.position.set(bed.x + 0.5, bed.y + 1.05, bed.z + 0.5);
    } else {
      const spawn = randomLandPointNear(state.world, this.surfaceYAt, state.world.sizeX / 2, state.world.sizeZ / 2, RENDER_RADIUS * 0.9, this.rng);
      state.player.position.set(spawn.x, spawn.y + 2, spawn.z);
    }
    state.player.velocity.set(0, 0, 0);
    state.player.pitch = 0;
    resetMining(state);
    state.thrownSpears = [];
    state.worldMeshDirty = true;
    this.events.push({ type: "respawned" });
  }

  /** Advances the day clock to the next morning after a sleep completes. */
  private wakeToMorning(): void {
    const state = this.state;
    const nextDay = Math.floor(state.dayClock / DAY_CYCLE_SECONDS) + 1;
    state.dayClock = (nextDay + WAKE_DAY_PHASE) * DAY_CYCLE_SECONDS;
    state.daylight = daylightAt(state.dayClock);
    state.daylightPercent = Math.round(state.daylight * 100);
    this.emit({ type: "wokeUp" });
  }

  /** Unequips armor that left the inventory (broken or dropped). */
  private syncEquippedArmor(): void {
    const state = this.state;
    state.equippedArmor = inv.unequipMissingArmor(state.inventory, state.equippedArmor) ?? state.equippedArmor;
  }

  /** Refreshes the F3 readout at ~4 Hz so React is not re-rendered every frame. */
  private tickDebugInfo(dt: number): void {
    const state = this.state;
    if (!state.debugOpen) return;
    state.timers.debugHudTimer += dt;
    if (state.timers.debugHudTimer < 0.25) return;
    state.timers.debugHudTimer = 0;
    state.debugInfo = this.currentDebugInfo();
  }

  private currentDebugInfo() {
    const { player, daylight } = this.state;
    return {
      x: Math.round(player.position.x * 10) / 10,
      y: Math.round(player.position.y * 10) / 10,
      z: Math.round(player.position.z * 10) / 10,
      daylight: Math.round(daylight * 100) / 100
    };
  }

  private buildSnapshot(): GameSnapshot {
    const state = this.state;
    return {
      api: this,
      inventory: state.inventory,
      equippedArmor: state.equippedArmor,
      selectedSlot: state.selectedSlot,
      hearts: state.hearts,
      hunger: state.hunger,
      daylightPercent: state.daylightPercent,
      passiveCount: state.mobs.reduce((acc, mob) => acc + (mob.hostile ? 0 : 1), 0),
      hostileCount: state.mobs.reduce((acc, mob) => acc + (mob.hostile ? 1 : 0), 0),
      respawnSeconds: state.isDead ? Math.max(0, Math.ceil(state.respawnTimer)) : 0,
      inventoryOpen: state.inventoryOpen,
      paused: state.paused,
      debugOpen: state.debugOpen,
      debug: state.debugInfo,
      cameraMode: state.cameraMode,
      armorPoints: inv.equippedDefense(state.inventory, state.equippedArmor),
      capsActive: state.capsActive,
      sleeping: state.sleepTimer > 0,
      craftingStation: state.craftingStation,
      container: state.openContainerIndex !== null ? (state.containers.get(state.openContainerIndex) ?? null) : null
    };
  }

  private refreshSnapshot(): void {
    const next = this.buildSnapshot();
    const prev = this.snapshot;
    const changed = (Object.keys(next) as Array<keyof GameSnapshot>).some((key) => next[key] !== prev[key]);
    if (!changed) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
