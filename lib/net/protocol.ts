import type { Command } from "@/lib/game/engine/commands";
import type { GameEvent } from "@/lib/game/engine/state";
import type { SavedContainer, SavedMob, SavedPlayer, SavedVehicle } from "@/lib/game/types";

/**
 * The client↔game-server wire protocol. Versioned as a whole: a client built
 * against a different PROTOCOL_VERSION is refused at the door (its join
 * ticket carries the number), so mid-session format drift can't happen.
 *
 * v1 is JSON envelopes discriminated on `t`, except the one big payload —
 * the join world-sync — which travels as a gzipped binary frame (see
 * codec.ts). The envelope layout deliberately leaves room to move the hot
 * paths (pose/tick) to packed binary later without renegotiating anything.
 *
 * Validation is hand-rolled and TOTAL (the save.ts house style): the server
 * feeds hostile bytes through these readers and gets a typed message or
 * null — never an exception, never a partially-checked object.
 */
export const PROTOCOL_VERSION = 1;

// ── close codes (WebSocket application range) ────────────────────────────────
export const CLOSE_BAD_TICKET = 4000;
export const CLOSE_PROTOCOL_MISMATCH = 4001;
export const CLOSE_ROOM_FULL = 4002;
export const CLOSE_KICKED = 4003;
export const CLOSE_IDLE_TIMEOUT = 4004;
export const CLOSE_SERVER_SHUTDOWN = 4005;
export const CLOSE_SLOW_CLIENT = 4008;

/** Max players per room (the v1 co-op scale the whole design assumes). */
export const ROOM_CAPACITY = 8;

// ── client → server ──────────────────────────────────────────────────────────

/** First frame on the socket: the join ticket (minted by the web API) + the client's protocol. */
export type HelloMessage = { t: "hello"; ticket: string; protocol: number };

/** The client-authoritative avatar pose, streamed at tick rate. */
export type PoseMessage = {
  t: "pose";
  seq: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  onGround: boolean;
  /** The player's live movement intents (server systems read them for vehicles etc.). */
  move: { forward: boolean; back: boolean; left: boolean; right: boolean; jump: boolean; sprint: boolean; crouch: boolean };
  mineHeld: boolean;
};

/**
 * A discrete command. Carries the client's claimed eye pose at click time:
 * the server applies it (sanity-checked like any pose) before dispatch, so
 * aimed raycasts (attack/placeBlock) resolve against the server's world from
 * where the client actually looked.
 */
export type CmdMessage = { t: "cmd"; seq: number; cmd: Command; pose: { x: number; y: number; z: number; yaw: number; pitch: number } };

export type ChatMessage = { t: "chat"; text: string };
export type PingMessage = { t: "ping"; id: number; tMs: number };
/** Ask for a fresh world-sync + mob keyframe (reconnect resume). */
export type ResyncMessage = { t: "resync" };

export type ClientMessage = HelloMessage | PoseMessage | CmdMessage | ChatMessage | PingMessage | ResyncMessage;

// ── server → client ──────────────────────────────────────────────────────────

export type RosterEntry = { id: string; name: string; skinId: string | null; x: number; y: number; z: number; yaw: number };

export type WelcomeMessage = {
  t: "welcome";
  protocol: number;
  playerId: string;
  worldId: string;
  seed: number;
  worldType: string;
  difficulty: string;
  hardcore: boolean;
  dayClock: number;
  tick: number;
  players: RosterEntry[];
};

/**
 * The join payload (sent as ONE gzipped binary frame right after welcome):
 * everything a client can't regenerate from the seed. Mirrors the v17 save's
 * world half plus the live session entities.
 */
export type WorldSync = {
  t: "worldSync";
  tick: number;
  dayClock: number;
  changes: Array<[number, number]>;
  blockEntities: SavedContainer[];
  lootedChests: number[];
  mobs: SavedMob[];
  liveMobs: MobPose[];
  vehicles: SavedVehicle[];
  players: RosterEntry[];
};

/** One mob's replicated pose (10 Hz, deadbanded; keyframed every ~5s). */
export type MobPose = { id: number; kind: string; hostile: boolean; x: number; y: number; z: number; yaw: number; hp: number; moveSpeed: number };

/** One player's replicated pose (20 Hz). */
export type PlayerPose = { id: string; x: number; y: number; z: number; yaw: number; pitch: number };

/**
 * The per-player private delta: the server-authoritative mirror of what the
 * SP snapshot shows about YOU. Only changed fields are present.
 */
export type SelfDelta = {
  inventorySlots?: SavedPlayer["inventorySlots"];
  equippedArmor?: SavedPlayer["equippedArmor"];
  selectedSlot?: number;
  hearts?: number;
  hunger?: number;
  oxygen?: number;
  xp?: number;
  effects?: SavedPlayer["effects"];
  isDead?: boolean;
  respawnSeconds?: number;
  gameMode?: string;
  sleeping?: boolean;
};

export type TickMessage = {
  t: "tick";
  n: number;
  /** Block writes this tick as [voxelIndex, blockId] — the replica's world mutation channel. */
  blocks?: Array<[number, number]>;
  /** Attributed world events since the last tick (block edits ride these). */
  ev: Array<GameEvent & { playerId?: string }>;
  /** Other players' poses (the recipient's own is omitted). */
  pp: PlayerPose[];
  /** Mob poses that moved past the deadband this window (10 Hz). */
  mp: MobPose[];
  /** Day clock, every ~20 ticks (clients advance it locally in between). */
  day?: number;
  /** The recipient's private state changes. */
  self?: SelfDelta;
};

export type MobsKeyframeMessage = { t: "mobsKeyframe"; n: number; mobs: MobPose[] };
export type PlayerJoinedMessage = { t: "playerJoined"; player: RosterEntry };
export type PlayerLeftMessage = { t: "playerLeft"; id: string };
export type ContainerMessage = { t: "container"; index: number; slots: SavedContainer["slots"] };
export type ChatBroadcastMessage = { t: "chat"; from: string; name: string; text: string };
export type PongMessage = { t: "pong"; id: number; tMs: number; serverTick: number };
/** Position correction: the client must snap its avatar here (failed pose sanity check). */
export type ForcePoseMessage = { t: "forcePose"; x: number; y: number; z: number; yaw: number; pitch: number };

export type ServerMessage =
  | WelcomeMessage
  | TickMessage
  | MobsKeyframeMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | ContainerMessage
  | ChatBroadcastMessage
  | PongMessage
  | ForcePoseMessage;

// ── validators (client → server only: the server is the hostile-input side) ──

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isStr = (v: unknown): v is string => typeof v === "string";

function readMove(v: unknown): PoseMessage["move"] | null {
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  const keys = ["forward", "back", "left", "right", "jump", "sprint", "crouch"] as const;
  const out = {} as Record<(typeof keys)[number], boolean>;
  for (const key of keys) {
    if (!isBool(m[key])) return null;
    out[key] = m[key] as boolean;
  }
  return out;
}

function readEyePose(v: unknown): CmdMessage["pose"] | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  if (!isNum(p.x) || !isNum(p.y) || !isNum(p.z) || !isNum(p.yaw) || !isNum(p.pitch)) return null;
  return { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch };
}

/**
 * Command allow-list: every dispatchable type with per-field checks. Unknown
 * or malformed commands are dropped here — dispatch never sees them. Local-
 * presentation commands (pause/debug/camera) are deliberately absent: they
 * have no business on a wire.
 */
export function readCommand(v: unknown): Command | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  switch (c.type) {
    case "selectSlot":
      return isNum(c.index) ? { type: "selectSlot", index: Math.floor(c.index) } : null;
    case "craft":
      return isStr(c.recipeId) ? { type: "craft", recipeId: c.recipeId } : null;
    case "swapSlots":
      return isNum(c.from) && isNum(c.to) ? { type: "swapSlots", from: Math.floor(c.from), to: Math.floor(c.to) } : null;
    case "moveStack":
      return isNum(c.from) && isNum(c.to) ? { type: "moveStack", from: Math.floor(c.from), to: Math.floor(c.to) } : null;
    case "toggleEquipArmor":
      return isNum(c.index) ? { type: "toggleEquipArmor", index: Math.floor(c.index) } : null;
    case "unequipArmor":
      return c.slot === "helmet" || c.slot === "chestplate" || c.slot === "leggings" || c.slot === "boots" ? { type: "unequipArmor", slot: c.slot } : null;
    case "anvilRename":
      return isStr(c.name) ? { type: "anvilRename", name: c.name.slice(0, 64) } : null;
    case "enchant":
      return isStr(c.enchant) ? ({ type: "enchant", enchant: c.enchant } as Command) : null;
    case "creativeGiveItem":
      return isStr(c.itemId) ? { type: "creativeGiveItem", itemId: c.itemId } : null;
    case "setGameMode":
      return isStr(c.mode) ? ({ type: "setGameMode", mode: c.mode } as Command) : null;
    case "setDifficulty":
      return isStr(c.difficulty) ? ({ type: "setDifficulty", difficulty: c.difficulty } as Command) : null;
    case "toggleInventory":
    case "toggleAdvancements":
    case "eatFood":
    case "drinkPotion":
    case "anvilCombine":
    case "anvilRepair":
    case "grindstoneStrip":
    case "placeBlock":
    case "attack":
    case "toggleFlight":
    case "unstuck":
    case "respawn":
    case "dismissVictory":
    case "wakeUp":
      return { type: c.type } as Command;
    default:
      return null;
  }
}

/** Parses one client frame (already JSON.parsed). Total: null for anything off-spec. */
export function readClientMessage(v: unknown): ClientMessage | null {
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  switch (m.t) {
    case "hello":
      return isStr(m.ticket) && isNum(m.protocol) ? { t: "hello", ticket: m.ticket, protocol: m.protocol } : null;
    case "pose": {
      if (!isNum(m.seq) || !isNum(m.x) || !isNum(m.y) || !isNum(m.z) || !isNum(m.yaw) || !isNum(m.pitch) || !isBool(m.onGround)) return null;
      const move = readMove(m.move);
      if (!move || !isBool(m.mineHeld)) return null;
      return { t: "pose", seq: m.seq, x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch, onGround: m.onGround, move, mineHeld: m.mineHeld };
    }
    case "cmd": {
      if (!isNum(m.seq)) return null;
      const cmd = readCommand(m.cmd);
      const pose = readEyePose(m.pose);
      if (!cmd || !pose) return null;
      return { t: "cmd", seq: m.seq, cmd, pose };
    }
    case "chat":
      return isStr(m.text) && m.text.trim().length > 0 ? { t: "chat", text: m.text.slice(0, 256) } : null;
    case "ping":
      return isNum(m.id) && isNum(m.tMs) ? { t: "ping", id: m.id, tMs: m.tMs } : null;
    case "resync":
      return { t: "resync" };
    default:
      return null;
  }
}
