import { GameEngine, type DispatchOptions } from "@/lib/game/engine/GameEngine";
import type { Command } from "@/lib/game/engine/commands";
import { createMobPoseHistory, MELEE_REWIND_MAX_TICKS } from "./mobHistory";
import { createFixedTicker, TICK_SECONDS, type FixedTicker } from "@/lib/game/engine/tickDriver";
import {
  serializeEffects,
  serializeEquippedArmor,
  inventorySlotsSnapshot,
  serializeMobs,
  serializeContainers,
  serializeLootedChests,
  serializeStats
} from "@/lib/game/save";
import type { SavedPlayer } from "@/lib/game/types";
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
 * One world room: an authoritative GameEngine on the fixed 20 Hz ticker,
 * fed by client poses/commands and broadcasting per-tick deltas. Sockets are
 * abstracted as ClientSink so the whole class unit-tests with fakes; only
 * index.ts binds it to real Bun WebSockets.
 */

export type ClientSink = {
  send(data: string | Uint8Array): void;
  close(code: number, reason?: string): void;
  bufferedAmount(): number;
};

type ClientConn = {
  playerId: string;
  name: string;
  skinId: string | null;
  role: "owner" | "member";
  sink: ClientSink;
  /** Highest pose seq applied (stale/replayed packets drop). */
  poseSeq: number;
  /** Tick of the last accepted pose (drives the clamp's elapsed time). */
  lastPoseTick: number;
  /** Per-second message budgets (reset each second-boundary tick). */
  budget: { cmd: number; chat: number };
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
 * One entry in a room's replay log: a dispatched command (with its claimed eye
 * pose, plus the v3 view stamp when present) or a periodic pose anchor. Replay
 * ignores `view` — attack-replay fidelity was already approximate (1 s pose
 * anchors); it's recorded for offline diagnosis of rewind disputes.
 */
export type CommandLogEntry =
  | { tick: number; playerId: string; cmd: Command; pose: { x: number; y: number; z: number; yaw: number; pitch: number }; view?: number }
  | { tick: number; playerId: string; pose: { x: number; y: number; z: number; yaw: number; pitch: number } };

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
  readonly engine: GameEngine;
  private readonly clients = new Map<string, ClientConn>();
  /** Persisted slices of players who left (merged into the stored save). */
  private readonly offlinePlayers = new Map<string, SavedPlayer>();
  private readonly persistence: Persistence;
  private ticker: FixedTicker | null = null;
  private tickCount = 0;
  private dirtySinceStore = false;
  private readonly mobShadow = new Map<number, { x: number; y: number; z: number; hp: number }>();
  /** Per-tick mob positions for melee lag compensation (see handleMessage "cmd"). */
  private readonly mobHistory = createMobPoseHistory();
  private readonly vehicleShadow = new Map<number, { x: number; y: number; z: number; yaw: number; riderId: string | null }>();
  /** Count of live arrows broadcast last tick — drives one trailing empty `prj` frame so the client prunes the last one. */
  private lastProjectileCount = 0;
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
    this.engine = new GameEngine({
      save: record.save,
      seed: record.seed,
      worldType: record.worldType as never,
      difficulty: record.difficulty as never,
      hardcore: record.hardcore,
      authority: "server",
      headless: true,
      bootPlayer: false
    });
    for (const saved of record.save?.players ?? []) this.offlinePlayers.set(saved.id, saved);
    this.emptySinceMs = this.now();
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
    const player = this.engine.addPlayer({ id: claims.sub, restore });
    this.offlinePlayers.delete(claims.sub);
    this.dirtySinceStore = true;

    const conn: ClientConn = {
      playerId: claims.sub,
      name: claims.name,
      skinId: claims.skinId,
      role: claims.role,
      sink,
      poseSeq: -1,
      lastPoseTick: this.tickCount,
      budget: { cmd: 0, chat: 0 },
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
        seed: this.engine.state.world.seed,
        worldType: this.engine.worldTypeName,
        difficulty: this.engine.state.difficulty,
        hardcore: this.engine.state.hardcore,
        dayClock: this.engine.state.dayClock,
        tick: this.tickCount,
        role: claims.role,
        players: this.roster()
      })
    );
    sink.send(await gzipWorldSync(this.buildWorldSync()));
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
    const saved = this.engine.removePlayer(playerId);
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
        if (message.seq <= conn.poseSeq) return; // stale or replayed
        conn.poseSeq = message.seq;
        const elapsed = Math.max(1, this.tickCount - conn.lastPoseTick) * TICK_SECONDS;
        const { accepted } = this.engine.applyRemotePose(playerId, message, elapsed);
        this.engine.setPlayerInput(playerId, { move: message.move, mineHeld: message.mineHeld });
        if (accepted) {
          conn.lastPoseTick = this.tickCount;
        } else {
          const player = this.engine.state.players.get(playerId);
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
        if (conn.budget.cmd >= 60) return; // per-second flood guard
        conn.budget.cmd += 1;
        // Room-wide settings are the owner's call, not any member's.
        if ((message.cmd.type === "setDifficulty" || message.cmd.type === "setGameMode") && conn.role !== "owner") return;
        // Apply the claimed pose (same clamps as the stream) so the command's
        // raycast happens from where the client actually stood/aimed.
        const elapsed = Math.max(1, this.tickCount - conn.lastPoseTick) * TICK_SECONDS;
        const { accepted } = this.engine.applyRemotePose(
          playerId,
          { ...message.pose, onGround: this.engine.state.players.get(playerId)?.onGround ?? false },
          elapsed
        );
        // Advance the pose clock on an accepted cmd pose too — otherwise a
        // client sending only cmds lets `elapsed` grow and inflate the clamp.
        if (accepted) conn.lastPoseTick = this.tickCount;
        this.recordLog({ tick: this.tickCount, playerId, cmd: message.cmd, pose: message.pose, ...(message.view !== undefined ? { view: message.view } : {}) });
        // Melee lag compensation: a stamped attack rewinds TARGET SELECTION to
        // the tick the attacker was rendering, clamped into the rewind window.
        // Everything degrades to live behavior: unstamped/future/too-stale
        // stamps, mobs without history (spawned since), non-attack commands.
        let opts: DispatchOptions | undefined;
        if (message.cmd.type === "attack" && message.view !== undefined) {
          const viewTick = Math.round(message.view / (TICK_SECONDS * 1000));
          const rewindTick = Math.min(this.tickCount, Math.max(viewTick, this.tickCount - MELEE_REWIND_MAX_TICKS));
          if (rewindTick < this.tickCount) {
            opts = { mobPosOf: (mob) => this.mobHistory.positionAt(rewindTick, mob.id) ?? mob.position };
          }
        }
        this.engine.dispatch(message.cmd, playerId, opts);
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
        conn.sink.send(await gzipWorldSync(this.buildWorldSync()));
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

  /** Persists the full world (live players merged with offline slices). */
  async persist(): Promise<void> {
    const save = this.engine.serialize();
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
      for (const conn of this.clients.values()) conn.budget = { cmd: 0, chat: 0 };
    }

    this.engine.step(dt);
    // Post-step positions: exactly what this tick's mp/keyframe broadcasts,
    // i.e. the timeline the client's interpolation buffers (and view stamps)
    // live on.
    this.mobHistory.record(this.tickCount, this.engine.state.mobs);
    const events = this.engine.consumeEvents();
    const blocks = this.engine.state.blockChanges.drainEdits();
    if (events.some((e) => e.type === "blockPlaced" || e.type === "blockBroken" || e.type === "explosion")) this.dirtySinceStore = true;

    const mobPoses = this.collectMobPoses(false);
    const vehiclePoses = this.collectVehiclePoses(false);
    const projectilePoses = this.collectProjectilePoses();
    // Send a trailing empty `prj` the tick the last arrow clears so clients prune it.
    const includeProjectiles = projectilePoses.length > 0 || this.lastProjectileCount > 0;
    this.lastProjectileCount = projectilePoses.length;
    const day = this.tickCount % DAY_INTERVAL_TICKS === 0 ? this.engine.state.dayClock : undefined;

    for (const conn of this.clients.values()) {
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
      const message: TickMessage = {
        t: "tick",
        n: this.tickCount,
        ...(blocks.length > 0 ? { blocks } : {}),
        ev: events,
        pp: shed ? [] : this.collectPlayerPoses(conn.playerId),
        mp: shed ? [] : mobPoses,
        ...(!shed && vehiclePoses.length > 0 ? { vp: vehiclePoses } : {}),
        ...(!shed && includeProjectiles ? { prj: projectilePoses } : {}),
        ...(day !== undefined ? { day } : {}),
        ...(this.buildSelfDelta(conn) ?? {})
      };
      const encoded = encodeServerMessage(message);
      this.bytesOut += encoded.length;
      conn.sink.send(encoded);
    }

    // Pose anchors between commands keep an offline replay's positions aligned.
    if (this.tickCount % POSE_CHECKPOINT_TICKS === 0) {
      for (const player of this.engine.state.players.values()) {
        this.recordLog({
          tick: this.tickCount,
          playerId: player.id,
          pose: { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw, pitch: player.pitch }
        });
      }
    }

    if (this.tickCount % KEYFRAME_INTERVAL_TICKS === 0 && this.clients.size > 0) {
      this.broadcast({ t: "mobsKeyframe", n: this.tickCount, mobs: this.collectMobPoses(true) });
    }
    if (this.tickCount % PERSIST_INTERVAL_TICKS === 0 && this.dirtySinceStore) {
      void this.persist();
    }
    this.slowestTickMs = Math.max(this.slowestTickMs * 0.99, this.now() - started);
  }

  private roster(): RosterEntry[] {
    const out: RosterEntry[] = [];
    for (const conn of this.clients.values()) {
      const player = this.engine.state.players.get(conn.playerId);
      if (player) out.push(this.rosterEntry(player, conn));
    }
    return out;
  }

  private rosterEntry(player: PlayerState, conn: ClientConn): RosterEntry {
    return {
      id: player.id,
      name: conn.name,
      skinId: conn.skinId,
      x: qPos(player.position.x),
      y: qPos(player.position.y),
      z: qPos(player.position.z),
      yaw: qAng(player.yaw)
    };
  }

  private buildWorldSync(): WorldSync {
    const state = this.engine.state;
    return {
      t: "worldSync",
      tick: this.tickCount,
      dayClock: state.dayClock,
      changes: state.blockChanges.changes(),
      blockEntities: serializeContainers(state.containers),
      lootedChests: serializeLootedChests(state.lootedWorldgenChests),
      mobs: serializeMobs(state.mobs),
      liveMobs: this.collectMobPoses(true),
      vehicles: this.collectVehiclePoses(true),
      projectiles: this.collectProjectilePoses(),
      players: this.roster()
    };
  }

  private collectPlayerPoses(except: string): PlayerPose[] {
    const out: PlayerPose[] = [];
    for (const player of this.engine.state.players.values()) {
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

  private collectMobPoses(keyframe: boolean): MobPose[] {
    const out: MobPose[] = [];
    for (const mob of this.engine.state.mobs) {
      const shadow = this.mobShadow.get(mob.id);
      const moved =
        !shadow ||
        (mob.position.x - shadow.x) ** 2 + (mob.position.y - shadow.y) ** 2 + (mob.position.z - shadow.z) ** 2 > MOB_DEADBAND_SQ ||
        mob.hp !== shadow.hp;
      // Delta frames go at half rate (10 Hz) — keyframes always carry everything.
      if (!keyframe && (!moved || this.tickCount % 2 !== 0)) continue;
      this.mobShadow.set(mob.id, { x: mob.position.x, y: mob.position.y, z: mob.position.z, hp: mob.hp });
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
      const alive = new Set(this.engine.state.mobs.map((m) => m.id));
      for (const id of this.mobShadow.keys()) if (!alive.has(id)) this.mobShadow.delete(id);
    }
    return out;
  }

  /**
   * Vehicle poses. `force` (join sync) emits every boat; otherwise only those
   * whose position/yaw/rider changed since the last broadcast (deadband — a
   * parked raft costs nothing). Vehicles never despawn, so no absence-pruning.
   */
  private collectVehiclePoses(force: boolean): VehiclePose[] {
    const out: VehiclePose[] = [];
    for (const vehicle of this.engine.state.vehicles) {
      const riderId = vehicle.rider;
      const shadow = this.vehicleShadow.get(vehicle.id);
      const moved =
        !shadow ||
        (vehicle.position.x - shadow.x) ** 2 + (vehicle.position.y - shadow.y) ** 2 + (vehicle.position.z - shadow.z) ** 2 > MOB_DEADBAND_SQ ||
        vehicle.yaw !== shadow.yaw ||
        riderId !== shadow.riderId;
      if (!force && !moved) continue;
      this.vehicleShadow.set(vehicle.id, { x: vehicle.position.x, y: vehicle.position.y, z: vehicle.position.z, yaw: vehicle.yaw, riderId });
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
  private collectProjectilePoses(): ProjectilePose[] {
    return this.engine.state.projectiles.map((p) => ({
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
    const player = this.engine.state.players.get(conn.playerId);
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
}
