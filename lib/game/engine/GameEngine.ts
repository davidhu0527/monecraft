import * as THREE from "three";
import {
  BlockId,
  collectDungeonSites,
  collectShipwreckSites,
  collectTreasureSites,
  collectVillageSites,
  collidesAt,
  computeFullLight,
  generateWorld,
  voxelRaycast,
  VoxelWorld,
  WORLD_SIZE_X,
  WORLD_SIZE_Y,
  WORLD_SIZE_Z,
  type WorldType
} from "@/lib/world";
import {
  ANVIL_COMBINE_COST_LEVELS,
  ANVIL_RENAME_COST_LEVELS,
  ANVIL_REPAIR_COST_LEVELS,
  BABY_SCALE,
  BOSS_HP,
  BOSS_SUMMON_RADIUS,
  DAY_CYCLE_SECONDS,
  EYE_HEIGHT,
  FLY_SPEED,
  GRAVITY,
  JUMP_VELOCITY,
  ENCHANT_COST_LEVELS,
  HOTBAR_SLOTS,
  MAX_HUNGER,
  MAX_HEARTS,
  MAX_OXYGEN,
  MINE_REACH,
  PET_FIGHT_RANGE,
  PET_TAMED_HP,
  POISON_DURATION,
  POISON_FLOOR_HP,
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT,
  RAID_TRIGGER_DISTANCE,
  RAID_WAVE_COUNT,
  RENDER_RADIUS,
  ROTTEN_FLESH_POISON_CHANCE,
  SLEEP_FADE_SECONDS,
  SPRINT_SPEED,
  STUCK_RESET_SECONDS,
  WAKE_DAY_PHASE
} from "@/lib/game/config";
import { bossTracking, trackTarget, type BossTracking } from "@/lib/game/bossTracking";
import { createEmptyArmorEquipment, createEmptySlot, createInitialInventory, ITEM_DEF_BY_ID, maxStackSizeForItem } from "@/lib/game/items";
import {
  canMaterialRepair,
  combineSlots,
  findSacrificeIndex,
  isAnvilGear,
  materialRepair,
  repairMaterialFor,
  sanitizeCustomName,
  wouldCombineHelp
} from "@/lib/game/anvil";
import { canStripEnchantments, enchantRefund, stripEnchantments } from "@/lib/game/grindstone";
import { RECIPES } from "@/lib/game/recipes";
import { tradeProfession } from "@/lib/game/trades";
import * as inv from "@/lib/game/inventory";
import {
  inventorySlotsSnapshot,
  serializeEquippedArmor,
  readContainers,
  readLootedChests,
  restoreDayClock,
  restoreEquippedArmor,
  restoreHearts,
  restoreHungerLevel,
  restoreEffects,
  restoreInventorySlots,
  restorePlayerPosition,
  restoreGameMode,
  restoreDifficulty,
  restoreHardcore,
  restoreGameOver,
  restoreSelectedSlot,
  restoreSpawnPoint,
  restoreXp,
  restoreStats,
  restoreAdvancements,
  restoreMobs,
  restoreVehicles,
  serializeContainers,
  serializeEffects,
  serializeLootedChests,
  serializeMobs,
  serializeStats,
  serializeVehicles
} from "@/lib/game/save";
import { canEditBlocks, canInteract, isGameMode, isNoclip, type GameMode } from "@/lib/game/gameModes";
import { hostilesSpawn, isDifficulty, type Difficulty } from "@/lib/game/difficulties";
import { createSurfaceYAt, findSpawnOnLand, randomLandPointNear, type SurfaceYAtFn } from "@/lib/game/spawn";
import { rollMobDrops } from "@/lib/game/mobLoot";
import { MOB_TEMPLATES, mobHalfHeight } from "@/lib/game/mobs";
import type { InventorySlot, SaveData, SavedMob, SavedPlayer } from "@/lib/game/types";
import { createBlockChangeTracker, type DetailedEdit } from "./blockChanges";
import { CONTAINER_SLOT_BASE, type Command } from "./commands";
import {
  createIdleInput,
  createPlayerTimers,
  createWorldTimers,
  LOCAL_PLAYER_ID,
  nextCameraMode,
  type FrameInput,
  type AttributedGameEvent,
  type GameEvent,
  type GameSnapshot,
  type GameState,
  type PlayerId,
  type PlayerState
} from "./state";
import { allEligiblePlayersSleeping, installPlayerAliases, mustGetPlayer, nearestPlayerTo } from "./players";
import { daylightAt, tickDayNight } from "./systems/dayNight";
import { tickWeather } from "./systems/weather";
import { applyDamageWithArmor, applyNonLethalDamage, applyUnmitigatedDamage, tickRespawnTimer } from "./systems/playerLife";
import { lookDirection, tickPlayerMotion, type MoveTickResult } from "./systems/playerMotion";
import { restoreHunger, tickHungerDrain, tickHealthRegen, tickLavaExposure, tickOxygen, tickStarvation, tickWaterExposure } from "./systems/playerStats";
import { addEffect, clearEffects, EFFECT_ORDER, hasEffect, jumpBoostBonus, speedMultiplier, strengthBonus, tickStatusEffects } from "./systems/statusEffects";
import { awardXp, spendXpLevels, xpLevel, xpProgress } from "./systems/xp";
import { xpForMob } from "@/lib/game/mobXp";
import { applyEnchant, canEnchant, featherFallingReduction, knockbackBonus, lootingLevel, sharpnessBonus } from "@/lib/game/enchantments";
import { placeSelectedBlock, resetMining, tickMining } from "./systems/mining";
import {
  INTERACTIVE_BLOCKS,
  tryFeedAimedMob,
  tryInteractBlock,
  tryTameAimedMob,
  tryToggleSitPet,
  tryTradeAimedVillager,
  tryUseHeldItem
} from "./systems/interact";
import { isBow, tryAttackMob, tryFireBow, weaponDamage, weaponReach, type MobPositionOf } from "./systems/combat";
import { tickThrownSpears, tryThrowSelectedSpear } from "./systems/spears";
import { tickFishing, tryFish } from "./systems/fishing";
import { restoreVehicle, tickVehicles, tryBoardAimedVehicle, tryPlaceVehicle } from "./systems/vehicles";
import { tickMobs } from "./systems/mobAI";
import { tickPrimedTnt } from "./systems/explosion";
import { createRedstoneState, seedRedstoneCells, tickRedstone } from "./systems/redstone";
import { tickProjectiles } from "./systems/projectileAI";
import { tickRandomBlocks } from "./systems/randomTicks";
import { tickBreeding } from "./systems/breeding";
import { startRaid, tickRaid } from "./systems/raid";
import {
  assignVillagerProfessions,
  pushMob,
  spawnBoss,
  spawnInitialMobs,
  spawnMobGroup,
  spawnVillageResidents,
  tickAquaticSpawnDirector,
  tickHostileSpawnDirector,
  tickSpawnerDirector
} from "./systems/spawnDirector";
import { ADVANCEMENTS_BY_ID, evaluateAdvancements, recordEvent, recordTick } from "./systems/advancements";

export type GameEngineOptions = {
  /** A parsed save to restore, or null for a fresh world. */
  save?: SaveData | null;
  /** Seed for a fresh world; ignored when a save is provided. */
  seed?: number;
  /** Generation preset; the save's own worldType wins when restoring. Defaults to "default". */
  worldType?: WorldType;
  /** Initial game mode for a fresh world; the save's own gameMode wins when restoring. Defaults to "survival". */
  gameMode?: GameMode;
  /** Initial difficulty for a fresh world; the save's own difficulty wins when restoring. Defaults to "normal". */
  difficulty?: Difficulty;
  /** Hardcore flag for a fresh world; the save's own wins when restoring. Forces Survival + Hard + permadeath. Defaults to false. */
  hardcore?: boolean;
  /** Randomness source for mob spawning/AI — injectable for deterministic tests. */
  rng?: () => number;
  /** World dimensions override for fast headless tests. */
  worldSize?: { x: number; y: number; z: number };
  /**
   * Who owns pause semantics: "local" (default) honors the pause command and
   * freezes the world while the primary player is dead — the single-player
   * feel. "server" ignores pause and never freezes for one death (a shared
   * world keeps running); weather stays clear (clients derive their own).
   */
  authority?: "local" | "server";
  /** Skip snapshot building entirely (no React shell attached — a server room). */
  headless?: boolean;
  /**
   * Create the boot "local" player (default true — the SP shell). A server
   * room passes false: it starts EMPTY and populates purely via addPlayer on
   * join, so no phantom player ever exists in a shared world.
   */
  bootPlayer?: boolean;
  /**
   * A client-side MIRROR of a server world: worldgen from the seed, replicated
   * diffs applied externally (NetworkSession), and step() advances ONLY the
   * local player's predicted movement plus presentation (cosmetic mining
   * progress, day clock smoothing) — every world system (mobs, spawns, random
   * ticks, TNT, projectiles, raids, breeding) is replicated, not simulated.
   */
  replica?: boolean;
};

/** Upper bound on the gap `applyRemotePose` scales its speed clamps by, so a withheld-pose gap can't inflate them. */
const MAX_REMOTE_POSE_ELAPSED = 0.5;

/**
 * Per-dispatch server-side context. `mobPosOf` rewinds melee TARGET SELECTION
 * to where the attacker saw each mob (lag compensation) — damage, knockback,
 * and kill credit still act on the live mob. The server room is the sole
 * producer; a local engine never rewinds, and options never travel through
 * `routeDispatch` (a replica's rerouted command reaches the server as a plain
 * wire cmd — the server derives its own rewind from the cmd's view stamp).
 */
export type DispatchOptions = { mobPosOf?: MobPositionOf };

/**
 * The framework-agnostic game core. Owns all simulation state, advances it in
 * step(), and accepts player intents through dispatch(). No React, no DOM, no
 * rendering — the renderer reads state, the React shell subscribes to
 * snapshots via subscribe()/getSnapshot() (useSyncExternalStore compatible).
 */
export class GameEngine {
  readonly state: GameState;
  /** See GameEngineOptions.authority — "local" is the single-player shell. */
  readonly authority: "local" | "server";
  /** See GameEngineOptions.replica — a client-side mirror of a server world. */
  readonly replica: boolean;
  /**
   * When set (a multiplayer replica), dispatch() with no explicit playerId
   * delegates here instead of running the switch — the network session routes
   * the command (locally, to the server, or both). Routed re-entry passes the
   * primary id explicitly, which bypasses this hook.
   */
  routeDispatch: ((command: Command) => void) | null = null;
  private readonly headless: boolean;
  private readonly rng: () => number;
  private readonly worldType: WorldType;
  private readonly surfaceYAt: SurfaceYAtFn;
  private readonly listeners = new Set<() => void>();
  private events: AttributedGameEvent[] = [];
  /**
   * The player whose per-player step or dispatch is currently running. It scopes
   * emitted events for progression attribution (`observeProgress`) without
   * threading an id through every system's emit call — set around `stepPlayer`
   * and the `dispatch` switch, undefined for shared post-loop systems (mob AI,
   * projectiles), where attribution is instead explicit (a kill's `creditTo`).
   */
  private actingPlayer: PlayerId | undefined = undefined;
  private snapshot: GameSnapshot;
  // Navigation values are rounded, so the ref-equality snapshot diff updates
  // the HUD responsively without forcing a React render for sub-block movement.
  private lastBoss: ({ hpPercent: number } & BossTracking) | null = null;
  private lastTreasure: BossTracking | null = null;
  // The effects HUD projection is rebuilt only when its content (ids / rounded
  // seconds) changes, so the snapshot ref stays stable frame-to-frame and the
  // countdown re-renders at most ~once per second instead of every frame.
  private lastEffectsKey = "";
  private lastEffects: GameSnapshot["activeEffects"] = [];

  constructor(options: GameEngineOptions = {}) {
    const save = options.save ?? null;
    this.rng = options.rng ?? Math.random;
    this.authority = options.authority ?? "local";
    this.headless = options.headless ?? false;
    this.replica = options.replica ?? false;

    const seed = save?.seed ?? options.seed ?? Math.floor(Math.random() * 2147483647);
    // A restored save's own type wins (the block-diffs were recorded against it);
    // a fresh world takes the requested type, defaulting to "default".
    this.worldType = save?.worldType ?? options.worldType ?? "default";
    const size = options.worldSize ?? { x: WORLD_SIZE_X, y: WORLD_SIZE_Y, z: WORLD_SIZE_Z };
    const world = new VoxelWorld(size.x, size.y, size.z, seed);
    generateWorld(world, this.worldType);
    // Re-derive the dungeon chest/spawner positions from the seed (the world is
    // regenerated deterministically each load, so these match generation).
    const dungeonSites = collectDungeonSites(world, this.worldType);
    // Likewise re-derive shipwreck and buried-treasure chests (they share the
    // lazy loot fill; treasure also feeds the map compass) and village centers,
    // so resident villagers can be seeded there.
    const shipwreckSites = collectShipwreckSites(world, this.worldType);
    const treasureSites = collectTreasureSites(world, this.worldType);
    const villageSites = collectVillageSites(world, this.worldType);

    const blockChanges = createBlockChangeTracker(world);
    if (save) blockChanges.applySavedChanges(save.changes);

    // Bake per-voxel light now the block grid is final (worldgen + saved edits).
    // Derived cache, never serialized — see lighting.ts / docs/save-format.md.
    world.light = computeFullLight(world);

    this.surfaceYAt = createSurfaceYAt(world);

    const firstSpawn = findSpawnOnLand(world, Math.floor(world.sizeX / 2), Math.floor(world.sizeZ / 2));
    // The local player's persisted record (v17 saves hold one entry per player;
    // a downloaded multiplayer world played solo falls back to any first entry).
    const savedLocal = save ? (save.players.find((p) => p.id === LOCAL_PLAYER_ID) ?? save.players[0] ?? null) : null;
    // Hardcore is resolved first because it OVERRIDES mode/difficulty: a hardcore
    // world is locked to Survival + Hard. A persisted gameOver (the run already
    // ended in death) boots straight into Spectator so the dead world is roamable,
    // not playable. isFlying = (gameMode === "spectator") then yields a free camera.
    const hardcore = save ? restoreHardcore(save) : (options.hardcore ?? false);
    const gameOver = save && savedLocal ? restoreGameOver(save, savedLocal) : false;
    // A restored save's own (possibly switched) difficulty wins; hardcore forces Hard.
    const difficulty = hardcore ? "hard" : save ? restoreDifficulty(save) : (options.difficulty ?? "normal");
    // A restored save's own (possibly switched) mode wins; hardcore forces Survival,
    // except after game-over, where the player spectates their dead world.
    const gameMode = gameOver ? "spectator" : hardcore ? "survival" : savedLocal ? restoreGameMode(savedLocal) : (options.gameMode ?? "survival");
    const bootPlayer = options.bootPlayer ?? true;
    const localPlayer: PlayerState = {
      id: LOCAL_PLAYER_ID,
      position: new THREE.Vector3(firstSpawn.x, firstSpawn.y, firstSpawn.z),
      velocity: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      onGround: false,
      gameMode,
      isFlying: gameMode === "spectator", // Spectator is always airborne
      gameOver,
      inventory: createInitialInventory(),
      equippedArmor: createEmptyArmorEquipment(),
      selectedSlot: 0,
      hearts: MAX_HEARTS,
      hunger: MAX_HUNGER,
      oxygen: MAX_OXYGEN,
      effects: new Map(),
      xp: 0,
      stats: new Map(),
      advancements: new Set(),
      isDead: false,
      respawnTimer: 0,
      spawnPoint: null,
      mining: { targetKey: "", progress: 0 },
      fishing: null,
      mountedVehicleId: null,
      inventoryOpen: false,
      advancementsOpen: false,
      craftingStation: null,
      activeVillagerProfession: null,
      openContainerIndex: null,
      sleeping: false,
      input: createIdleInput(),
      remoteMove: null,
      timers: createPlayerTimers()
    };

    this.state = installPlayerAliases({
      world,
      blockChanges,
      players: bootPlayer ? new Map([[LOCAL_PLAYER_ID, localPlayer]]) : new Map(),
      primaryPlayerId: LOCAL_PLAYER_ID,
      difficulty,
      hardcore,
      containers: new Map(),
      primedTnt: new Map(),
      dungeonChestIndices: new Set(dungeonSites.chestIndices),
      dungeonSpawnerIndices: new Set(dungeonSites.spawnerIndices),
      shipwreckChestIndices: new Set(shipwreckSites.chestIndices),
      buriedTreasureChestIndices: new Set(treasureSites.sites.map((site) => site.index)),
      treasureSites: treasureSites.sites,
      lootedWorldgenChests: new Set(),
      villageSites: villageSites.centers,
      paused: false,
      debugOpen: false,
      debugInfo: null,
      cameraMode: "first",
      capsActive: false,
      mobs: [],
      nextMobId: 1,
      thrownSpears: [],
      nextThrownSpearId: 1,
      projectiles: [],
      nextProjectileId: 1,
      vehicles: [],
      nextVehicleId: 1,
      dayClock: 0,
      daylight: daylightAt(0),
      daylightPercent: Math.round(daylightAt(0) * 100),
      weather: { kind: "clear", intensity: 0 },
      sleepTimer: 0,
      timers: createWorldTimers(),
      worldMeshDirty: true,
      victory: false,
      raid: null,
      redstone: createRedstoneState()
    });

    // Recover the redstone component set from the block diff (craft-only
    // blocks are always player-placed, so the diff is a complete census).
    seedRedstoneCells(this.state);

    if (save) {
      if (bootPlayer && savedLocal) this.restorePlayerFields(localPlayer, savedLocal);
      this.state.lootedWorldgenChests = new Set(readLootedChests(save));
      // Restore persisted mobs (tamed pets) BEFORE spawnInitialMobs seeds the
      // fungible population, so the world stays alive and pets simply pre-exist.
      this.restorePersistedMobs(restoreMobs(save));
      for (const vehicle of restoreVehicles(save)) {
        restoreVehicle(this.state, vehicle.kind, vehicle.x, vehicle.y, vehicle.z, vehicle.yaw);
      }

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
    }

    // Safety check: if stuck after load, relocate to a plain — but never for a
    // Spectator, who legitimately loads inside terrain (or low) while noclipping.
    if (
      bootPlayer &&
      !isNoclip(localPlayer.gameMode) &&
      (collidesAt(world, localPlayer.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT) || localPlayer.position.y < 2)
    ) {
      this.forceUnstuck(localPlayer);
    }

    spawnInitialMobs(this.state, this.rng, this.surfaceYAt);
    // Seed each village's residents — but only for a world that hasn't populated
    // its villages yet: a fresh world (no save) or one upgraded from a pre-village
    // save (no `villagesSeeded` flag). A genuine v15 save's villagers are
    // authoritative — restored above — so we never re-seed (an emptied village
    // stays empty, not repopulated on reload).
    if (!save?.villagesSeeded && !this.state.mobs.some((mob) => mob.faction === "villager")) {
      if (this.state.villageSites.length > 0) {
        spawnVillageResidents(this.state, this.state.villageSites, this.rng, this.surfaceYAt);
      } else {
        // A village-less seed (rough/ocean terrain) still gets a few wandering
        // villagers near spawn so trading is never wholly unavailable.
        const anchor = nearestPlayerTo(this.state, world.sizeX / 2, world.sizeZ / 2);
        const { x, z } = anchor ? anchor.position : { x: world.sizeX / 2, z: world.sizeZ / 2 };
        spawnMobGroup(this.state, { kind: "villager", hostile: false, count: 3, centerX: x, centerZ: z, radius: RENDER_RADIUS }, this.rng, this.surfaceYAt);
      }
    }
    // Assign a profession to any villager that lacks one — newly seeded residents,
    // and (defensively) any restored villager whose profession went missing. Runs
    // unconditionally so a pre-v15 upgrade's villagers don't stay professionless.
    assignVillagerProfessions(this.state);
    // Seed weather from the (possibly restored) dayClock + player position so a
    // loaded save's first frame/snapshot is consistent before the first step().
    tickWeather(this.state);
    // A headless room never serves a snapshot, and a replica (bootPlayer:
    // false) starts with zero players — either way building one here would
    // dereference the missing primary player's aliases. The replica gets its
    // real snapshot the moment addPlayer seats the primary.
    this.snapshot = this.headless || !this.state.players.has(this.state.primaryPlayerId) ? ({} as GameSnapshot) : this.buildSnapshot();
  }

  /** Stores a player's latest continuous input (a server feeds each client's packet through here). */
  setPlayerInput(playerId: PlayerId, input: FrameInput): void {
    mustGetPlayer(this.state, playerId).input = input;
  }

  /**
   * Applies one client-authoritative pose (server authority): sanity-clamped
   * — horizontal speed against the sprint ceiling, vertical against jump/fall
   * physics — and rejected wholesale on a teleport-sized jump, in which case
   * the caller snaps the client back (forcePose). Accepted movement is
   * synthesized into the same summary tickPlayerMotion would have produced,
   * so hunger drain, distance stats, and fall damage stay server-authoritative
   * even though walking isn't.
   *
   * `elapsedSeconds` is the time since this player's last ACCEPTED pose.
   */
  applyRemotePose(
    playerId: PlayerId,
    pose: { x: number; y: number; z: number; yaw: number; pitch: number; onGround: boolean },
    elapsedSeconds: number
  ): { accepted: boolean } {
    const player = mustGetPlayer(this.state, playerId);
    // Cap elapsed as defense-in-depth: the clamps below scale linearly with it,
    // so an unbounded gap (a client withholding accepted poses) would inflate
    // the speed ceiling until any jump passes. 0.5s covers real catch-up bursts.
    const elapsed = Math.min(Math.max(elapsedSeconds, 0.01), MAX_REMOTE_POSE_ELAPSED);
    // A mounted player's pose belongs to the vehicle (server-side); ignore the stream.
    if (player.mountedVehicleId !== null) return { accepted: false };

    const dx = pose.x - player.position.x;
    const dz = pose.z - player.position.z;
    const dy = pose.y - player.position.y;
    const horizontal = Math.hypot(dx, dz);

    const free = isNoclip(player.gameMode) || (player.isFlying && player.gameMode === "creative");
    // Generous ceilings: jitter, knockback, and catch-up bursts must not
    // false-positive; a speedhack is an order of magnitude out anyway.
    const maxHorizontal = (free ? FLY_SPEED : SPRINT_SPEED * speedMultiplier(player)) * 1.6 * elapsed + 0.5;
    const maxUp = free ? FLY_SPEED * 1.6 * elapsed + 0.5 : (JUMP_VELOCITY + jumpBoostBonus(player)) * elapsed * 1.6 + 0.6;
    const maxDown = free ? FLY_SPEED * 1.6 * elapsed + 0.5 : GRAVITY * 2 * Math.max(elapsed, 0.5) * elapsed + 2;

    if (horizontal > maxHorizontal || dy > maxUp || -dy > maxDown) return { accepted: false };

    const wasGrounded = player.onGround;
    const verticalSpeed = dy / elapsed;
    player.position.set(pose.x, pose.y, pose.z);
    player.yaw = pose.yaw;
    player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pose.pitch));
    player.onGround = pose.onGround;

    // Landing: the same threshold/formula as tickPlayerMotion, on the
    // velocity the pose stream implies (Feather Falling honored, armor path).
    const didLand = !wasGrounded && pose.onGround && verticalSpeed < 0;
    if (!free && didLand && verticalSpeed < -14) {
      const raw = Math.min(19, Math.floor((-verticalSpeed - 13) * 0.5));
      const softened = raw * (1 - featherFallingReduction(player.equippedArmor.boots));
      this.damageCombat(player, Math.max(1, Math.round(softened)));
    }

    const moving = horizontal > 1e-3;
    const didSprint = moving && player.input.move.sprint && !player.input.move.crouch;
    const previous = player.remoteMove;
    player.remoteMove = {
      didSprint,
      didWalk: moving && !didSprint,
      didJump: (previous?.didJump ?? false) || (wasGrounded && !pose.onGround && verticalSpeed > 2),
      didLand: (previous?.didLand ?? false) || didLand,
      landImpact: didLand ? -verticalSpeed : (previous?.landImpact ?? 0),
      horizontalDistance: (previous?.horizontalDistance ?? 0) + horizontal
    };
    return { accepted: true };
  }

  /**
   * Advances the simulation by dt seconds. The renderer draws the state
   * afterwards. `input` is the SP shell's live FrameInput for the primary
   * player; a server omits it and feeds every player via setPlayerInput.
   */
  step(dt: number, input?: FrameInput): void {
    const state = this.state;
    if (state.paused) {
      // Full freeze: mobs, the day clock, mining, and stats all stop.
      this.refreshSnapshot();
      return;
    }
    const primary = state.players.get(state.primaryPlayerId) ?? null;
    if (input && primary) primary.input = input;
    // The HUD indicator still reads (and names) CapsLock, but the engine only
    // knows the abstract sprint intent — the binding lives in the controller.
    if (primary) state.capsActive = primary.input.move.sprint;

    // A replica advances only the local player's prediction + presentation:
    // own movement (the pose stream's source), cosmetic mining progress for
    // the crack overlay (the BREAK arrives as a server event), and the day
    // clock (corrected by the server every second). Everything else — mobs,
    // spawns, random ticks, TNT, projectiles, vitals — is replicated state
    // that NetworkSession writes in, never simulated here.
    if (this.replica) {
      if (primary && !primary.isDead && state.sleepTimer <= 0) {
        // While mounted the server owns our position (SelfDelta snaps it every
        // tick); predicting motion here would rubber-band against that stream.
        let walked = 0;
        if (primary.mountedVehicleId === null) walked = tickPlayerMotion(state, primary, primary.input, dt, () => {}).horizontalDistance;
        // Predictive mining: the break commits locally the moment the crack
        // completes (chests excepted). NetworkSession captures the written
        // cells from the detailed journal each frame and reconciles them
        // against the server's own break via the prediction ledger.
        tickMining(state, primary, primary.input, dt, this.emit, this.rng, { authority: "predict" });
        // Accumulate the two continuously-ticking display stats locally — they're
        // excluded from the SelfDelta (which syncs only the event-driven counters
        // the replica can't derive), so the Statistics tab stays roughly right.
        recordTick(primary, dt, walked);
      }
      if (state.sleepTimer > 0) state.sleepTimer = Math.max(0, state.sleepTimer - dt);
      tickDayNight(state, dt);
      tickWeather(state);
      this.tickDebugInfo(dt);
      this.refreshSnapshot();
      return;
    }

    // Single-player death semantics: while the (primary) player is dead, only
    // mobs, lit fuses, and in-flight arrows tick. An authoritative server never
    // freezes a shared world for one death — each player's respawn countdown
    // runs inside their own per-player step below instead.
    if (this.authority === "local" && primary?.isDead) {
      if (tickRespawnTimer(primary, dt)) this.respawn(primary);
      else {
        tickMobs(state, dt, this.mobTickDeps);
        // Keep ticking so lit fuses and in-flight arrows resolve instead of
        // freezing for the respawn countdown; damage no-ops while dead.
        tickPrimedTnt(state, dt, this.mobTickDeps);
        tickProjectiles(state, dt, this.mobTickDeps);
      }
      this.refreshSnapshot();
      return;
    }

    // Sleeping: a full freeze during the fade, then a jump to the next morning.
    // The fade only ever engages once EVERY eligible player is in bed (see
    // interactBed), so the freeze is fair in multiplayer too.
    if (state.sleepTimer > 0) {
      state.sleepTimer = Math.max(0, state.sleepTimer - dt);
      if (state.sleepTimer === 0) this.wakeToMorning();
      this.refreshSnapshot();
      return;
    }

    for (const player of state.players.values()) {
      // Scope this player's step so mining/fishing/jumping/hazard events attribute
      // their progression to them (see observeProgress / actingPlayer).
      const priorActor = this.actingPlayer;
      this.actingPlayer = player.id;
      try {
        this.stepPlayer(player, dt);
      } finally {
        this.actingPlayer = priorActor;
      }
    }

    tickDayNight(state, dt);
    tickWeather(state);
    tickRandomBlocks(state, dt, this.rng);
    tickHostileSpawnDirector(state, dt, this.rng, this.surfaceYAt);
    tickAquaticSpawnDirector(state, dt, this.rng);
    tickSpawnerDirector(state, dt, this.rng, this.emit);
    tickMobs(state, dt, this.mobTickDeps);
    // After the player loop (this frame's lever/button clicks are visible) and
    // before the TNT countdown (wire-lit fuses start ticking the same frame).
    // Replicas never reach here — redstone runs server-side only online.
    tickRedstone(state, dt, this.emit);
    tickPrimedTnt(state, dt, this.mobTickDeps);
    tickProjectiles(state, dt, this.mobTickDeps);
    tickThrownSpears(state, dt, this.removeMobAt, this.emit);
    tickBreeding(state, dt, this.rng, this.surfaceYAt, this.emit);
    tickRaid(state, dt, { surfaceYAt: this.surfaceYAt, rng: this.rng, emit: this.emit });
    this.tickDebugInfo(dt);

    this.refreshSnapshot();
  }

  /** One player's slice of a step: body, hazards, activities — everything scoped to that avatar. */
  private stepPlayer(player: PlayerState, dt: number): void {
    const state = this.state;
    const input = player.input;
    const damageEnv = (amount: number): void => this.damageEnvironmental(player, amount);

    // A dead player's respawn countdown (the server path — the SP world freeze
    // handled this branch before the loop).
    if (player.isDead) {
      if (tickRespawnTimer(player, dt)) this.respawn(player);
      return;
    }
    // A sleeping player is immobilized until everyone joins them (or they wake).
    if (player.sleeping) return;

    // Stuck detection / auto-unstuck — skipped for Spectator, which legitimately
    // sits inside terrain while noclipping and must never be teleported out.
    if (!isNoclip(player.gameMode)) {
      const inBadState = collidesAt(state.world, player.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT) || player.position.y < 2;
      player.timers.stuckTimer = inBadState ? player.timers.stuckTimer + dt : 0;
      if (player.timers.stuckTimer > STUCK_RESET_SECONDS) {
        this.forceUnstuck(player);
        player.timers.stuckTimer = 0;
      }
    }

    // While mounted, the vehicle drives the player and normal walking physics are
    // skipped; otherwise player motion runs first, then vehicles tick (so a ship can
    // auto-board the player at their post-motion position). tickVehicles is called
    // exactly once per player per frame in either case. Boating reports zero
    // horizontalDistance so it doesn't inflate the walked-distance stat.
    //
    // Server authority: each avatar's walking is CLIENT-owned (the pose stream,
    // clamped by applyRemotePose), so the server never integrates it — it
    // consumes the movement summary the accepted poses synthesized instead.
    const mounted = player.mountedVehicleId !== null;
    let move: MoveTickResult;
    if (mounted) {
      tickVehicles(state, player, input, dt);
      move = { didSprint: false, didWalk: false, didJump: false, didLand: false, landImpact: 0, horizontalDistance: 0 };
    } else if (this.authority === "server") {
      move = player.remoteMove ?? { didSprint: false, didWalk: false, didJump: false, didLand: false, landImpact: 0, horizontalDistance: 0 };
      player.remoteMove = null;
      tickVehicles(state, player, input, dt);
    } else {
      move = tickPlayerMotion(state, player, input, dt, (amount) => this.damageCombat(player, amount));
      tickVehicles(state, player, input, dt);
    }
    if (move.didJump) this.emit({ type: "jumped" });
    if (move.didLand) this.emit({ type: "landed", impact: move.landImpact });
    // Tick-driven display stats (no event, so out of the advancement path).
    recordTick(player, dt, move.horizontalDistance);
    tickHungerDrain(player, move);
    tickHealthRegen(state, player, dt);
    // Starvation reads the freshly-drained hunger: Easy/Normal chip to a floor,
    // Hard (floor 0) can kill via the environmental-damage path.
    tickStarvation(
      state,
      player,
      dt,
      (amount, floorHp) => {
        if (applyNonLethalDamage(player, amount, floorHp)) this.emit({ type: "playerHurt" });
      },
      damageEnv
    );
    // Status effects tick here so the fire-resist / water-breathing gates below are current.
    tickStatusEffects(player, dt, {
      applyPoisonDamage: (amount) => {
        if (applyNonLethalDamage(player, amount, POISON_FLOOR_HP)) this.emit({ type: "playerHurt" });
      },
      emit: this.emit
    });
    tickWaterExposure(state, player, dt, damageEnv);
    tickLavaExposure(state, player, dt, damageEnv, hasEffect(player, "fire_resistance"));
    tickOxygen(state, player, dt, damageEnv, hasEffect(player, "water_breathing"));
    player.timers.bowCooldownTimer = Math.max(0, player.timers.bowCooldownTimer - dt);
    player.timers.spearThrowCooldown = Math.max(0, player.timers.spearThrowCooldown - dt);
    tickMining(state, player, input, dt, this.emit, this.rng);
    tickFishing(state, player, dt, this.rng, this.emit);
  }

  /**
   * Applies a discrete player intent. `playerId` says whose intent it is —
   * the single-player shell omits it (primary); a server passes the sender's
   * id, so every mutation in here acts on the commanding player.
   *
   * `opts` is server-only lag compensation: the room is the sole producer
   * (a local engine never rewinds), and opts do NOT travel through
   * `routeDispatch` — a replica's rerouted command reaches the server as a
   * plain wire cmd whose rewind the server derives itself.
   */
  dispatch(command: Command, playerId?: PlayerId, opts?: DispatchOptions): void {
    if (this.routeDispatch && playerId === undefined) {
      this.routeDispatch(command);
      return;
    }
    const state = this.state;
    const player = mustGetPlayer(state, playerId ?? state.primaryPlayerId);
    // Scope emitted events (craft/place/eat/enchant…) to the commanding player so
    // their progression is attributed to them, not the primary.
    const priorActor = this.actingPlayer;
    this.actingPlayer = player.id;
    try {
      this.dispatchCommand(state, player, command, opts);
    } finally {
      this.actingPlayer = priorActor;
    }
  }

  private dispatchCommand(state: GameState, player: PlayerState, command: Command, opts?: DispatchOptions): void {
    switch (command.type) {
      case "selectSlot": {
        if (command.index >= 0 && command.index < Math.min(HOTBAR_SLOTS, player.inventory.length)) {
          player.selectedSlot = command.index;
        }
        break;
      }
      case "toggleInventory": {
        if (!canInteract(player.gameMode)) break; // Spectator has no inventory
        player.inventoryOpen = !player.inventoryOpen;
        if (player.inventoryOpen) player.advancementsOpen = false; // the two full-screen overlays are mutually exclusive
        if (!player.inventoryOpen) {
          player.craftingStation = null; // leaving the panel closes the station
          player.activeVillagerProfession = null; // ...and the open villager's trades
          player.openContainerIndex = null; // ...and the open chest
        }
        break;
      }
      case "toggleAdvancements": {
        // A read-only progression overlay — available in any mode (even Spectator).
        player.advancementsOpen = !player.advancementsOpen;
        if (player.advancementsOpen) {
          player.inventoryOpen = false; // mutually exclusive with the inventory panel
          player.craftingStation = null;
          player.activeVillagerProfession = null;
          player.openContainerIndex = null;
        }
        break;
      }
      case "craft": {
        const recipe = RECIPES.find((entry) => entry.id === command.recipeId);
        if (!recipe || player.isDead || !canInteract(player.gameMode)) break;
        // Station recipes (e.g. furnace smelting) require that station to be open.
        // The UI gates these too, but dispatch is the spoofable surface to guard.
        if (recipe.station && recipe.station !== player.craftingStation) break;
        // A villager trade additionally requires the open villager's profession —
        // you can't craft a blacksmith trade while talking to a farmer.
        if (recipe.station === "villager" && tradeProfession(recipe.id) !== player.activeVillagerProfession) break;
        const next = inv.craft(player.inventory, recipe);
        if (!next) break;
        player.inventory = next;
        // A broadly-useful craft signal: drives items_crafted + the craft/brew/trade
        // advancements. Station recipes still emit `smelted` for the audio director.
        this.emit({ type: "crafted", recipeId: recipe.id });
        if (recipe.station) this.emit({ type: "smelted" });
        break;
      }
      case "swapSlots": {
        if (!canInteract(player.gameMode)) break;
        player.inventory = inv.swapSlots(player.inventory, command.from, command.to) ?? player.inventory;
        break;
      }
      case "moveStack": {
        if (!canInteract(player.gameMode)) break;
        this.applyMoveStack(player, command.from, command.to);
        break;
      }
      case "toggleEquipArmor": {
        if (!canInteract(player.gameMode)) break;
        const equip = inv.toggleEquipArmor(player.inventory, player.equippedArmor, command.index);
        if (equip) {
          player.inventory = equip.slots;
          player.equippedArmor = equip.equipped;
        }
        break;
      }
      case "unequipArmor": {
        if (!canInteract(player.gameMode)) break;
        const unequip = inv.unequipArmor(player.inventory, player.equippedArmor, command.slot);
        if (unequip) {
          player.inventory = unequip.slots;
          player.equippedArmor = unequip.equipped;
        }
        break;
      }
      case "eatFood": {
        if (player.isDead || player.inventoryOpen || state.sleepTimer > 0 || !canInteract(player.gameMode)) break;
        const slot = player.inventory[player.selectedSlot];
        if (!slot?.id || slot.kind !== "food" || !slot.hunger || slot.count <= 0) break;
        const next = inv.adjustSlotCount(player.inventory, slot.id, -1, player.selectedSlot);
        if (!next) break;
        player.inventory = next;
        player.hunger = restoreHunger(player.hunger, slot.hunger);
        // Rotten flesh sometimes poisons — a never-lethal nibble of risk on the
        // most desperate food. Uses the injected rng so the roll is deterministic.
        if (slot.id === "rotten_flesh" && this.rng() < ROTTEN_FLESH_POISON_CHANCE) {
          addEffect(player, "poison", POISON_DURATION);
        }
        this.emit({ type: "ateFood" });
        break;
      }
      case "drinkPotion": {
        if (player.isDead || player.inventoryOpen || state.sleepTimer > 0 || !canInteract(player.gameMode)) break;
        const slot = player.inventory[player.selectedSlot];
        if (!slot?.id || !slot.effect || slot.count <= 0) break;
        const next = inv.adjustSlotCount(player.inventory, slot.id, -1, player.selectedSlot);
        if (!next) break;
        player.inventory = next;
        addEffect(player, slot.effect.id, slot.effect.durationSeconds);
        this.emit({ type: "drankPotion" });
        break;
      }
      case "enchant": {
        // Only at an open enchanting table; applies to the selected item instance.
        if (player.isDead || !canInteract(player.gameMode) || player.craftingStation !== "enchanting") break;
        const slot = player.inventory[player.selectedSlot];
        if (!canEnchant(slot, command.enchant)) break;
        if (!spendXpLevels(player, ENCHANT_COST_LEVELS)) break; // too few levels
        const next = [...player.inventory];
        next[player.selectedSlot] = applyEnchant(slot, command.enchant);
        player.inventory = next;
        this.emit({ type: "enchanted", enchant: command.enchant });
        break;
      }
      case "anvilCombine": {
        // Combine a duplicate of the selected gear into it: repair + merge enchants.
        if (player.isDead || !canInteract(player.gameMode) || player.craftingStation !== "anvil") break;
        const i = player.selectedSlot;
        const target = player.inventory[i];
        if (!isAnvilGear(target)) break;
        const sacrifice = findSacrificeIndex(player.inventory, i);
        if (sacrifice < 0 || !wouldCombineHelp(target, player.inventory[sacrifice])) break;
        if (!spendXpLevels(player, ANVIL_COMBINE_COST_LEVELS)) break;
        const next = [...player.inventory];
        next[i] = combineSlots(target, player.inventory[sacrifice]);
        next[sacrifice] = createEmptySlot();
        player.inventory = next;
        this.emit({ type: "anvilCombined" });
        break;
      }
      case "anvilRepair": {
        // Repair the selected gear by consuming one unit of its tier material.
        if (player.isDead || !canInteract(player.gameMode) || player.craftingStation !== "anvil") break;
        const i = player.selectedSlot;
        const target = player.inventory[i];
        if (!canMaterialRepair(target, player.inventory)) break;
        const material = repairMaterialFor(target)!;
        if (!spendXpLevels(player, ANVIL_REPAIR_COST_LEVELS)) break;
        const consumed = inv.adjustSlotCount(player.inventory, material, -1);
        if (!consumed) break; // belt-and-braces: canMaterialRepair already verified stock
        consumed[i] = materialRepair(target);
        player.inventory = consumed;
        this.emit({ type: "anvilRepaired" });
        break;
      }
      case "anvilRename": {
        // Rename the selected durable item (or clear the name with "").
        if (player.isDead || !canInteract(player.gameMode) || player.craftingStation !== "anvil") break;
        const slot = player.inventory[player.selectedSlot];
        if (!isAnvilGear(slot)) break;
        const name = sanitizeCustomName(command.name);
        if ((slot.customName ?? "") === name) break; // no-op: nothing to charge for
        if (!spendXpLevels(player, ANVIL_RENAME_COST_LEVELS)) break;
        const next = [...player.inventory];
        next[player.selectedSlot] = { ...slot, customName: name || undefined };
        player.inventory = next;
        this.emit({ type: "anvilRenamed" });
        break;
      }
      case "grindstoneStrip": {
        // Strip the selected gear's enchantments, refunding XP for them.
        if (player.isDead || !canInteract(player.gameMode) || player.craftingStation !== "grindstone") break;
        const slot = player.inventory[player.selectedSlot];
        if (!canStripEnchantments(slot)) break;
        player.xp += enchantRefund(slot);
        const next = [...player.inventory];
        next[player.selectedSlot] = stripEnchantments(slot);
        player.inventory = next;
        this.emit({ type: "grindstoneStripped" });
        break;
      }
      case "placeBlock": {
        if (player.isDead || player.inventoryOpen || state.sleepTimer > 0 || !canInteract(player.gameMode)) break;
        // Spears consume the right-click/E action before all world interaction.
        if (tryThrowSelectedSpear(state, player, this.emit, this.rng)) break;
        // Right-click precedence: feed an aimed animal, then interact with the
        // aimed block (bed, furnace), then use the held item (hoe, seeds); only
        // place a block if none of those consumed the click.
        // Companions: a treat tames a wild wolf/cat; otherwise toggling sit on your
        // own pet. Both run before feeding so the bone/fish tames rather than feeds.
        if (tryTameAimedMob(state, player, this.emit, this.rng)) break;
        if (tryFeedAimedMob(state, player, this.emit)) break;
        if (tryToggleSitPet(state, player, this.emit)) break;
        if (tryTradeAimedVillager(state, player, this.emit)) break;
        // Boarding runs everywhere the switch runs: single-player, and on the
        // authoritative server (the right-click arrives as a networked placeBlock
        // cmd). While mounted the server owns the rider's position and streams it
        // via the SelfDelta — the replica never dispatches placeBlock locally
        // (routeDispatch sends it up), so no client-owned pose fights it.
        if (tryBoardAimedVehicle(state, player)) break;
        if (tryInteractBlock(state, player, this.emit)) break;
        if (this.trySummonBoss(player)) break;
        if (this.tryStartRaid(player)) break;
        if (tryFish(state, player, this.emit, this.rng)) break;
        if (tryPlaceVehicle(state, player, this.emit)) break;
        if (tryUseHeldItem(state, player, this.emit, this.rng)) break;
        placeSelectedBlock(state, player, this.emit);
        break;
      }
      case "attack": {
        if (player.isDead || player.inventoryOpen || state.sleepTimer > 0 || !canInteract(player.gameMode)) break;
        this.emit({ type: "attackSwung" });
        // A held bow fires arrows instead of meleeing; tryFireBow no-ops on
        // cooldown or with no arrows, but the swing animation still plays.
        if (isBow(player.inventory[player.selectedSlot])) {
          tryFireBow(state, player, this.emit, this.rng);
          break;
        }
        const heldWeapon = player.inventory[player.selectedSlot];
        const hitKind = tryAttackMob(
          state,
          player,
          weaponDamage(player) + strengthBonus(player) + sharpnessBonus(heldWeapon),
          this.removeMobAt,
          weaponReach(player),
          knockbackBonus(heldWeapon),
          lootingLevel(heldWeapon),
          opts?.mobPosOf
        );
        if (hitKind) {
          this.emit({ type: "mobHit", kind: hitKind });
          player.inventory = inv.consumeToolDurability(player.inventory, player.selectedSlot, 1, this.rng) ?? player.inventory;
          resetMining(player);
        }
        break;
      }
      case "toggleFlight": {
        // Creative only — Spectator is permanently airborne, survival can't fly.
        if (player.gameMode !== "creative" || player.isDead || player.inventoryOpen) break;
        player.isFlying = !player.isFlying;
        break;
      }
      case "creativeGiveItem": {
        // Pulls a full stack from the creative palette into the inventory
        // (lowest empty slot first, so it lands on the hotbar). Creative only.
        if (player.gameMode !== "creative" || !ITEM_DEF_BY_ID[command.itemId]) break;
        player.inventory = inv.adjustSlotCount(player.inventory, command.itemId, maxStackSizeForItem(command.itemId), player.selectedSlot) ?? player.inventory;
        break;
      }
      case "setGameMode": {
        this.switchGameMode(player, command.mode);
        break;
      }
      case "setDifficulty": {
        this.switchDifficulty(command.difficulty);
        break;
      }
      case "unstuck": {
        if (player.isDead) break;
        this.forceUnstuck(player);
        break;
      }
      case "pause": {
        // A shared world never pauses: on a server the pause menu is a purely
        // client-side overlay, so the command is ignored outright.
        if (this.authority === "server") break;
        // The inventory panel, death screen, and victory screen own their
        // lock-loss; only plain gameplay lock-loss (or an explicit Escape) opens
        // the pause menu. Sleeping is a brief, atomic freeze — pausing mid-fade
        // would stall the sleep timer (step early-returns on paused before sleep).
        if (player.inventoryOpen || player.advancementsOpen || player.isDead || state.sleepTimer > 0 || state.victory || player.gameOver) break;
        state.paused = true;
        player.craftingStation = null;
        player.openContainerIndex = null;
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
        if (player.isDead) player.respawnTimer = 0;
        break;
      }
      case "dismissVictory": {
        state.victory = false;
        break;
      }
      case "wakeUp": {
        // Out of bed before the fade started (multiplayer: stop waiting on the
        // others). Once the fade runs (sleepTimer > 0) the skip is committed.
        if (state.sleepTimer <= 0) player.sleeping = false;
        break;
      }
    }
    this.refreshSnapshot();
  }

  /** The world-type preset this world generates with (a server's welcome message names it). */
  get worldTypeName(): WorldType {
    return this.worldType;
  }

  /** Mouse-look: applied directly by the input controller (radians). A server passes the sender's id. */
  applyLook(deltaYaw: number, deltaPitch: number, playerId: PlayerId = this.state.primaryPlayerId): void {
    const player = mustGetPlayer(this.state, playerId);
    player.yaw += deltaYaw;
    player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, player.pitch + deltaPitch));
  }

  /**
   * Adds a player to the world (a server join). Restores their persisted slice
   * when given (the world save carries one entry per known player), otherwise
   * spawns them fresh on land near the world center. Returns the live state.
   */
  addPlayer(spec: { id: PlayerId; gameMode?: GameMode; restore?: SavedPlayer | null }): PlayerState {
    const state = this.state;
    if (state.players.has(spec.id)) return mustGetPlayer(state, spec.id);
    const spawn = findSpawnOnLand(state.world, Math.floor(state.world.sizeX / 2), Math.floor(state.world.sizeZ / 2));
    const gameMode = state.hardcore ? "survival" : (spec.gameMode ?? "survival");
    const player: PlayerState = {
      id: spec.id,
      position: new THREE.Vector3(spawn.x, spawn.y, spawn.z),
      velocity: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      onGround: false,
      gameMode,
      isFlying: gameMode === "spectator",
      gameOver: false,
      inventory: createInitialInventory(),
      equippedArmor: createEmptyArmorEquipment(),
      selectedSlot: 0,
      hearts: MAX_HEARTS,
      hunger: MAX_HUNGER,
      oxygen: MAX_OXYGEN,
      effects: new Map(),
      xp: 0,
      stats: new Map(),
      advancements: new Set(),
      isDead: false,
      respawnTimer: 0,
      spawnPoint: null,
      mining: { targetKey: "", progress: 0 },
      fishing: null,
      mountedVehicleId: null,
      inventoryOpen: false,
      advancementsOpen: false,
      craftingStation: null,
      activeVillagerProfession: null,
      openContainerIndex: null,
      sleeping: false,
      input: createIdleInput(),
      remoteMove: null,
      timers: createPlayerTimers()
    };
    if (spec.restore) this.restorePlayerFields(player, spec.restore);
    state.players.set(spec.id, player);
    // A replica boots playerless with a stub snapshot; the primary taking
    // their seat is when a real one first becomes buildable.
    if (!this.headless && spec.id === state.primaryPlayerId) this.snapshot = this.buildSnapshot();
    this.emit({ type: "playerJoined", playerId: spec.id });
    return player;
  }

  /**
   * Removes a player (a server leave), returning their persisted slice so the
   * caller can fold it into the world save. Unmounts their vehicle first; the
   * primary player (the SP shell's) can't be removed.
   */
  removePlayer(id: PlayerId): SavedPlayer | null {
    const state = this.state;
    if (id === state.primaryPlayerId) return null;
    const player = state.players.get(id);
    if (!player) return null;
    if (player.mountedVehicleId !== null) {
      const vehicle = state.vehicles.find((v) => v.id === player.mountedVehicleId);
      if (vehicle) vehicle.rider = null;
    }
    const saved = this.serializePlayer(player);
    state.players.delete(id);
    // If the departing player was the last one awake, the remaining sleepers
    // would otherwise wait forever — re-run the gate the bed uses.
    if (state.sleepTimer === 0 && allEligiblePlayersSleeping(state)) state.sleepTimer = SLEEP_FADE_SECONDS;
    this.emit({ type: "playerLeft", playerId: id });
    return saved;
  }

  /** Current world + player state as a persistable save. */
  /** One player's persisted slice — shared by serialize() and (later) a server's save-on-leave. */
  private serializePlayer(player: PlayerState): SavedPlayer {
    return {
      id: player.id,
      position: { x: player.position.x, y: player.position.y, z: player.position.z },
      inventorySlots: inventorySlotsSnapshot(player.inventory),
      equippedArmor: serializeEquippedArmor(player.equippedArmor),
      selectedSlot: player.selectedSlot,
      gameMode: player.gameMode,
      gameOver: player.gameOver,
      hearts: player.hearts,
      hunger: player.hunger,
      effects: serializeEffects(player.effects),
      xp: player.xp,
      stats: serializeStats(player.stats),
      advancements: [...player.advancements],
      spawnPoint: player.spawnPoint ? { ...player.spawnPoint } : null
    };
  }

  /** Restores one player's persisted slice onto a live PlayerState (the mirror of serializePlayer). */
  private restorePlayerFields(player: PlayerState, saved: SavedPlayer): void {
    // Resolve mode the same way the constructor does for the primary: a dead
    // hardcore world spectates, hardcore forces survival, else the saved mode.
    player.gameOver = saved.gameOver === true;
    player.gameMode = player.gameOver ? "spectator" : this.state.hardcore ? "survival" : restoreGameMode(saved);
    player.isFlying = player.gameMode === "spectator";
    player.inventory = restoreInventorySlots(saved) ?? player.inventory;
    player.equippedArmor = restoreEquippedArmor(saved) ?? player.equippedArmor;
    player.selectedSlot = restoreSelectedSlot(saved) ?? player.selectedSlot;
    player.hearts = restoreHearts(saved) ?? player.hearts;
    player.hunger = restoreHungerLevel(saved) ?? player.hunger;
    player.spawnPoint = restoreSpawnPoint(saved);
    // Restore any active effects (cleared on death, so a live save carries them).
    for (const { id, remaining } of restoreEffects(saved)) player.effects.set(id, remaining);
    player.xp = restoreXp(saved); // XP is a long-term currency — kept across reload and death
    // Stats are long-term counters, kept across reload and death (like xp, unlike effects).
    for (const { id, value } of restoreStats(saved)) player.stats.set(id, value);
    // Filter against the registry so a corrupt/edited save can't inject bogus ids
    // (which would inflate the unlocked count and round-trip back out forever).
    for (const id of restoreAdvancements(saved)) if (ADVANCEMENTS_BY_ID[id]) player.advancements.add(id);
    const pos = restorePlayerPosition(saved);
    if (pos) player.position.set(pos.x, pos.y, pos.z);
  }

  serialize(): SaveData {
    const state = this.state;
    return {
      version: 17,
      seed: state.world.seed,
      worldType: this.worldType,
      difficulty: state.difficulty,
      hardcore: state.hardcore,
      changes: state.blockChanges.changes(),
      players: [...state.players.values()].map((player) => this.serializePlayer(player)),
      dayClock: state.dayClock,
      blockEntities: serializeContainers(state.containers),
      lootedChests: serializeLootedChests(state.lootedWorldgenChests),
      mobs: serializeMobs(state.mobs),
      vehicles: serializeVehicles(state.vehicles),
      villagesSeeded: true // this world's villages are populated — don't re-seed on reload
    };
  }

  /**
   * Detailed progression read for the advancements overlay. Pulled on render via
   * the snapshot's stable `api` handle (not projected per-frame into the snapshot),
   * so play never churns the snapshot with stat values the HUD doesn't show.
   */
  advancementState(): { stats: Array<{ id: string; value: number }>; unlocked: string[] } {
    return {
      stats: [...this.state.stats].map(([id, value]) => ({ id, value })),
      unlocked: [...this.state.advancements]
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): GameSnapshot => this.snapshot;

  /**
   * Replica-only: locally applies a right-click IFF it would fall through the
   * whole placeBlock precedence chain to pure block placement, so the block
   * appears at click time instead of a round-trip later. Conservative gates —
   * any branch the server might take instead (spear/feed/sit/trade/board/
   * interact/use-item, all either held-item- or aim-target-driven) bails to
   * null, which is simply the status quo: the cmd still travels and the world
   * updates when the journal echoes back. Returns the cells written (with
   * pre-values, for the prediction ledger's revert) and what to refund if the
   * server rejects the place; null means "predicted nothing".
   */
  predictPlaceBlock(): { edits: DetailedEdit[]; refund: { itemId: string; count: number } | null } | null {
    if (!this.replica) return null;
    const state = this.state;
    const player = state.players.get(state.primaryPlayerId);
    if (!player) return null;
    if (player.isDead || player.inventoryOpen || state.sleepTimer > 0 || !canInteract(player.gameMode) || !canEditBlocks(player.gameMode)) return null;
    // Only a plain placeable block in hand: every item-driven branch of the
    // right-click chain (spear, boat, hoe, seeds, food, rod, totem, horn) is
    // excluded by kind alone.
    const slot = player.inventory[player.selectedSlot];
    if (!slot || !slot.id || slot.kind !== "block" || slot.count <= 0 || slot.blockId === undefined || slot.blockId === BlockId.Bedrock) return null;

    const origin = new THREE.Vector3(player.position.x, player.position.y + EYE_HEIGHT, player.position.z);
    const direction = lookDirection(player.yaw, player.pitch, new THREE.Vector3());
    const hit = voxelRaycast(state.world, origin, direction, MINE_REACH);
    if (!hit) return null;
    if (INTERACTIVE_BLOCKS[state.world.get(hit.hit.x, hit.hit.y, hit.hit.z) as BlockId] !== undefined) return null;
    // Any mob or vehicle near the aim ray could consume the click server-side
    // (sit, trade, feed, board) — a false "don't predict" costs nothing.
    const toEntity = new THREE.Vector3();
    const nearRay = (p: THREE.Vector3, radius: number): boolean => {
      toEntity.copy(p).sub(origin);
      const along = toEntity.dot(direction);
      if (along < -radius || along > MINE_REACH + radius) return false;
      return toEntity.lengthSq() - Math.max(0, along) ** 2 < radius * radius;
    };
    for (const mob of state.mobs) if (nearRay(mob.position, 2)) return null;
    for (const vehicle of state.vehicles) if (nearRay(vehicle.position, 3)) return null;

    // Run the REAL placement (same validation, stack take, emit — the emit is
    // the instant local sound/particles) and capture exactly what it wrote.
    state.blockChanges.drainEditsDetailed(); // defensive flush — predictions must not adopt stale writes
    const inventoryBefore = player.inventory;
    placeSelectedBlock(state, player, this.emit);
    const edits = state.blockChanges.drainEditsDetailed().filter((e) => e.block !== e.prev);
    if (edits.length === 0) return null;
    return { edits, refund: player.inventory !== inventoryBefore ? { itemId: slot.id, count: 1 } : null };
  }

  /** Drains queued one-shot gameplay events for the shell (death screen, audio). */
  consumeEvents(): AttributedGameEvent[] {
    if (this.events.length === 0) return this.events;
    const drained = this.events;
    this.events = [];
    return drained;
  }

  private emit = (event: GameEvent, actorId?: PlayerId): void => {
    // Server rooms stamp the acting player onto every event that has one
    // (explicit ids — advancements, join/leave — win; shared-system events
    // like mob AI or TNT stay unattributed). Wire-compatible: the tick's `ev`
    // already carries an optional playerId. A predicting client relies on the
    // stamp to tell its own echoes from other players' actions; a local
    // engine leaves events untouched.
    const actor = (event as AttributedGameEvent).playerId ?? actorId ?? this.actingPlayer;
    this.events.push(this.authority === "server" && actor !== undefined ? { ...event, playerId: actor } : event);
    // Observe progress at the one chokepoint every system already emits through —
    // but guard against recursion (observing an unlock re-enters emit), and skip
    // it on a replica: the server owns progression and streams each player's
    // advancements/stats back via the SelfDelta.
    if (event.type !== "advancementUnlocked" && !this.replica) this.observeProgress(event, actorId);
  };

  /**
   * Folds a gameplay event into the acting player's statistics counters, then
   * unlocks any advancement whose threshold the new stats just crossed — adding
   * it to that player's set (before the emit, so a re-entrant observe is
   * idempotent) and announcing it (tagged with the player so a co-op client only
   * toasts its own).
   *
   * The actor is: an explicit `actorId` (a kill's killer, a death's victim) if
   * given, else whoever's per-player step or dispatch is currently running
   * (`actingPlayer`), else the primary (single-player). A server room with no
   * primary and no attributable actor scores nothing — correct.
   */
  private observeProgress(event: GameEvent, actorId?: PlayerId): void {
    const actor = this.state.players.get(actorId ?? this.actingPlayer ?? this.state.primaryPlayerId);
    if (!actor) return;
    recordEvent(actor, event);
    for (const id of evaluateAdvancements(actor)) {
      actor.advancements.add(id);
      this.emit({ type: "advancementUnlocked", id, name: ADVANCEMENTS_BY_ID[id].title, playerId: actor.id }, actor.id);
    }
  }

  /**
   * Moves a slot between the player inventory and the open chest. Indices at or
   * above CONTAINER_SLOT_BASE address the container; below it, the inventory.
   * Writes back whichever of the two arrays the move touched.
   */
  private applyMoveStack(player: PlayerState, from: number, to: number): void {
    const state = this.state;
    const openIndex = player.openContainerIndex;
    const container = openIndex !== null ? state.containers.get(openIndex) : undefined;
    const resolve = (index: number): { arr: InventorySlot[]; local: number } | null => {
      if (index >= CONTAINER_SLOT_BASE) return container ? { arr: container, local: index - CONTAINER_SLOT_BASE } : null;
      return { arr: player.inventory, local: index };
    };
    const a = resolve(from);
    const b = resolve(to);
    if (!a || !b) return;
    const moved = inv.moveStack(a.arr, a.local, b.arr, b.local);
    if (!moved) return;

    // Resolve each side's destination BEFORE writing: the first write reassigns
    // player.inventory, which would make a later `arr === player.inventory` check
    // stale and misroute an inventory↔inventory move into the open chest.
    const aIsInventory = a.arr === player.inventory;
    const bIsInventory = b.arr === player.inventory;
    const writeBack = (isInventory: boolean, next: InventorySlot[]): void => {
      if (isInventory) player.inventory = next;
      else if (openIndex !== null) state.containers.set(openIndex, next);
    };
    writeBack(aIsInventory, moved.a);
    writeBack(bIsInventory, moved.b);
  }

  /** Armor-mitigated combat damage to a specific player (mob melee/arrows, explosions). */
  private damageCombat = (player: PlayerState, amount: number): void => {
    const heartsBefore = player.hearts;
    const died = applyDamageWithArmor(player, amount, this.rng);
    if (died) {
      if (this.state.hardcore) return void this.triggerGameOver(player);
      clearEffects(player);
      resetMining(player);
      this.emit({ type: "died" }, player.id);
    } else if (player.hearts < heartsBefore) {
      this.emit({ type: "playerHurt" }, player.id);
    }
  };

  /** Armor-bypassing environmental damage to a specific player (fall/void/lava/water/drowning/starvation). */
  private damageEnvironmental = (player: PlayerState, amount: number): void => {
    const heartsBefore = player.hearts;
    const died = applyUnmitigatedDamage(player, amount);
    if (died) {
      if (this.state.hardcore) return void this.triggerGameOver(player);
      clearEffects(player);
      resetMining(player);
      this.emit({ type: "died" }, player.id);
    } else if (player.hearts < heartsBefore) {
      this.emit({ type: "playerHurt" }, player.id);
    }
  };

  /**
   * Hardcore permadeath. The run is over: instead of the respawn countdown the
   * player is dropped into a Spectator free-cam over their dead world and a
   * persisted gameOver flag fires the Game Over screen. We deliberately leave
   * isDead/respawnTimer cleared so the respawn DeathScreen never shows, and set
   * the mode DIRECTLY (not via the now-locked switchGameMode). The shell saves
   * on the {type:"gameOver"} event so closing the tab still resumes the dead world.
   */
  private triggerGameOver(player: PlayerState): void {
    player.gameOver = true;
    player.gameMode = "spectator"; // free-cam roam; takesDamage=false → fully inert
    player.isFlying = true;
    player.isDead = false;
    player.respawnTimer = 0;
    player.hearts = 0; // the run's final state (bars are hidden in spectator anyway)
    clearEffects(player);
    resetMining(player);
    player.inventoryOpen = false;
    player.craftingStation = null;
    player.openContainerIndex = null;
    this.state.paused = false;
    this.emit({ type: "gameOver" }, player.id);
  }

  /**
   * Rebuilds the live MobState for each validated SavedMob: re-grounds onto the
   * current surface (the world may have changed since the save), assigns a fresh
   * id via pushMob, then restores the persisted hp/faction/owner/sit/baby state.
   * hp is clamped to the kind's template max — owned pets get a generous ceiling,
   * since a tamed pet's hp can exceed the wild template (refined when companions land).
   */
  private restorePersistedMobs(saved: SavedMob[]): void {
    for (const m of saved) {
      const ground = this.surfaceYAt(m.x, m.z);
      const hostile = m.faction === "hostile" || m.faction === "raider";
      pushMob(this.state, m.kind, hostile, m.x, ground, m.z, this.rng);
      const mob = this.state.mobs[this.state.mobs.length - 1];
      mob.faction = m.faction;
      // A tamed pet's hp/detectRange exceed its wild template — restore the pet
      // ceiling and fight range so it stays a healthy, fighting ally.
      if (m.owner != null) {
        mob.owner = m.owner;
        mob.hp = Math.min(m.hp, PET_TAMED_HP);
        mob.detectRange = PET_FIGHT_RANGE;
      } else {
        mob.hp = Math.min(m.hp, MOB_TEMPLATES[m.kind].hp);
      }
      if (m.sitting) mob.sitting = true;
      if (m.profession) mob.profession = m.profession;
      if (m.ageTimer && m.ageTimer > 0) {
        mob.ageTimer = m.ageTimer;
        mob.halfHeight = mobHalfHeight(m.kind) * BABY_SCALE;
        mob.position.y = ground + mob.halfHeight; // re-center on the shrunk height so a baby doesn't float
      }
    }
  }

  // `credit` (default true) gates loot + XP to the player: player/arrow/spear/
  // explosion kills credit; the mobAI sweep passes the victim's faction so a pet's
  // kill still feeds you, but a slain villager or pet yields nothing.
  private removeMobAt = (index: number, lootingLevel = 0, credit = true, creditTo?: PlayerState): void => {
    const state = this.state;
    const mob = state.mobs[index];
    state.mobs.splice(index, 1);
    // The killer: an explicit creditTo, else the player who last damaged this mob
    // (melee/arrow/spear/pet-bite, tracked on the mob so even a sweep death — burn,
    // explosion — credits them), else the primary. Loot, XP, and the kill's
    // progression all follow them. A playerless room with no killer credits nobody.
    const killer = creditTo ?? (mob.lastHitByPlayer !== undefined ? state.players.get(mob.lastHitByPlayer) : undefined);
    const receiver = killer ?? state.players.get(state.primaryPlayerId) ?? null;
    // Babies drop nothing — only grown animals yield loot. `lootingLevel` is the
    // *killing* melee weapon's Looting (forwarded by tryAttackMob); indirect kills
    // (arrows, thrown spears, explosions) pass 0, since Looting is a melee enchant.
    const drops = credit && receiver && mob.ageTimer <= 0 ? rollMobDrops(mob.kind, this.rng, lootingLevel) : [];
    if (receiver) {
      for (const drop of drops) {
        receiver.inventory = inv.adjustSlotCount(receiver.inventory, drop.itemId, drop.count) ?? receiver.inventory;
      }
      // XP on kill, baby-gated like drops; the boss pays a jackpot.
      if (credit && mob.ageTimer <= 0) awardXp(receiver, xpForMob(mob.kind), this.emit);
    }
    // Attribute the death (and its "Monster Hunter"/"Dragon Slayer" progression)
    // to the killer so each co-op player earns their own kills.
    this.emit({ type: "mobDied", kind: mob.kind, x: mob.position.x, y: mob.position.y, z: mob.position.z }, receiver?.id);
    // Drops land straight in inventory (no ground item), so announce them.
    if (drops.length > 0) this.emit({ type: "pickedUp", items: drops }, receiver?.id);
    // Defeating the boss is the win condition — fire the one-shot victory.
    if (mob.kind === "boss") {
      state.victory = true;
      this.emit({ type: "bossDefeated", x: mob.position.x, y: mob.position.y, z: mob.position.z }, receiver?.id);
    }
  };

  /**
   * Summons the boss from a held Cursed Totem at a seeded land point near the
   * player, consuming the totem. Refuses (keeping the totem) when a boss already
   * walks. Returns true when the click was consumed.
   */
  private trySummonBoss(player: PlayerState): boolean {
    const state = this.state;
    const slot = player.inventory[player.selectedSlot];
    if (slot?.id !== "boss_summoner" || slot.count <= 0) return false;
    if (state.mobs.some((mob) => mob.kind === "boss")) {
      this.emit({ type: "summonFailed" });
      return true;
    }
    const point = randomLandPointNear(state.world, this.surfaceYAt, player.position.x, player.position.z, BOSS_SUMMON_RADIUS, this.rng);
    spawnBoss(state, point.x, point.y, point.z, this.rng);
    player.inventory = inv.adjustSlotCount(player.inventory, "boss_summoner", -1, player.selectedSlot) ?? player.inventory;
    this.emit({ type: "bossSummoned", x: point.x, y: point.y, z: point.z });
    return true;
  }

  /**
   * Sounds a held Ominous Horn at the nearest village (within RAID_TRIGGER_DISTANCE)
   * to start a raid, consuming the horn. Refuses (keeping it) when a raid is already
   * running; does nothing (returns false, so placement falls through) when no village
   * is in range or the difficulty is Peaceful.
   */
  private tryStartRaid(player: PlayerState): boolean {
    const state = this.state;
    const slot = player.inventory[player.selectedSlot];
    if (slot?.id !== "ominous_horn" || slot.count <= 0) return false;
    if (state.raid) {
      this.emit({ type: "raidFailed" });
      return true;
    }
    const { x, z } = player.position;
    let nearest: { x: number; z: number } | null = null;
    let bestSq = RAID_TRIGGER_DISTANCE * RAID_TRIGGER_DISTANCE;
    for (const site of state.villageSites) {
      const d = (site.x - x) * (site.x - x) + (site.z - z) * (site.z - z);
      if (d < bestSq) {
        bestSq = d;
        nearest = site;
      }
    }
    if (!nearest || !startRaid(state, nearest.x, nearest.z)) return false;
    player.inventory = inv.adjustSlotCount(player.inventory, "ominous_horn", -1, player.selectedSlot) ?? player.inventory;
    this.emit({ type: "raidStarted", totalWaves: RAID_WAVE_COUNT });
    return true;
  }

  private get mobTickDeps() {
    return {
      surfaceYAt: this.surfaceYAt,
      damagePlayer: this.damageCombat,
      removeMobAt: this.removeMobAt,
      rng: this.rng,
      emit: this.emit
    };
  }

  /**
   * Switches the live game mode (from the pause menu), resetting transient state
   * so nothing leaks across: queued hazard damage is cleared, the bars refill
   * (hidden anyway in no-damage modes), flight matches the mode (Spectator
   * always airborne), open panels close, and leaving noclip lifts the player out
   * of any wall they were sitting in.
   */
  private switchGameMode(player: PlayerState, next: GameMode): void {
    const state = this.state;
    if (state.hardcore) return; // locked to Survival (Spectator after game-over); the death transition sets the mode directly
    if (!isGameMode(next) || next === player.gameMode || player.isDead) return;
    player.gameMode = next;

    const t = player.timers;
    t.lavaBurnTimer = 0;
    t.lavaDamageTimer = 0;
    t.voidTimer = 0;
    t.waterExposureTimer = 0;
    t.waterDamageTimer = 0;
    t.drownTimer = 0;
    player.hearts = MAX_HEARTS;
    player.hunger = MAX_HUNGER;
    player.oxygen = MAX_OXYGEN;

    player.isFlying = next === "spectator";
    resetMining(player);
    player.inventoryOpen = false;
    player.craftingStation = null;
    player.openContainerIndex = null;

    if (!isNoclip(next) && (collidesAt(state.world, player.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT) || player.position.y < 2)) {
      this.forceUnstuck(player);
    }
  }

  /**
   * Switches the live difficulty (from the pause menu). The spawn directors and
   * mob AI read state.difficulty every tick, so raising/lowering just changes the
   * numbers they use next tick — the one thing needing action here is dropping to
   * Peaceful, which must clear the hostiles already on the field (the directors
   * only govern *new* spawns). Resetting the starvation accumulator stops a stale
   * timer from biting right after a Peaceful→Hard flip. Unlike switchGameMode this
   * has no respawn-coupled state to guard, so it is allowed even while dead — a
   * player should be able to flip to Peaceful to stop a hostile pile-on.
   */
  private switchDifficulty(next: Difficulty): void {
    const state = this.state;
    if (state.hardcore) return; // locked to Hard for the world's life
    if (!isDifficulty(next) || next === state.difficulty) return;
    state.difficulty = next;
    for (const p of state.players.values()) p.timers.starvationTimer = 0;
    if (!hostilesSpawn(next)) this.despawnHostiles();
  }

  /**
   * Silently removes every hostile mob (the Peaceful switch). A plain splice — not
   * removeMobAt — so there is no loot, no XP, and no false boss victory; the
   * renderer drops the orphaned models when it reconciles state.mobs by id.
   * Descends so the splices don't shift the indices still to be visited.
   */
  private despawnHostiles(): void {
    const mobs = this.state.mobs;
    for (let i = mobs.length - 1; i >= 0; i -= 1) {
      if (mobs[i].hostile) mobs.splice(i, 1);
    }
  }

  private forceUnstuck(player: PlayerState): void {
    const state = this.state;
    const safe = findSpawnOnLand(state.world, player.position.x, player.position.z, true);
    player.position.set(safe.x, safe.y, safe.z);
    player.velocity.set(0, 0, 0);
    player.onGround = false;
    state.worldMeshDirty = true;
  }

  private respawn(player: PlayerState): void {
    const state = this.state;
    const bed = player.spawnPoint;
    if (bed && state.world.get(bed.x, bed.y, bed.z) === BlockId.Bed) {
      // Respawn standing on the bed; the bed block is non-solid head room above it.
      player.position.set(bed.x + 0.5, bed.y + 1.05, bed.z + 0.5);
    } else {
      const spawn = randomLandPointNear(state.world, this.surfaceYAt, state.world.sizeX / 2, state.world.sizeZ / 2, RENDER_RADIUS * 0.9, this.rng);
      player.position.set(spawn.x, spawn.y + 2, spawn.z);
    }
    player.velocity.set(0, 0, 0);
    player.pitch = 0;
    clearEffects(player);
    resetMining(player);
    state.thrownSpears = [];
    player.fishing = null;
    state.worldMeshDirty = true;
    this.events.push({ type: "respawned" });
  }

  /** Advances the day clock to the next morning after a sleep completes. */
  private wakeToMorning(): void {
    const state = this.state;
    for (const p of state.players.values()) p.sleeping = false;
    const nextDay = Math.floor(state.dayClock / DAY_CYCLE_SECONDS) + 1;
    state.dayClock = (nextDay + WAKE_DAY_PHASE) * DAY_CYCLE_SECONDS;
    state.daylight = daylightAt(state.dayClock);
    state.daylightPercent = Math.round(state.daylight * 100);
    this.emit({ type: "wokeUp" });
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

  /** Boss HUD data as a ref-stable object, rebuilt only when a visible rounded value moves. */
  private bossSnapshot(): ({ hpPercent: number } & BossTracking) | null {
    const bossMob = this.state.mobs.find((mob) => mob.kind === "boss");
    if (!bossMob) {
      if (this.lastBoss !== null) this.lastBoss = null;
      return null;
    }
    const percent = Math.max(0, Math.min(1, Math.round((bossMob.hp / BOSS_HP) * 100) / 100));
    const tracking = bossTracking(this.state.player, bossMob);
    if (
      !this.lastBoss ||
      percent !== this.lastBoss.hpPercent ||
      tracking.bearingDegrees !== this.lastBoss.bearingDegrees ||
      tracking.distanceBlocks !== this.lastBoss.distanceBlocks
    ) {
      this.lastBoss = { hpPercent: percent, ...tracking };
    }
    return this.lastBoss;
  }

  /**
   * Treasure-compass HUD data as a ref-stable object, rebuilt only when a
   * rounded value moves. Non-null only while the selected hotbar item is a
   * treasure map and an unlooted buried chest remains; the target is always the
   * nearest unlooted site, so digging one up retargets the compass for free.
   */
  private treasureSnapshot(): BossTracking | null {
    const state = this.state;
    if (state.inventory[state.selectedSlot]?.id !== "treasure_map") {
      if (this.lastTreasure !== null) this.lastTreasure = null;
      return null;
    }
    let best: { x: number; z: number } | null = null;
    let bestSq = Infinity;
    for (const site of state.treasureSites) {
      if (state.lootedWorldgenChests.has(site.index)) continue;
      const dx = site.x - state.player.position.x;
      const dz = site.z - state.player.position.z;
      const d = dx * dx + dz * dz;
      if (d < bestSq) {
        bestSq = d;
        best = site;
      }
    }
    if (!best) {
      if (this.lastTreasure !== null) this.lastTreasure = null;
      return null;
    }
    const tracking = trackTarget(state.player, best.x + 0.5, best.z + 0.5);
    if (!this.lastTreasure || tracking.bearingDegrees !== this.lastTreasure.bearingDegrees || tracking.distanceBlocks !== this.lastTreasure.distanceBlocks) {
      this.lastTreasure = tracking;
    }
    return this.lastTreasure;
  }

  /**
   * Active effects as a ref-stable array, rebuilt only when the visible content
   * (ids or rounded seconds) changes — `Math.ceil(remaining)` only moves on
   * integer-second boundaries, so the HUD countdown re-renders ~1 Hz, not 60 Hz.
   */
  private effectsProjection(): GameSnapshot["activeEffects"] {
    const next: GameSnapshot["activeEffects"] = [];
    for (const id of EFFECT_ORDER) {
      const remaining = this.state.effects.get(id);
      if (remaining && remaining > 0) next.push({ id, seconds: Math.ceil(remaining) });
    }
    const key = next.map((entry) => `${entry.id}:${entry.seconds}`).join(",");
    if (key !== this.lastEffectsKey) {
      this.lastEffectsKey = key;
      this.lastEffects = next;
    }
    return this.lastEffects;
  }

  private buildSnapshot(): GameSnapshot {
    const state = this.state;
    return {
      api: this,
      inventory: state.inventory,
      equippedArmor: state.equippedArmor,
      selectedSlot: state.selectedSlot,
      gameMode: state.gameMode,
      difficulty: state.difficulty,
      hardcore: state.hardcore,
      gameOver: state.gameOver,
      isFlying: state.isFlying,
      hearts: state.hearts,
      hunger: state.hunger,
      oxygen: state.oxygen,
      daylightPercent: state.daylightPercent,
      passiveCount: state.mobs.reduce((acc, mob) => acc + (mob.hostile ? 0 : 1), 0),
      hostileCount: state.mobs.reduce((acc, mob) => acc + (mob.hostile ? 1 : 0), 0),
      respawnSeconds: state.isDead ? Math.max(0, Math.ceil(state.respawnTimer)) : 0,
      inventoryOpen: state.inventoryOpen,
      advancementsOpen: state.advancementsOpen,
      advancementsUnlocked: state.advancements.size,
      paused: state.paused,
      debugOpen: state.debugOpen,
      debug: state.debugInfo,
      cameraMode: state.cameraMode,
      armorPoints: inv.equippedDefense(state.equippedArmor),
      capsActive: state.capsActive,
      sleeping: state.sleepTimer > 0,
      craftingStation: state.craftingStation,
      activeVillagerProfession: state.activeVillagerProfession,
      container: state.openContainerIndex !== null ? (state.containers.get(state.openContainerIndex) ?? null) : null,
      boss: this.bossSnapshot(),
      treasure: this.treasureSnapshot(),
      victory: state.victory,
      activeEffects: this.effectsProjection(),
      xpLevel: xpLevel(state.xp),
      xpProgress: xpProgress(state.xp)
    };
  }

  private refreshSnapshot(): void {
    // A headless server room has no React shell: nobody subscribes, so the
    // (primary-player-shaped) snapshot would be pure wasted work every tick.
    if (this.headless) return;
    const next = this.buildSnapshot();
    const prev = this.snapshot;
    const changed = (Object.keys(next) as Array<keyof GameSnapshot>).some((key) => next[key] !== prev[key]);
    if (!changed) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
