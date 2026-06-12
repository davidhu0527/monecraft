import * as THREE from "three";
import { collidesAt, generateWorld, VoxelWorld, WORLD_SIZE_X, WORLD_SIZE_Y, WORLD_SIZE_Z } from "@/lib/world";
import { HOTBAR_SLOTS, MAX_HUNGER, MAX_HEARTS, PLAYER_HALF_WIDTH, PLAYER_HEIGHT, RENDER_RADIUS, STUCK_RESET_SECONDS } from "@/lib/game/config";
import { createEmptyArmorEquipment, createInitialInventory } from "@/lib/game/items";
import { RECIPES } from "@/lib/game/recipes";
import * as inv from "@/lib/game/inventory";
import { inventorySlotsSnapshot, restoreEquippedArmor, restoreInventorySlots, restoreSelectedSlot } from "@/lib/game/save";
import { createSurfaceYAt, findSpawnOnLand, randomLandPointNear, type SurfaceYAtFn } from "@/lib/game/spawn";
import type { SaveData } from "@/lib/game/types";
import { createBlockChangeTracker } from "./blockChanges";
import type { Command } from "./commands";
import { createTimers, type FrameInput, type GameEvent, type GameSnapshot, type GameState } from "./state";
import { daylightAt, tickDayNight } from "./systems/dayNight";
import { applyDamageWithArmor, tickRespawnTimer } from "./systems/playerLife";
import { tickPlayerMotion } from "./systems/playerMotion";
import { restoreHunger, tickHungerDrain, tickHealthRegen } from "./systems/playerStats";
import { placeSelectedBlock, resetMining, tickMining } from "./systems/mining";
import { tryAttackMob, weaponDamage } from "./systems/combat";
import { tickMobs } from "./systems/mobAI";
import { spawnInitialMobs, tickHostileSpawnDirector } from "./systems/spawnDirector";

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
      paused: false,
      debugOpen: false,
      debugInfo: null,
      capsActive: false,
      mobs: [],
      nextMobId: 1,
      dayClock: 0,
      daylight: daylightAt(0),
      daylightPercent: Math.round(daylightAt(0) * 100),
      mining: { targetKey: "", progress: 0 },
      timers: createTimers(),
      worldMeshDirty: true
    };

    if (save) {
      this.state.inventory = restoreInventorySlots(save) ?? this.state.inventory;
      this.state.equippedArmor = restoreEquippedArmor(save) ?? this.state.equippedArmor;
      this.state.selectedSlot = restoreSelectedSlot(save) ?? this.state.selectedSlot;
      if (save.player) this.state.player.position.set(save.player.x, save.player.y, save.player.z);
    }

    // Safety check: if stuck after load, relocate to a plain.
    if (collidesAt(world, this.state.player.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT) || this.state.player.position.y < 2) {
      this.forceUnstuck();
    }

    spawnInitialMobs(this.state, this.rng, this.surfaceYAt);
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

    const move = tickPlayerMotion(state, input, dt, this.applyDamage);
    if (move.didJump) this.emit({ type: "jumped" });
    if (move.didLand) this.emit({ type: "landed", impact: move.landImpact });
    tickHungerDrain(state, move);
    tickHealthRegen(state, dt);
    tickMining(state, input, dt, this.emit);
    tickDayNight(state, dt);
    tickHostileSpawnDirector(state, dt, this.rng, this.surfaceYAt);
    tickMobs(state, dt, this.mobTickDeps);
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
        break;
      }
      case "craft": {
        const recipe = RECIPES.find((entry) => entry.id === command.recipeId);
        if (!recipe || state.isDead) break;
        state.inventory = inv.craft(state.inventory, recipe) ?? state.inventory;
        break;
      }
      case "swapSlots": {
        state.inventory = inv.swapSlots(state.inventory, command.from, command.to) ?? state.inventory;
        break;
      }
      case "toggleEquipArmor": {
        state.equippedArmor = inv.toggleEquipArmor(state.inventory, state.equippedArmor, command.index) ?? state.equippedArmor;
        break;
      }
      case "eatFood": {
        if (state.isDead || state.inventoryOpen) break;
        const slot = state.inventory[state.selectedSlot];
        if (!slot?.id || slot.id !== "food" || slot.count <= 0) break;
        const next = inv.adjustSlotCount(state.inventory, "food", -1, state.selectedSlot);
        if (!next) break;
        state.inventory = next;
        state.hunger = restoreHunger(state.hunger);
        this.emit({ type: "ateFood" });
        break;
      }
      case "placeBlock": {
        if (state.isDead || state.inventoryOpen) break;
        placeSelectedBlock(state, this.emit);
        break;
      }
      case "attack": {
        if (state.isDead || state.inventoryOpen) break;
        this.emit({ type: "attackSwung" });
        const hitKind = tryAttackMob(state, weaponDamage(state), this.removeMobAt);
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
        if (state.inventoryOpen || state.isDead) break;
        state.paused = true;
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
      version: 2,
      seed: state.world.seed,
      changes: state.blockChanges.changes(),
      inventorySlots: inventorySlotsSnapshot(state.inventory),
      equippedArmor: { ...state.equippedArmor },
      selectedSlot: state.selectedSlot,
      player: {
        x: state.player.position.x,
        y: state.player.position.y,
        z: state.player.position.z
      }
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

  private removeMobAt = (index: number): void => {
    const state = this.state;
    const mob = state.mobs[index];
    state.mobs.splice(index, 1);
    const dropId = mob.hostile ? "cobble" : "food";
    state.inventory = inv.adjustSlotCount(state.inventory, dropId, 1) ?? state.inventory;
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
    const spawn = randomLandPointNear(state.world, this.surfaceYAt, state.world.sizeX / 2, state.world.sizeZ / 2, RENDER_RADIUS * 0.9, this.rng);
    state.player.position.set(spawn.x, spawn.y + 2, spawn.z);
    state.player.velocity.set(0, 0, 0);
    state.player.pitch = 0;
    resetMining(state);
    state.worldMeshDirty = true;
    this.events.push({ type: "respawned" });
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
      armorPoints: inv.equippedDefense(state.inventory, state.equippedArmor),
      capsActive: state.capsActive
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
