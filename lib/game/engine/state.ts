import * as THREE from "three";
import { VoxelWorld, type BlockId } from "@/lib/world";
import type { BossTracking } from "@/lib/game/bossTracking";
import type { EffectId, EquippedArmor, InventorySlot, MobKind, SaveData } from "@/lib/game/types";
import type { BlockChangeTracker } from "./blockChanges";
import type { Command } from "./commands";

/** Session-only camera presentation mode; never persisted. Gameplay stays eye-relative in all modes. */
export type CameraMode = "first" | "third-rear" | "third-front";

const CAMERA_MODE_CYCLE: readonly CameraMode[] = ["first", "third-rear", "third-front"];

export function nextCameraMode(mode: CameraMode): CameraMode {
  return CAMERA_MODE_CYCLE[(CAMERA_MODE_CYCLE.indexOf(mode) + 1) % CAMERA_MODE_CYCLE.length];
}

export type PlayerState = {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Look direction; the renderer derives the camera from these. Order YXZ. */
  yaw: number;
  pitch: number;
  onGround: boolean;
};

/** Simulation-side mob — no Three.js objects; visuals live in the renderer. */
export type MobState = {
  id: number;
  kind: MobKind;
  hostile: boolean;
  hp: number;
  /** Body center (ground + halfHeight), like the old group.position without bob. */
  position: THREE.Vector3;
  direction: THREE.Vector3;
  yaw: number;
  turnTimer: number;
  speed: number;
  /** Speed after aggro/flee multipliers this tick; renderer uses it for gait. */
  moveSpeed: number;
  detectRange: number;
  attackDamage: number;
  attackCooldown: number;
  attackTimer: number;
  halfHeight: number;
  bobSeed: number;
  /** Seconds left "in love" after being fed; pairs with another to breed. */
  fedTimer: number;
  /** Seconds left as a baby; > 0 means a scaled-down, no-drop juvenile. */
  ageTimer: number;
  /** Boss-only: seconds until the next minion summon (session-only, never saved). */
  summonTimer?: number;
  /** Creeper-only: seconds left on a lit fuse (>0 means primed); detonates at 0. Session-only. */
  fuseTimer?: number;
};

/**
 * Simulation-side projectile (arrow) — transient, never serialized, like mobs.
 * Shared by the player's bow, ranged skeletons, and the boss; `fromPlayer` is
 * the hit filter (player arrows hit mobs, mob arrows hit the player).
 */
export type ProjectileState = {
  id: number;
  position: THREE.Vector3;
  /** m/s; gravity-integrated each step. yaw/pitch are derived from it for the renderer. */
  velocity: THREE.Vector3;
  yaw: number;
  pitch: number;
  damage: number;
  knockback: number;
  fromPlayer: boolean;
  /** Seconds remaining before the arrow despawns mid-air. */
  ttl: number;
};

export type MiningState = {
  /** "x,y,z" of the block being mined, or "" when idle. */
  targetKey: string;
  progress: number;
};

export type ThrownSpearState = {
  id: number;
  itemId: string;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  damage: number;
  age: number;
  /** Seconds embedded in terrain, or null while still flying. */
  stuckTimer: number | null;
};

/**
 * The one active fishing cast — session-only, never serialized (like projectiles).
 * `timer` counts down to the next state change: while `!biting` it's the wait for a
 * bite; once `biting` it's the reel window before the catch gets away.
 */
export type FishingState = {
  position: THREE.Vector3;
  timer: number;
  biting: boolean;
};

/** Throttled (~4 Hz) readout for the F3 overlay; null while the overlay is closed. */
export type DebugInfo = {
  x: number;
  y: number;
  z: number;
  daylight: number;
};

export type GameTimers = {
  voidTimer: number;
  regenTimer: number;
  waterExposureTimer: number;
  waterDamageTimer: number;
  /** Seconds of lava burn left; refreshed to LAVA_BURN_SECONDS on contact. */
  lavaBurnTimer: number;
  lavaDamageTimer: number;
  /** Accumulates drowning damage once oxygen is exhausted. */
  drownTimer: number;
  sprintDistanceBudget: number;
  walkDistanceBudget: number;
  jumpBudget: number;
  /** Regeneration-effect heal accumulator — independent of the hunger-gated regenTimer. */
  effectRegenTimer: number;
  /** Poison-effect damage accumulator. */
  effectPoisonTimer: number;
  stuckTimer: number;
  hostileSpawnTimer: number;
  spawnerTimer: number;
  daylightHudTimer: number;
  debugHudTimer: number;
  randomTickTimer: number;
  breedTimer: number;
  spearThrowCooldown: number;
  /** Seconds until the bow can fire again (instant click-to-fire rate limit). */
  bowCooldownTimer: number;
};

export type WeatherKind = "clear" | "rain" | "snow";
export type WeatherState = { kind: WeatherKind; intensity: number };

export type GameState = {
  world: VoxelWorld;
  blockChanges: BlockChangeTracker;
  player: PlayerState;
  inventory: InventorySlot[];
  equippedArmor: EquippedArmor;
  selectedSlot: number;
  hearts: number;
  hunger: number;
  /** Remaining breath, 0..MAX_OXYGEN. Session-only; refills out of water. */
  oxygen: number;
  /** Active status effects → remaining seconds. Persisted (save v6); cleared on death. */
  effects: Map<EffectId, number>;
  /** Banked XP points (XP_PER_LEVEL points = 1 level). Persisted (save v7); NOT cleared on death. */
  xp: number;
  isDead: boolean;
  respawnTimer: number;
  inventoryOpen: boolean;
  /** Crafting station whose recipes are unlocked while the inventory is open, or null. */
  craftingStation: "furnace" | "villager" | "brewing" | null;
  /** Chest contents (block-entities) keyed by the block's voxel index. */
  containers: Map<number, InventorySlot[]>;
  /** Lit TNT keyed by voxel index → seconds left on its fuse (session-only, never serialized). */
  primedTnt: Map<number, number>;
  /** Voxel index of the chest open in the inventory panel, or null. */
  openContainerIndex: number | null;
  /** Worldgen dungeon chest voxel indices (session; re-derived from the seed each load). */
  dungeonChestIndices: Set<number>;
  /** Worldgen dungeon spawner voxel indices (session; re-derived from the seed each load). */
  dungeonSpawnerIndices: Set<number>;
  /** Dungeon chests already opened/broken (persisted) — gates one-time lazy loot fill. */
  lootedDungeonChests: Set<number>;
  /** Frozen simulation behind the pause menu; only commands are processed. */
  paused: boolean;
  debugOpen: boolean;
  debugInfo: DebugInfo | null;
  cameraMode: CameraMode;
  capsActive: boolean;
  mobs: MobState[];
  nextMobId: number;
  thrownSpears: ThrownSpearState[];
  nextThrownSpearId: number;
  /** In-flight arrows (session-only; never serialized). */
  projectiles: ProjectileState[];
  nextProjectileId: number;
  /** The active fishing cast, or null when not fishing (session-only). */
  fishing: FishingState | null;
  dayClock: number;
  /** Derived from dayClock every tick; 0.04–1.0. */
  daylight: number;
  daylightPercent: number;
  /** Cosmetic, transient weather (never serialized). Drives precip + sky + audio. */
  weather: WeatherState;
  /** Seconds left in the sleep fade; > 0 freezes the sim until time skips. */
  sleepTimer: number;
  /** Bed respawn point (block coords), or null to respawn at a random land point. */
  spawnPoint: { x: number; y: number; z: number } | null;
  mining: MiningState;
  timers: GameTimers;
  /** Set when world geometry changed; the renderer rebuilds the mesh and clears it. */
  worldMeshDirty: boolean;
  /** True once the boss has been defeated — drives the one-shot victory screen (session-only). */
  victory: boolean;
};

export function createTimers(): GameTimers {
  return {
    voidTimer: 0,
    regenTimer: 0,
    waterExposureTimer: 0,
    waterDamageTimer: 0,
    lavaBurnTimer: 0,
    lavaDamageTimer: 0,
    drownTimer: 0,
    sprintDistanceBudget: 0,
    walkDistanceBudget: 0,
    jumpBudget: 0,
    effectRegenTimer: 0,
    effectPoisonTimer: 0,
    stuckTimer: 0,
    hostileSpawnTimer: 0,
    spawnerTimer: 0,
    daylightHudTimer: 0,
    debugHudTimer: 0,
    randomTickTimer: 0,
    breedTimer: 0,
    spearThrowCooldown: 0,
    bowCooldownTimer: 0
  };
}

/** Per-frame continuous input, owned by the input controller. */
export type FrameInput = {
  keys: ReadonlySet<string>;
  capsActive: boolean;
  leftMouseHeld: boolean;
  pointerLocked: boolean;
};

export const IDLE_INPUT: FrameInput = {
  keys: new Set<string>(),
  capsActive: false,
  leftMouseHeld: false,
  pointerLocked: false
};

/** The engine surface the UI may touch: intents in, save data out. */
export type GameApi = {
  dispatch(command: Command): void;
  serialize(): SaveData;
};

/** Immutable view for the React UI, replaced only when a visible value changes. */
export type GameSnapshot = {
  /** Stable handle for dispatching intents; null until the engine exists. */
  api: GameApi | null;
  inventory: InventorySlot[];
  equippedArmor: EquippedArmor;
  selectedSlot: number;
  hearts: number;
  hunger: number;
  /** Remaining breath, 0..MAX_OXYGEN — drives the bubble bar (hidden when full). */
  oxygen: number;
  daylightPercent: number;
  passiveCount: number;
  hostileCount: number;
  respawnSeconds: number;
  inventoryOpen: boolean;
  paused: boolean;
  debugOpen: boolean;
  debug: DebugInfo | null;
  cameraMode: CameraMode;
  /** Total defense points of equipped armor — drives the HUD armor bar. */
  armorPoints: number;
  capsActive: boolean;
  /** True during the sleep fade — drives the fade-to-black overlay. */
  sleeping: boolean;
  /** Open crafting station (gates smelting recipes in the inventory panel). */
  craftingStation: "furnace" | "villager" | "brewing" | null;
  /** Contents of the open chest, or null when no chest is open. */
  container: InventorySlot[] | null;
  /** Live boss health and navigation data, or null when no boss is alive — drives the boss HUD. */
  boss: ({ hpPercent: number } & BossTracking) | null;
  /** True after the boss is defeated — drives the victory screen. */
  victory: boolean;
  /** Active status effects (id + rounded seconds left) — drives the HUD effects readout. Ref-stable between content changes. */
  activeEffects: Array<{ id: EffectId; seconds: number }>;
};

/** One-shot gameplay events for the shell (death screen, audio, ...). */
export type GameEvent =
  | { type: "died" }
  | { type: "respawned" }
  | { type: "blockBroken"; blockId: BlockId; x: number; y: number; z: number }
  | { type: "blockPlaced"; blockId: BlockId; x: number; y: number; z: number }
  | { type: "playerHurt" }
  | { type: "ateFood" }
  | { type: "drankPotion" }
  | { type: "effectExpired"; effect: EffectId }
  | { type: "xpGained"; amount: number }
  | { type: "jumped" }
  | { type: "landed"; impact: number }
  | { type: "mobAttacked"; kind: MobKind }
  | { type: "mobHit"; kind: MobKind }
  | { type: "mobDied"; kind: MobKind; x: number; y: number; z: number }
  | { type: "mobSpawned"; kind: MobKind; x: number; y: number; z: number }
  | { type: "arrowHit"; x: number; y: number; z: number; target: "block" | "mob" | "player" }
  | { type: "bowFired" }
  | { type: "bossSummoned"; x: number; y: number; z: number }
  | { type: "bossDefeated"; x: number; y: number; z: number }
  | { type: "summonFailed" }
  | { type: "explosion"; x: number; y: number; z: number; power: number }
  | { type: "tntPrimed"; x: number; y: number; z: number }
  | { type: "attackSwung" }
  | { type: "sleepStarted" }
  | { type: "sleepDenied"; reason: "daylight" | "hostiles" }
  | { type: "wokeUp" }
  | { type: "tilledSoil" }
  | { type: "plantedSeed" }
  | { type: "plantedSapling" }
  | { type: "usedBoneMeal" }
  | { type: "fishingCast"; x: number; y: number; z: number }
  | { type: "fishingBite"; x: number; y: number; z: number }
  | { type: "fishingCaught"; items: Array<{ itemId: string; count: number }>; x: number; y: number; z: number }
  | { type: "fishingReeledEmpty" }
  | { type: "openedStation"; station: "furnace" | "villager" | "brewing" }
  | { type: "openedContainer" }
  | { type: "doorToggled"; open: boolean }
  | { type: "breakBlocked"; reason: "containerFull" }
  | { type: "smelted" }
  | { type: "mobFed"; kind: MobKind }
  | { type: "mobBred"; kind: MobKind }
  | { type: "pickedUp"; items: Array<{ itemId: string; count: number }> };

export type EmitGameEvent = (event: GameEvent) => void;
