import { GameEngine, type DispatchOptions } from "@/lib/game/engine/GameEngine";
import type { Command } from "@/lib/game/engine/commands";
import { createMobPoseHistory, MELEE_REWIND_MAX_TICKS } from "./mobHistory";
import { createFixedTicker, TICK_SECONDS, type FixedTicker } from "@/lib/game/engine/tickDriver";
import {
  restorePlayerDimension,
  serializeEffects,
  serializeEquippedArmor,
  inventorySlotsSnapshot,
  serializeMobs,
  serializeContainers,
  serializeLootedChests,
  serializeStats
} from "@/lib/game/save";
import type { DimensionId, DimensionSection, SavedPlayer, SaveData } from "@/lib/game/types";
import type { PlayerState } from "@/lib/game/engine/state";
import { encodeServerMessage, gzipWorldSync, qAng, qPos } from "@/lib/net/codec";
import {
  CLOSE_KICKED,
  CLOSE_ROOM_FULL,
  CLOSE_SERVER_SHUTDOWN,
  CLOSE_SLOW_CLIENT,
  PROTOCOL_VERSION,
  ROOM_CAPACITY,
  type ClientMessage,
  type MobPose,
  type PlayerPose,
  type ProjectilePose,
  type RosterEntry,
  type SelfDelta,
  type ServerMessage,
  type TickMessage,
  type VehiclePose,
  type WorldSync
} from "@/lib/net/protocol";
import type { TicketClaims } from "@/lib/net/tickets";
import type { Persistence, WorldRecord } from "./persistence";

/**
 * One world room: an authoritative GameEngine **per active dimension** (a
 * "shard" — the overworld always; others as needed) on one fixed 20 Hz
 * ticker, fed by client poses/commands and broadcasting per-tick deltas
 * scoped to each client's dimension. Sockets are abstracted as ClientSink so
 * the whole class unit-tests with fakes; only index.ts binds it to real Bun
 * WebSockets.
 */

export type ClientSink = {
  send(data: string | Uint8Array): void;
  close(code: number, reason?: string): void;
  bufferedAmount(): number;
};

/**
 * One dimension's simulation + its per-dimension replication state. Every
 * voxel-indexed or entity-keyed structure lives here because ids and
 * coordinates only mean anything inside one engine's space — sharing a mob
 * shadow or lag-comp history across dimensions would resolve hits against
 * the wrong world.
 */
type DimensionShard = {
  dimension: DimensionId;
  engine: GameEngine;
  /** Per-tick mob positions for melee lag compensation (see handleMessage "cmd"). */
  mobHistory: ReturnType<typeof createMobPoseHistory>;
  mobShadow: Map<number, { x: number; y: number; z: number; hp: number }>;
  vehicleShadow: Map<number, { x: number; y: number; z: number; yaw: number; riderId: string | null }>;
  /** Count of live arrows broadcast last tick — drives one trailing empty `prj` frame so the client prunes the last one. */
  lastProjectileCount: number;
};

/** The per-tick broadcast data gathered from one shard, fanned out to that shard's clients only. */
type ShardTickData = {
  events: ReturnType<GameEngine["consumeEvents"]>;
  blocks: Array<[number, number]>;
  mobPoses: MobPose[];
  vehiclePoses: VehiclePose[];
  projectilePoses: ProjectilePose[];
  includeProjectiles: boolean;
};

type ClientConn = {
  playerId: string;
  name: string;
  skinId: string | null;
  role: "owner" | "member";
  /** Which dimension shard this client lives in (drives all tick fan-out + input routing). */
  dimension: DimensionId;
  /**
   * True from a travel handoff until the target dimension's worldSync has
   * been sent. Tick frames are withheld meanwhile — they'd describe a world
   * the client hasn't adopted yet and corrupt the replica it still runs.
   */
  pendingDimensionSync: boolean;
  sink: ClientSink;
  /** Highest pose seq applied (stale/replayed packets drop). */
  poseSeq: number;
  /** Tick of the last accepted pose (drives the clamp's elapsed time). */
  lastPoseTick: number;
  /** Per-second message budgets (reset each second-boundary tick). */
  budget: { cmd: number; chat: number; attack: number };
  /** Sustained-backpressure strikes toward a slow-client kick. */
  slowStrikes: number;
  /** Shadow of the last self-delta sent (reference/primitive compares). */
  shadow: {
    inventory: unknown;
    equippedArmor: unknown;
    selectedSlot: number;
    hearts: number;
    hunger: number;
    oxygen: number;
    xp: number;
    isDead: boolean;
    respawnSeconds: number;
    gameMode: string;
    sleeping: boolean;
    effectsKey: string;
    mountedVehicleId: number | null;
    advancementsSize: number;
    statsSig: string;
  } | null;
};

/**
 * Stats the client accrues on its own (recordTick runs on the replica), so they
 * never travel in the SelfDelta — only the event-driven counters the replica
 * can't derive (kills, blocks mined, crafts) sync.
 */
const CLIENT_LOCAL_STATS = new Set(["play_time", "distance_walked"]);

const PERSIST_INTERVAL_TICKS = 20 * 60; // 60s
const KEYFRAME_INTERVAL_TICKS = 20 * 5; // 5s
const DAY_INTERVAL_TICKS = 20; // 1s
const POSE_CHECKPOINT_TICKS = 20; // 1s — log pose anchors between commands
const MOB_DEADBAND_SQ = 0.05 * 0.05;
const BACKPRESSURE_SOFT_BYTES = 256 * 1024;
const BACKPRESSURE_KICK_BYTES = 1024 * 1024;
const BACKPRESSURE_KICK_STRIKES = 100; // ~5s of sustained >1MB at 20Hz
const DEFAULT_COMMAND_LOG_SIZE = 4096;
/**
 * How long an EMPTY nether shard lingers before it is persisted and dropped
 * (its ~40 MB engine freed). Long enough that a quick there-and-back doesn't
 * thrash worldgen; short enough that an abandoned nether doesn't hold memory.
 */
const DEFAULT_NETHER_SHARD_LINGER_MS = 60_000;
/**
 * Per-second cap on attack commands per client. Far above honest clicking,
 * but with lag-compensated rewind an unbounded rate would let a scripted
 * client sweep a mob's whole 900 ms position trail with varied view stamps.
 */
const MELEE_ATTACKS_PER_SECOND = 12;

/**
 * One entry in a room's replay log: a dispatched command (with its claimed eye
 * pose, plus the v3 view stamp when present) or a periodic pose anchor. Replay
 * ignores `view` — attack-replay fidelity was already approximate (1 s pose
 * anchors); it's recorded for offline diagnosis of rewind disputes.
 */
export type CommandLogEntry =
  | { tick: number; playerId: string; dim?: DimensionId; cmd: Command; pose: { x: number; y: number; z: number; yaw: number; pitch: number }; view?: number }
  | { tick: number; playerId: string; dim?: DimensionId; pose: { x: number; y: number; z: number; yaw: number; pitch: number } };

/** A room's replay log plus the world constants needed to reconstruct it offline (see server/scripts/replay.ts). */
export type RoomLogDump = {
  worldId: string;
  seed: number;
  worldType: string;
  difficulty: string;
  hardcore: boolean;
  tick: number;
  entries: CommandLogEntry[];
};

export class Room {
  readonly worldId: string;
  /** The dimension shards this room simulates (the overworld always exists). */
  private readonly shards = new Map<DimensionId, DimensionShard>();
  private readonly clients = new Map<string, ClientConn>();
  /** Persisted slices of players who left (merged into the stored save). */
  private readonly offlinePlayers = new Map<string, SavedPlayer>();
  private readonly persistence: Persistence;
  private ticker: FixedTicker | null = null;
  private tickCount = 0;
  private dirtySinceStore = false;
  /**
   * The nether's world half from an evicted shard, re-emitted by composeSave
   * until a new shard (whose boot save carries it) supersedes it. The
   * OVERWORLD engine's own pass-through (`foreignDimensions`) is captured at
   * ITS boot and goes stale the moment a nether engine runs — this room-level
   * override is what keeps nether builds alive across shard lifecycles.
   */
  private dormantNether: DimensionSection | undefined;
  /** Wall-clock ms since the nether shard emptied of players (linger-evict clock), or null while occupied/absent. */
  private netherEmptySinceMs: number | null = null;
  private readonly netherLingerMs = Number.parseInt(process.env.NETHER_SHARD_LINGER_MS ?? "", 10) || DEFAULT_NETHER_SHARD_LINGER_MS;
  /** Wall-clock ms when the room became empty (idle-eviction clock), or null while occupied. */
  emptySinceMs: number | null;
  /** p95-ish diagnostics: the slowest tick of the last window. */
  private slowestTickMs = 0;
  /**
   * Total bytes sent downstream (monotonic); diagnostics reports the delta
   * since its last read. Counts PRE-compression payload sizes — Bun exposes
   * no per-send compressed size, so with permessage-deflate negotiated the
   * real wire usage is smaller than `kbOutPerSec` suggests (documented in
   * tuning.md; check Fly egress metrics for wire-accurate numbers).
   */
  private bytesOut = 0;
  private lastDiagBytes = 0;
  private lastDiagTick = 0;
  /** Rolling replay log: recent commands + pose anchors (ring-bounded). */
  private readonly commandLog: CommandLogEntry[] = [];
  private readonly commandLogSize: number;

  constructor(
    record: WorldRecord,
    persistence: Persistence,
    private readonly now: () => number = () => Date.now(),
    commandLogSize = Number.parseInt(process.env.COMMAND_LOG_SIZE ?? "", 10) || DEFAULT_COMMAND_LOG_SIZE
  ) {
    this.worldId = record.id;
    this.persistence = persistence;
    this.commandLogSize = commandLogSize;
    this.shards.set(
      "overworld",
      this.makeShard(
        "overworld",
        new GameEngine({
          save: record.save,
          seed: record.seed,
          worldType: record.worldType as never,
          difficulty: record.difficulty as never,
          hardcore: record.hardcore,
          authority: "server",
          headless: true,
          bootPlayer: false
        })
      )
    );
    for (const saved of record.save?.players ?? []) this.offlinePlayers.set(saved.id, saved);
    this.emptySinceMs = this.now();
  }

  /** The overworld shard's engine — the room's anchor world (registry checks, replay constants, tests). */
  get engine(): GameEngine {
    return this.overworld.engine;
  }

  private get overworld(): DimensionShard {
    return this.shards.get("overworld")!;
  }

  private shardOf(conn: ClientConn): DimensionShard {
    return this.shards.get(conn.dimension) ?? this.overworld;
  }

  private makeShard(dimension: DimensionId, engine: GameEngine): DimensionShard {
    return { dimension, engine, mobHistory: createMobPoseHistory(), mobShadow: new Map(), vehicleShadow: new Map(), lastProjectileCount: 0 };
  }

  /**
   * The shard for a dimension, booting its engine on first demand (a portal
   * travel or a join-in-nether). Construction is synchronous — one worldgen
   * pass, no light bake (headless) — a one-time hitch on the shared tick
   * thread, same class as a room load. The boot save is the composed CURRENT
   * world so the new engine sees the freshest nether section and difficulty.
   */
  private ensureShard(dimension: DimensionId): DimensionShard {
    const existing = this.shards.get(dimension);
    if (existing) return existing;
    const base = this.overworld.engine;
    const shard = this.makeShard(
      dimension,
      new GameEngine({
        save: this.composeSave(),
        dimension,
        authority: "server",
        headless: true,
        bootPlayer: false
      })
    );
    this.shards.set(dimension, shard);
    this.netherEmptySinceMs = null;
    // Mirror world time immediately (the save carried it, but be explicit).
    shard.engine.state.dayClock = base.state.dayClock;
    return shard;
  }

  /**
   * The whole world as one save: the overworld engine's serialize (its own
   * top-level world half) with the LIVE nether shard's section and players
   * layered on — or the dormant section from an evicted shard. Overrides the
   * overworld engine's boot-captured pass-through, which is stale by now (the
   * drift-trap comment on `dormantNether`).
   */
  private composeSave(): SaveData {
    const save = this.overworld.engine.serialize();
    const nether = this.shards.get("nether");
    if (nether) {
      const netherSave = nether.engine.serialize();
      const section = netherSave.dimensions?.nether;
      if (section) save.dimensions = { ...save.dimensions, nether: section };
      save.players = [...save.players, ...netherSave.players];
    } else if (this.dormantNether) {
      save.dimensions = { ...save.dimensions, nether: this.dormantNether };
    }
    return save;
  }

  /**
   * The travel handoff: moves a player between dimension shards. The slice
   * crosses whole (inventory, xp, effects — serializePlayer/addPlayer are the
   * same machinery leave/join use); position is replaced by the target-side
   * arrival portal, latched so they don't immediately bounce back. Mobs
   * (pets included) and vehicles stay behind — they are dimension state.
   */
  private travelPlayer(playerId: string, from: DimensionShard, target: DimensionId, anchor: { x: number; y: number; z: number }): void {
    const conn = this.clients.get(playerId);
    if (!conn || conn.dimension !== from.dimension) return; // left or already handed off
    const slice = from.engine.removePlayer(playerId);
    if (!slice) return;
    const shard = this.ensureShard(target);
    const player = shard.engine.addPlayer({ id: playerId, restore: slice });
    const pos = shard.engine.ensureArrival(anchor);
    player.position.set(pos.x + 0.5, pos.y, pos.z + 0.5);
    player.velocity.set(0, 0, 0);
    player.onGround = false;
    // Arriving INSIDE a portal: latch the dwell or the return trip fires in 3s.
    player.timers.portalLatched = true;
    player.timers.portalDwellSeconds = 0;
    conn.dimension = target;
    conn.shadow = null; // full SelfDelta next tick
    conn.lastPoseTick = this.tickCount;
    this.dirtySinceStore = true;
    this.sendTravelSync(conn, shard);
    this.broadcast({ t: "playerDim", id: playerId, dimension: target });
  }

  /** `dim` first (the client swaps its replica), then the target worldSync. Tick frames are withheld until the sync is on the wire. */
  private sendTravelSync(conn: ClientConn, shard: DimensionShard): void {
    conn.pendingDimensionSync = true;
    conn.sink.send(encodeServerMessage({ t: "dim", dimension: shard.dimension, tick: this.tickCount, dayClock: shard.engine.state.dayClock }));
    const sync = this.buildWorldSync(shard);
    void gzipWorldSync(sync)
      .then((bytes) => {
        this.bytesOut += bytes.length;
        conn.sink.send(bytes);
      })
      .finally(() => {
        conn.pendingDimensionSync = false;
      });
  }

  /**
   * Persist-and-drop an empty nether shard after the linger window: the ~40 MB
   * engine is the price of an OCCUPIED nether, not a visited-once one. The
   * section survives as `dormantNether` (and in the stored save); the next
   * travel reboots the shard from it.
   */
  private sweepNetherShard(): void {
    const shard = this.shards.get("nether");
    if (!shard) return;
    let occupied = false;
    for (const conn of this.clients.values()) if (conn.dimension === "nether") occupied = true;
    if (occupied) {
      this.netherEmptySinceMs = null;
      return;
    }
    if (this.netherEmptySinceMs === null) {
      this.netherEmptySinceMs = this.now();
      return;
    }
    if (this.now() - this.netherEmptySinceMs < this.netherLingerMs) return;
    this.dormantNether = shard.engine.serialize().dimensions?.nether ?? this.dormantNether;
    this.shards.delete("nether");
    this.netherEmptySinceMs = null;
    this.dirtySinceStore = true;
  }

  /** Starts the 20 Hz ticker (index.ts calls this once after construction). */
  start(setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>, clearTimer?: (id: ReturnType<typeof setTimeout>) => void): void {
    this.ticker = createFixedTicker({
      onTick: (dt) => this.tick(dt),
      now: () => this.now(),
      ...(setTimer ? { setTimer } : {}),
      ...(clearTimer ? { clearTimer } : {})
    });
  }

  playerCount(): number {
    return this.clients.size;
  }

  diagnostics(): { worldId: string; players: number; tick: number; slowestTickMs: number; kbOutPerSec: number } {
    // Bandwidth over the window since the last read (not a lifetime average).
    const windowTicks = Math.max(1, this.tickCount - this.lastDiagTick);
    const windowBytes = this.bytesOut - this.lastDiagBytes;
    this.lastDiagTick = this.tickCount;
    this.lastDiagBytes = this.bytesOut;
    return {
      worldId: this.worldId,
      players: this.clients.size,
      tick: this.tickCount,
      slowestTickMs: Math.round(this.slowestTickMs * 100) / 100,
      kbOutPerSec: Math.round((windowBytes / 1024 / (windowTicks * TICK_SECONDS)) * 10) / 10
    };
  }

  /** The replay log + world constants (admin-only; drives server/scripts/replay.ts). */
  logDump(): RoomLogDump {
    return {
      worldId: this.worldId,
      seed: this.engine.state.world.seed,
      worldType: this.engine.worldTypeName,
      difficulty: this.engine.state.difficulty,
      hardcore: this.engine.state.hardcore,
      tick: this.tickCount,
      entries: [...this.commandLog]
    };
  }

  private recordLog(entry: CommandLogEntry): void {
    this.commandLog.push(entry);
    if (this.commandLog.length > this.commandLogSize) this.commandLog.splice(0, this.commandLog.length - this.commandLogSize);
  }

  /** Admits a verified ticket onto a socket: joins the engine and syncs the world. */
  async join(claims: TicketClaims, sink: ClientSink): Promise<boolean> {
    // A reconnecting member already owns a slot — only a genuinely NEW player
    // counts against capacity, so a dropped socket can always come back.
    const reconnecting = this.clients.has(claims.sub);
    if (!reconnecting && this.clients.size >= ROOM_CAPACITY) {
      sink.close(CLOSE_ROOM_FULL, "room full");
      return false;
    }
    // A reconnect replaces the old socket (the stale one is closed silently).
    this.clients.get(claims.sub)?.sink.close(CLOSE_KICKED, "replaced by a new connection");
    this.clients.delete(claims.sub);

    const restore = this.offlinePlayers.get(claims.sub) ?? null;
    // Seat the player where their slice left them — a player who left (or was
    // kicked) in the nether rejoins there, booting the shard if needed.
    const shard = this.ensureShard(restore ? restorePlayerDimension(restore) : "overworld");
    const player = shard.engine.addPlayer({ id: claims.sub, restore });
    this.offlinePlayers.delete(claims.sub);
    this.dirtySinceStore = true;

    const conn: ClientConn = {
      playerId: claims.sub,
      name: claims.name,
      skinId: claims.skinId,
      role: claims.role,
      dimension: shard.dimension,
      pendingDimensionSync: false,
      sink,
      poseSeq: -1,
      lastPoseTick: this.tickCount,
      budget: { cmd: 0, chat: 0, attack: 0 },
      slowStrikes: 0,
      shadow: null
    };
    this.clients.set(claims.sub, conn);
    this.emptySinceMs = null;

    sink.send(
      encodeServerMessage({
        t: "welcome",
        protocol: PROTOCOL_VERSION,
        playerId: claims.sub,
        worldId: this.worldId,
        seed: shard.engine.state.world.seed,
        worldType: shard.engine.worldTypeName,
        difficulty: shard.engine.state.difficulty,
        hardcore: shard.engine.state.hardcore,
        dayClock: shard.engine.state.dayClock,
        tick: this.tickCount,
        role: claims.role,
        dimension: conn.dimension,
        players: this.roster()
      })
    );
    sink.send(await gzipWorldSync(this.buildWorldSync(shard)));
    this.broadcast({ t: "playerJoined", player: this.rosterEntry(player, conn) }, claims.sub);
    return true;
  }

  /** Owner-initiated eject: close the socket with a fatal code so the client won't retry, then leave. Returns false if not present. */
  kick(playerId: string): boolean {
    const conn = this.clients.get(playerId);
    if (!conn) return false;
    conn.sink.close(CLOSE_KICKED, "removed by the world owner");
    this.leave(playerId);
    return true;
  }

  /** Removes a player (socket closed or kicked); persists their slice into the offline set. */
  leave(playerId: string): void {
    const conn = this.clients.get(playerId);
    if (!conn) return;
    this.clients.delete(playerId);
    // Remove from THEIR shard — the slice self-stamps its dimension, so a
    // player who leaves in the nether rejoins there.
    const saved = this.shardOf(conn).engine.removePlayer(playerId);
    if (saved) this.offlinePlayers.set(playerId, saved);
    this.dirtySinceStore = true;
    this.broadcast({ t: "playerLeft", id: playerId });
    if (this.clients.size === 0) this.emptySinceMs = this.now();
  }

  /** One validated client frame. */
  async handleMessage(playerId: string, message: ClientMessage): Promise<void> {
    const conn = this.clients.get(playerId);
    if (!conn) return;
    switch (message.t) {
      case "pose": {
        // The travel race guard: a frame in flight when this player's
        // dimension swapped describes the world they LEFT — drop it silently
        // (a forcePose here would fight the client's own swap-in-progress).
        if (message.d !== conn.dimension) return;
        if (message.seq <= conn.poseSeq) return; // stale or replayed
        conn.poseSeq = message.seq;
        const shard = this.shardOf(conn);
        const elapsed = Math.max(1, this.tickCount - conn.lastPoseTick) * TICK_SECONDS;
        const { accepted } = shard.engine.applyRemotePose(playerId, message, elapsed);
        shard.engine.setPlayerInput(playerId, { move: message.move, mineHeld: message.mineHeld });
        if (accepted) {
          conn.lastPoseTick = this.tickCount;
        } else {
          const player = shard.engine.state.players.get(playerId);
          // A mounted player's position is server-owned and streamed via the
          // self-delta; don't fight that with forcePose (the reject there is
          // "ignore the stream", not "you desynced"). Only correct real desync.
          if (player && player.mountedVehicleId === null) {
            conn.sink.send(
              encodeServerMessage({
                t: "forcePose",
                x: player.position.x,
                y: player.position.y,
                z: player.position.z,
                yaw: player.yaw,
                pitch: player.pitch
              })
            );
          }
        }
        return;
      }
      case "cmd": {
        // Same travel race guard as the pose stream: a command aimed in the
        // world the sender just left must not raycast into this one.
        if (message.d !== conn.dimension) return;
        if (conn.budget.cmd >= 60) return; // per-second flood guard
        conn.budget.cmd += 1;
        if (message.cmd.type === "attack") {
          if (conn.budget.attack >= MELEE_ATTACKS_PER_SECOND) return;
          conn.budget.attack += 1;
        }
        // Room-wide settings are the owner's call, not any member's.
        if ((message.cmd.type === "setDifficulty" || message.cmd.type === "setGameMode") && conn.role !== "owner") return;
        const shard = this.shardOf(conn);
        // Apply the claimed pose (same clamps as the stream) so the command's
        // raycast happens from where the client actually stood/aimed.
        const elapsed = Math.max(1, this.tickCount - conn.lastPoseTick) * TICK_SECONDS;
        const { accepted } = shard.engine.applyRemotePose(
          playerId,
          { ...message.pose, onGround: shard.engine.state.players.get(playerId)?.onGround ?? false },
          elapsed
        );
        // Advance the pose clock on an accepted cmd pose too — otherwise a
        // client sending only cmds lets `elapsed` grow and inflate the clamp.
        if (accepted) conn.lastPoseTick = this.tickCount;
        this.recordLog({
          tick: this.tickCount,
          playerId,
          dim: conn.dimension,
          cmd: message.cmd,
          pose: message.pose,
          ...(message.view !== undefined ? { view: message.view } : {})
        });
        // The owner's difficulty is WORLD state: mirror it into every other
        // shard so e.g. Peaceful despawns hostiles in the nether too.
        if (message.cmd.type === "setDifficulty") {
          for (const other of this.shards.values()) {
            if (other !== shard) other.engine.setWorldDifficulty(message.cmd.difficulty);
          }
        }
        // Melee lag compensation: a stamped attack rewinds TARGET SELECTION to
        // the tick the attacker was rendering, clamped into the rewind window.
        // Everything degrades to live behavior: unstamped/future/too-stale
        // stamps, mobs without history (spawned since), non-attack commands.
        // The history ring is the SHARD's — ids/positions only mean anything
        // inside one dimension's space.
        let opts: DispatchOptions | undefined;
        if (message.cmd.type === "attack" && message.view !== undefined) {
          const viewTick = Math.round(message.view / (TICK_SECONDS * 1000));
          const rewindTick = Math.min(this.tickCount, Math.max(viewTick, this.tickCount - MELEE_REWIND_MAX_TICKS));
          if (rewindTick < this.tickCount) {
            opts = { mobPosOf: (mob) => shard.mobHistory.positionAt(rewindTick, mob.id) ?? mob.position };
          }
        }
        shard.engine.dispatch(message.cmd, playerId, opts);
        return;
      }
      case "chat": {
        if (conn.budget.chat >= 3) return;
        conn.budget.chat += 1;
        this.broadcast({ t: "chat", from: playerId, name: conn.name, text: message.text });
        return;
      }
      case "ping": {
        conn.sink.send(encodeServerMessage({ t: "pong", id: message.id, tMs: message.tMs, serverTick: this.tickCount }));
        return;
      }
      case "resync": {
        conn.sink.send(await gzipWorldSync(this.buildWorldSync(this.shardOf(conn))));
        conn.shadow = null; // resend the full self-delta next tick
        return;
      }
      case "kick": {
        // Owner-only, re-checked against the signed ticket role (same gate as the
        // owner-wide settings). Can't kick yourself; kick() no-ops on a stranger.
        if (conn.role !== "owner" || message.targetId === playerId) return;
        this.kick(message.targetId);
        return;
      }
      case "hello":
        return; // already admitted; ignore
    }
  }

  /** Drains the room for shutdown: persist + close every socket. */
  async shutdown(): Promise<void> {
    this.ticker?.stop();
    for (const conn of this.clients.values()) conn.sink.close(CLOSE_SERVER_SHUTDOWN, "server restarting");
    for (const playerId of [...this.clients.keys()]) this.leave(playerId);
    await this.persist();
  }

  /** Persists the full world (every shard's half, live players merged with offline slices). */
  async persist(): Promise<void> {
    const save = this.composeSave();
    for (const [id, saved] of this.offlinePlayers) {
      if (!save.players.some((p) => p.id === id)) save.players.push(saved);
    }
    const bun = Bun as unknown as { gzipSync(d: Uint8Array): Uint8Array };
    const blob = bun.gzipSync(new TextEncoder().encode(JSON.stringify(save)));
    await this.persistence.storeWorld(this.worldId, blob, save.version);
    this.dirtySinceStore = false;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private tick(dt: number): void {
    const started = this.now();
    this.tickCount += 1;
    if (this.tickCount % 20 === 0) {
      for (const conn of this.clients.values()) conn.budget = { cmd: 0, chat: 0, attack: 0 };
    }

    // Step every shard and gather its per-tick broadcast data. Coordinates,
    // ids, and events only mean anything inside one dimension's space, so
    // each client receives exactly their own shard's channels.
    const travels: Array<{ playerId: string; from: DimensionShard; target: DimensionId; anchor: { x: number; y: number; z: number } }> = [];
    const perShard = new Map<DimensionId, ShardTickData>();
    for (const shard of this.shards.values()) {
      // World time is owned by the overworld engine (which steps first —
      // insertion order); mirror it into the others before they step so a
      // sleep-skip's clock jump reaches the nether the same tick.
      if (shard.dimension !== "overworld") shard.engine.state.dayClock = this.overworld.engine.state.dayClock;
      shard.engine.step(dt);
      // Post-step positions: exactly what this tick's mp/keyframe broadcasts,
      // i.e. the timeline the client's interpolation buffers (and view stamps)
      // live on.
      shard.mobHistory.record(this.tickCount, shard.engine.state.mobs);
      // dimensionTravel is the room's cue to hand the player between shards —
      // it never broadcasts (the traveler gets `dim`, everyone else playerDim).
      const events = shard.engine.consumeEvents().filter((e) => {
        if (e.type !== "dimensionTravel") return true;
        if (e.playerId) travels.push({ playerId: e.playerId, from: shard, target: e.target, anchor: e.anchor });
        return false;
      });
      const blocks = shard.engine.state.blockChanges.drainEdits();
      if (events.some((e) => e.type === "blockPlaced" || e.type === "blockBroken" || e.type === "explosion")) this.dirtySinceStore = true;
      const projectilePoses = this.collectProjectilePoses(shard);
      // Send a trailing empty `prj` the tick the last arrow clears so clients prune it.
      const includeProjectiles = projectilePoses.length > 0 || shard.lastProjectileCount > 0;
      shard.lastProjectileCount = projectilePoses.length;
      perShard.set(shard.dimension, {
        events,
        blocks,
        mobPoses: this.collectMobPoses(shard, false),
        vehiclePoses: this.collectVehiclePoses(shard, false),
        projectilePoses,
        includeProjectiles
      });
    }
    // Hand travelers between shards AFTER every shard consumed its events —
    // the handoff's own emissions (playerLeft/playerJoined echoes, the
    // arrival portal's block writes) broadcast next tick, which is fine: the
    // traveler receives a full worldSync and everyone else a playerDim now.
    for (const travel of travels) this.travelPlayer(travel.playerId, travel.from, travel.target, travel.anchor);

    // The day clock is world time, owned by the overworld shard.
    const day = this.tickCount % DAY_INTERVAL_TICKS === 0 ? this.overworld.engine.state.dayClock : undefined;

    for (const conn of this.clients.values()) {
      // Mid-swap: the client hasn't received its new dimension's worldSync
      // yet — a tick frame now would corrupt the replica it still runs.
      if (conn.pendingDimensionSync) continue;
      const buffered = conn.sink.bufferedAmount();
      if (buffered > BACKPRESSURE_KICK_BYTES) {
        conn.slowStrikes += 1;
        if (conn.slowStrikes > BACKPRESSURE_KICK_STRIKES) {
          conn.sink.close(CLOSE_SLOW_CLIENT, "client cannot keep up");
          this.leave(conn.playerId);
        }
        continue;
      }
      conn.slowStrikes = 0;
      const shed = buffered > BACKPRESSURE_SOFT_BYTES;
      const data = perShard.get(conn.dimension);
      if (!data) continue; // shard born mid-tick (travel); its first step — and this client's first frame — is next tick
      const message: TickMessage = {
        t: "tick",
        n: this.tickCount,
        ...(data.blocks.length > 0 ? { blocks: data.blocks } : {}),
        ev: data.events,
        pp: shed ? [] : this.collectPlayerPoses(this.shardOf(conn), conn.playerId),
        mp: shed ? [] : data.mobPoses,
        ...(!shed && data.vehiclePoses.length > 0 ? { vp: data.vehiclePoses } : {}),
        ...(!shed && data.includeProjectiles ? { prj: data.projectilePoses } : {}),
        ...(day !== undefined ? { day } : {}),
        ...(this.buildSelfDelta(conn) ?? {})
      };
      const encoded = encodeServerMessage(message);
      this.bytesOut += encoded.length;
      conn.sink.send(encoded);
    }

    // Pose anchors between commands keep an offline replay's positions aligned.
    if (this.tickCount % POSE_CHECKPOINT_TICKS === 0) {
      for (const shard of this.shards.values()) {
        for (const player of shard.engine.state.players.values()) {
          this.recordLog({
            tick: this.tickCount,
            playerId: player.id,
            dim: shard.dimension,
            pose: { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw, pitch: player.pitch }
          });
        }
      }
    }

    if (this.tickCount % KEYFRAME_INTERVAL_TICKS === 0 && this.clients.size > 0) {
      // Keyframes prune by absence, so each one must reach ONLY its own
      // dimension's clients — a cross-dimension keyframe would mass-delete
      // every mob on the recipient's replica.
      for (const shard of this.shards.values()) {
        this.broadcastToDimension(shard.dimension, { t: "mobsKeyframe", n: this.tickCount, mobs: this.collectMobPoses(shard, true) });
      }
    }
    if (this.tickCount % PERSIST_INTERVAL_TICKS === 0 && this.dirtySinceStore) {
      void this.persist();
    }
    this.sweepNetherShard();
    this.slowestTickMs = Math.max(this.slowestTickMs * 0.99, this.now() - started);
  }

  /** The FULL roster (all dimensions — each entry carries its `dim` tag; clients filter their replicas by it). */
  private roster(): RosterEntry[] {
    const out: RosterEntry[] = [];
    for (const conn of this.clients.values()) {
      const player = this.shardOf(conn).engine.state.players.get(conn.playerId);
      if (player) out.push(this.rosterEntry(player, conn));
    }
    return out;
  }

  private rosterEntry(player: PlayerState, conn: ClientConn): RosterEntry {
    return {
      id: player.id,
      name: conn.name,
      skinId: conn.skinId,
      dim: conn.dimension,
      x: qPos(player.position.x),
      y: qPos(player.position.y),
      z: qPos(player.position.z),
      yaw: qAng(player.yaw)
    };
  }

  private buildWorldSync(shard: DimensionShard): WorldSync {
    const state = shard.engine.state;
    return {
      t: "worldSync",
      tick: this.tickCount,
      dimension: shard.dimension,
      dayClock: state.dayClock,
      changes: state.blockChanges.changes(),
      blockEntities: serializeContainers(state.containers),
      lootedChests: serializeLootedChests(state.lootedWorldgenChests),
      mobs: serializeMobs(state.mobs),
      liveMobs: this.collectMobPoses(shard, true),
      vehicles: this.collectVehiclePoses(shard, true),
      projectiles: this.collectProjectilePoses(shard),
      players: this.roster()
    };
  }

  private collectPlayerPoses(shard: DimensionShard, except: string): PlayerPose[] {
    const out: PlayerPose[] = [];
    for (const player of shard.engine.state.players.values()) {
      if (player.id === except) continue;
      out.push({
        id: player.id,
        x: qPos(player.position.x),
        y: qPos(player.position.y),
        z: qPos(player.position.z),
        yaw: qAng(player.yaw),
        pitch: qAng(player.pitch)
      });
    }
    return out;
  }

  private collectMobPoses(shard: DimensionShard, keyframe: boolean): MobPose[] {
    const out: MobPose[] = [];
    for (const mob of shard.engine.state.mobs) {
      const shadow = shard.mobShadow.get(mob.id);
      const moved =
        !shadow ||
        (mob.position.x - shadow.x) ** 2 + (mob.position.y - shadow.y) ** 2 + (mob.position.z - shadow.z) ** 2 > MOB_DEADBAND_SQ ||
        mob.hp !== shadow.hp;
      // Delta frames go at half rate (10 Hz) — keyframes always carry everything.
      if (!keyframe && (!moved || this.tickCount % 2 !== 0)) continue;
      shard.mobShadow.set(mob.id, { x: mob.position.x, y: mob.position.y, z: mob.position.z, hp: mob.hp });
      out.push({
        id: mob.id,
        kind: mob.kind,
        hostile: mob.hostile,
        x: qPos(mob.position.x),
        y: qPos(mob.position.y),
        z: qPos(mob.position.z),
        yaw: qAng(mob.yaw),
        hp: mob.hp,
        moveSpeed: mob.moveSpeed
      });
    }
    if (keyframe) {
      const alive = new Set(shard.engine.state.mobs.map((m) => m.id));
      for (const id of shard.mobShadow.keys()) if (!alive.has(id)) shard.mobShadow.delete(id);
    }
    return out;
  }

  /**
   * Vehicle poses. `force` (join sync) emits every boat; otherwise only those
   * whose position/yaw/rider changed since the last broadcast (deadband — a
   * parked raft costs nothing). Vehicles never despawn, so no absence-pruning.
   */
  private collectVehiclePoses(shard: DimensionShard, force: boolean): VehiclePose[] {
    const out: VehiclePose[] = [];
    for (const vehicle of shard.engine.state.vehicles) {
      const riderId = vehicle.rider;
      const shadow = shard.vehicleShadow.get(vehicle.id);
      const moved =
        !shadow ||
        (vehicle.position.x - shadow.x) ** 2 + (vehicle.position.y - shadow.y) ** 2 + (vehicle.position.z - shadow.z) ** 2 > MOB_DEADBAND_SQ ||
        vehicle.yaw !== shadow.yaw ||
        riderId !== shadow.riderId;
      if (!force && !moved) continue;
      shard.vehicleShadow.set(vehicle.id, { x: vehicle.position.x, y: vehicle.position.y, z: vehicle.position.z, yaw: vehicle.yaw, riderId });
      out.push({
        id: vehicle.id,
        kind: vehicle.kind,
        x: qPos(vehicle.position.x),
        y: qPos(vehicle.position.y),
        z: qPos(vehicle.position.z),
        yaw: qAng(vehicle.yaw),
        riderId
      });
    }
    return out;
  }

  /** Every live arrow, full state each tick (they're few and fast — no deadband; the client snaps and prunes by absence). */
  private collectProjectilePoses(shard: DimensionShard): ProjectilePose[] {
    return shard.engine.state.projectiles.map((p) => ({
      id: p.id,
      x: qPos(p.position.x),
      y: qPos(p.position.y),
      z: qPos(p.position.z),
      // Velocity only orients the client's arrow mesh — position-grade
      // precision (2 dp) is ample even for a slow arrow at arc's end.
      vx: qPos(p.velocity.x),
      vy: qPos(p.velocity.y),
      vz: qPos(p.velocity.z)
    }));
  }

  private buildSelfDelta(conn: ClientConn): { self: SelfDelta } | null {
    const player = this.shardOf(conn).engine.state.players.get(conn.playerId);
    if (!player) return null;
    const effectsKey = JSON.stringify(serializeEffects(player.effects));
    const respawnSeconds = Math.ceil(player.respawnTimer);
    const eventStats = serializeStats(player.stats).filter((s) => !CLIENT_LOCAL_STATS.has(s.id));
    const statsSig = JSON.stringify(eventStats);
    const previous = conn.shadow;
    const delta: SelfDelta = {};
    if (!previous || previous.inventory !== player.inventory) delta.inventorySlots = inventorySlotsSnapshot(player.inventory);
    if (!previous || previous.equippedArmor !== player.equippedArmor) delta.equippedArmor = serializeEquippedArmor(player.equippedArmor);
    if (!previous || previous.selectedSlot !== player.selectedSlot) delta.selectedSlot = player.selectedSlot;
    if (!previous || previous.hearts !== player.hearts) delta.hearts = player.hearts;
    if (!previous || previous.hunger !== player.hunger) delta.hunger = player.hunger;
    if (!previous || Math.abs(previous.oxygen - player.oxygen) > 0.24) delta.oxygen = player.oxygen;
    if (!previous || previous.xp !== player.xp) delta.xp = player.xp;
    if (!previous || previous.isDead !== player.isDead) delta.isDead = player.isDead;
    if (!previous || previous.respawnSeconds !== respawnSeconds) delta.respawnSeconds = respawnSeconds;
    if (!previous || previous.gameMode !== player.gameMode) delta.gameMode = player.gameMode;
    if (!previous || previous.sleeping !== player.sleeping) delta.sleeping = player.sleeping;
    if (!previous || previous.effectsKey !== effectsKey) delta.effects = serializeEffects(player.effects);
    // Advancements grow-only (send the full set on change); event-driven stats sync on change.
    if (!previous || previous.advancementsSize !== player.advancements.size) delta.advancements = [...player.advancements];
    if (!previous || previous.statsSig !== statsSig) delta.stats = eventStats;
    // Mounted: the server owns the rider's position. Announce the mount/dismount
    // transition (mountedVehicleId), and carry the authoritative position while
    // mounted (and on the dismount tick) so the client snaps rather than predicts.
    const mounted = player.mountedVehicleId !== null;
    const mountChanged = !previous || previous.mountedVehicleId !== player.mountedVehicleId;
    if (mountChanged) delta.mountedVehicleId = player.mountedVehicleId;
    if (mounted || mountChanged) {
      delta.x = qPos(player.position.x);
      delta.y = qPos(player.position.y);
      delta.z = qPos(player.position.z);
    }
    conn.shadow = {
      inventory: player.inventory,
      equippedArmor: player.equippedArmor,
      selectedSlot: player.selectedSlot,
      hearts: player.hearts,
      hunger: player.hunger,
      oxygen: player.oxygen,
      xp: player.xp,
      isDead: player.isDead,
      respawnSeconds,
      gameMode: player.gameMode,
      sleeping: player.sleeping,
      effectsKey,
      mountedVehicleId: player.mountedVehicleId,
      advancementsSize: player.advancements.size,
      statsSig
    };
    return Object.keys(delta).length > 0 ? { self: delta } : null;
  }

  private broadcast(message: ServerMessage, except?: string): void {
    const encoded = encodeServerMessage(message);
    for (const conn of this.clients.values()) {
      if (conn.playerId === except) continue;
      this.bytesOut += encoded.length;
      conn.sink.send(encoded);
    }
  }

  /** Broadcast scoped to one dimension's clients (keyframes and other per-space frames). */
  private broadcastToDimension(dimension: DimensionId, message: ServerMessage, except?: string): void {
    const encoded = encodeServerMessage(message);
    for (const conn of this.clients.values()) {
      if (conn.dimension !== dimension || conn.playerId === except) continue;
      this.bytesOut += encoded.length;
      conn.sink.send(encoded);
    }
  }
}
