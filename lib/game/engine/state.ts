import * as THREE from "three";
import { VoxelWorld, type BlockId } from "@/lib/world";
import type { EquippedArmor, InventorySlot, MobKind, SaveData } from "@/lib/game/types";
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
};

export type MiningState = {
  /** "x,y,z" of the block being mined, or "" when idle. */
  targetKey: string;
  progress: number;
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
  sprintDistanceBudget: number;
  walkDistanceBudget: number;
  jumpBudget: number;
  stuckTimer: number;
  hostileSpawnTimer: number;
  daylightHudTimer: number;
  debugHudTimer: number;
  randomTickTimer: number;
  breedTimer: number;
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
  isDead: boolean;
  respawnTimer: number;
  inventoryOpen: boolean;
  /** Crafting station whose recipes are unlocked while the inventory is open, or null. */
  craftingStation: "furnace" | null;
  /** Chest contents (block-entities) keyed by the block's voxel index. */
  containers: Map<number, InventorySlot[]>;
  /** Voxel index of the chest open in the inventory panel, or null. */
  openContainerIndex: number | null;
  /** Frozen simulation behind the pause menu; only commands are processed. */
  paused: boolean;
  debugOpen: boolean;
  debugInfo: DebugInfo | null;
  cameraMode: CameraMode;
  capsActive: boolean;
  mobs: MobState[];
  nextMobId: number;
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
};

export function createTimers(): GameTimers {
  return {
    voidTimer: 0,
    regenTimer: 0,
    sprintDistanceBudget: 0,
    walkDistanceBudget: 0,
    jumpBudget: 0,
    stuckTimer: 0,
    hostileSpawnTimer: 0,
    daylightHudTimer: 0,
    debugHudTimer: 0,
    randomTickTimer: 0,
    breedTimer: 0
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
  craftingStation: "furnace" | null;
  /** Contents of the open chest, or null when no chest is open. */
  container: InventorySlot[] | null;
};

/** One-shot gameplay events for the shell (death screen, audio, ...). */
export type GameEvent =
  | { type: "died" }
  | { type: "respawned" }
  | { type: "blockBroken"; blockId: BlockId; x: number; y: number; z: number }
  | { type: "blockPlaced"; blockId: BlockId; x: number; y: number; z: number }
  | { type: "playerHurt" }
  | { type: "ateFood" }
  | { type: "jumped" }
  | { type: "landed"; impact: number }
  | { type: "mobAttacked"; kind: MobKind }
  | { type: "mobHit"; kind: MobKind }
  | { type: "mobDied"; kind: MobKind; x: number; y: number; z: number }
  | { type: "attackSwung" }
  | { type: "sleepStarted" }
  | { type: "sleepDenied"; reason: "daylight" | "hostiles" }
  | { type: "wokeUp" }
  | { type: "tilledSoil" }
  | { type: "plantedSeed" }
  | { type: "openedStation"; station: "furnace" }
  | { type: "openedContainer" }
  | { type: "breakBlocked"; reason: "containerFull" }
  | { type: "smelted" }
  | { type: "mobFed"; kind: MobKind }
  | { type: "mobBred"; kind: MobKind }
  | { type: "pickedUp"; items: Array<{ itemId: string; count: number }> };

export type EmitGameEvent = (event: GameEvent) => void;
