import * as THREE from "three";
import { VoxelWorld, type BlockId } from "@/lib/world";
import type { EquippedArmor, InventorySlot, MobKind, SaveData } from "@/lib/game/types";
import type { BlockChangeTracker } from "./blockChanges";
import type { Command } from "./commands";

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
};

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
  /** Frozen simulation behind the pause menu; only commands are processed. */
  paused: boolean;
  debugOpen: boolean;
  debugInfo: DebugInfo | null;
  capsActive: boolean;
  mobs: MobState[];
  nextMobId: number;
  dayClock: number;
  /** Derived from dayClock every tick; 0.04–1.0. */
  daylight: number;
  daylightPercent: number;
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
    debugHudTimer: 0
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
  /** Total defense points of equipped armor — drives the HUD armor bar. */
  armorPoints: number;
  capsActive: boolean;
};

/** One-shot gameplay events for the shell (death screen, audio, ...). */
export type GameEvent =
  | { type: "died" }
  | { type: "respawned" }
  | { type: "blockBroken"; blockId: BlockId }
  | { type: "blockPlaced"; blockId: BlockId }
  | { type: "playerHurt" }
  | { type: "ateFood" }
  | { type: "jumped" }
  | { type: "landed"; impact: number }
  | { type: "mobAttacked"; kind: MobKind }
  | { type: "mobHit"; kind: MobKind }
  | { type: "attackSwung" };

export type EmitGameEvent = (event: GameEvent) => void;
