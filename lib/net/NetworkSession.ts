import * as THREE from "three";
import { GameEngine } from "@/lib/game/engine/GameEngine";
import type { Command } from "@/lib/game/engine/commands";
import {
  createIdleInput,
  type AttributedGameEvent,
  type GameEvent,
  type GameState,
  type MobState,
  type PlayerId,
  type PlayerState
} from "@/lib/game/engine/state";
import { TICK_SECONDS } from "@/lib/game/engine/tickDriver";
import { adjustSlotCount } from "@/lib/game/inventory";
import { BlockId } from "@/lib/world";
import { restoreEffects, restoreEquippedArmor, restoreInventorySlots, restoreSelectedSlot } from "@/lib/game/save";
import { MOB_TEMPLATES, mobHalfHeight } from "@/lib/game/mobs";
import { FACTION_BY_KIND } from "@/lib/game/mobs";
import type { DimensionId, MobKind, VehicleKind } from "@/lib/game/types";
import { createClockSync } from "./clock";
import { createPredictionLedger, type PredictionRefund } from "./prediction";
import { decodeServerFrame, encodeClientMessage, gunzipWorldSync, qAng, qPos } from "./codec";
import { createDelayController, createPoseBuffer, type PoseBuffer } from "./interpolation";
import {
  CLOSE_BAD_TICKET,
  CLOSE_KICKED,
  CLOSE_PROTOCOL_MISMATCH,
  CLOSE_ROOM_FULL,
  CLOSE_SLOW_CLIENT,
  PROTOCOL_VERSION,
  RECONNECT_DELAYS_MS,
  type MobPose,
  type ProjectilePose,
  type SelfDelta,
  type VehiclePose,
  type WelcomeMessage,
  type WorldSync
} from "./protocol";

/**
 * The client end of a multiplayer world: owns the WebSocket and a REPLICA
 * engine the existing renderer/audio/HUD consume unchanged. Outbound, it
 * streams the local player's pose at tick rate and routes commands — local
 * presentation stays on the replica, gameplay goes to the server (selectSlot
 * optimistically does both). Inbound, it applies the server's block journal,
 * replays events into the shell's existing event drain, feeds pose buffers
 * for ~125 ms-delayed interpolation, and overwrites the local player's
 * private state from self-deltas (the server owns your vitals).
 *
 * The engine outlives the socket: a dropped connection (anything but a fatal
 * close — a bad ticket, a kick, a slow-client shed) runs a reconnect ladder
 * that mints a fresh ticket and redoes the handshake, re-syncing the same
 * replica in place — the player sees a brief "reconnecting" badge, not a
 * dead world.
 */

export type NetStatus = "connecting" | "syncing" | "online" | "reconnecting" | "closed";

/** A fresh place to connect: the reconnect ladder calls this to re-mint a ticket. */
export type JoinGrant = { url: string; ticket: string };

export type NetworkSessionCallbacks = {
  onStatus?(status: NetStatus, detail?: string): void;
  onChat?(entry: { from: string; name: string; text: string }): void;
  /** Server events the shell's drain should also see (toasts, audio, particles). */
  onEvent?(event: GameEvent): void;
  /**
   * The LOCAL player's dimension changed (server-initiated travel): the
   * replica engine was just rebuilt for it, so the shell must rebuild the
   * renderer (dimension profiles are construction-time) — the ws stays open.
   */
  onDimension?(dimension: DimensionId): void;
};

export type NetworkSessionOptions = {
  /** Socket factory (tests inject a fake). */
  makeSocket?: (url: string) => WebSocket;
  /** Re-mint a ticket for the reconnect ladder; omit to disable reconnection. */
  reconnect?: () => Promise<JoinGrant | null>;
  /** Artificial round-trip delay (ms) for local latency testing; overridable at runtime. */
  simulatedLatencyMs?: number;
  /** Replica world footprint — tests shrink it; production must match the server's (default). */
  worldSize?: { x: number; y: number; z: number };
};

/** Closes we don't retry: the door said no, or we'd just be kicked again. */
const FATAL_CLOSES = new Set<number>([CLOSE_BAD_TICKET, CLOSE_PROTOCOL_MISMATCH, CLOSE_ROOM_FULL, CLOSE_KICKED, CLOSE_SLOW_CLIENT]);

/** Commands that never leave the client: pure presentation on the replica. */
const LOCAL_COMMANDS = new Set<Command["type"]>(["toggleInventory", "toggleAdvancements", "toggleDebug", "toggleCameraView", "pause", "resume"]);

const HANDSHAKE_TIMEOUT_MS = 15000;

/** Ping cadence — 1 Hz keeps the clock's min-RTT window (~16 samples) fresh at ~40 B/s. */
const PING_INTERVAL_MS = 1000;

/** One player as the roster panel shows them (dimension drives the "· Nether" tag). */
export type RosterMember = { id: PlayerId; name: string; dimension: DimensionId };

/** Live connection stats for the F3 overlay (poll, don't subscribe). */
export type NetStats = {
  rttMs: number;
  /** Tick inter-arrival jitter (p90 deviation from the 50 ms nominal). */
  jitterMs: number;
  /** How far in the past remote entities currently render. */
  interpDelayMs: number;
  inKBps: number;
  outKBps: number;
  /** Optimistic block edits awaiting server confirmation. */
  pendingPredictions: number;
};

export type NetworkSession = {
  /** The live replica engine. REBOUND on dimension travel — re-read it after onDimension, never cache it across a swap. */
  readonly engine: GameEngine;
  readonly playerId: PlayerId;
  /** The local player's role in this world (from the join ticket) — gates the owner controls. */
  readonly role: "owner" | "member";
  /** UI subscriptions (React components mount after connect; unsubscribe on cleanup). */
  subscribeChat(listener: (entry: { from: string; name: string; text: string }) => void): () => void;
  subscribeStatus(listener: (status: NetStatus) => void): () => void;
  /** Fires whenever a player joins or leaves — the roster panel re-reads roster(). */
  subscribeRoster(listener: () => void): () => void;
  status(): NetStatus;
  rttMs(): number;
  /** Everyone currently in the world (including you). */
  roster(): RosterMember[];
  /** Names for remote player ids (name tags, chat). */
  playerName(id: PlayerId): string;
  dispatch(command: Command): void;
  applyLook(deltaYaw: number, deltaPitch: number): void;
  sendChat(text: string): void;
  /** Owner-only: eject a player (no-op server-side for a non-owner). */
  kick(targetId: PlayerId): void;
  /**
   * Debug knob: inject symmetric latency on every send/receive (0 disables).
   * `jitterMs` randomizes each message's delay by ±jitter (FIFO preserved —
   * TCP never reorders); omitting it resets jitter to 0.
   */
  setSimulatedLatency(ms: number, jitterMs?: number): void;
  simulatedLatency(): number;
  simulatedJitter(): number;
  /** Connection stats snapshot for the debug overlay. */
  netStats(): NetStats;
  /** Server events since the last drain — feed the shell's existing event handler. */
  drainEvents(): GameEvent[];
  /** Call once per rAF after engine.step: flushes the pose stream and samples interpolation. */
  afterFrame(nowMs: number): void;
  dispose(): void;
};

export async function connectNetworkSession(
  url: string,
  ticket: string,
  callbacks: NetworkSessionCallbacks = {},
  options: NetworkSessionOptions = {}
): Promise<NetworkSession> {
  const makeSocket = options.makeSocket ?? ((u: string) => new WebSocket(u));
  const envLatency = Number.parseInt(process.env.NEXT_PUBLIC_NET_SIM_LATENCY_MS ?? "", 10);
  const envJitter = Number.parseInt(process.env.NEXT_PUBLIC_NET_SIM_JITTER_MS ?? "", 10);
  let simulatedLatencyMs = options.simulatedLatencyMs ?? (Number.isFinite(envLatency) ? envLatency : 0);
  let simulatedJitterMs = Number.isFinite(envJitter) ? Math.max(0, envJitter) : 0;

  let status: NetStatus = "connecting";
  let disposed = false;
  let ws: WebSocket | null = null;
  const chatListeners = new Set<(entry: { from: string; name: string; text: string }) => void>();
  const statusListeners = new Set<(status: NetStatus) => void>();
  const rosterListeners = new Set<() => void>();
  const setStatus = (next: NetStatus, detail?: string) => {
    status = next;
    callbacks.onStatus?.(next, detail);
    for (const listener of statusListeners) listener(next);
  };
  const notifyRoster = () => {
    for (const listener of rosterListeners) listener();
  };

  const clock = createClockSync();
  const delayCtl = createDelayController();
  const ledger = createPredictionLedger();
  const pendingEvents: GameEvent[] = [];
  const playerBuffers = new Map<string, PoseBuffer>();
  const mobBuffers = new Map<number, PoseBuffer>();
  const names = new Map<string, string>();
  let serverTickTimeMs = 0;

  // Client-side traffic counters for the F3 overlay (2 s rolling window).
  // Inbound counts post-decompression frame sizes — an approximation when
  // permessage-deflate is negotiated, but the right number for "what does the
  // client have to process".
  const traffic = { inBytes: 0, outBytes: 0, windowStartMs: 0, inKBps: 0, outKBps: 0 };
  const rollTrafficWindow = (nowMs: number) => {
    if (traffic.windowStartMs === 0) traffic.windowStartMs = nowMs;
    const elapsed = nowMs - traffic.windowStartMs;
    if (elapsed < 2000) return;
    traffic.inKBps = traffic.inBytes / 1024 / (elapsed / 1000);
    traffic.outKBps = traffic.outBytes / 1024 / (elapsed / 1000);
    traffic.inBytes = 0;
    traffic.outBytes = 0;
    traffic.windowStartMs = nowMs;
  };

  // Latency simulation wraps both directions symmetrically so `ms` reads as a
  // one-way delay (round-trip ≈ 2×ms), matching how a player would set it.
  // Jitter randomizes each message's delay (Math.random is fine here: net
  // tooling, never seed-determined bytes) but delivery stays FIFO — TCP never
  // reorders, and the seq/journal handling downstream assumes order. Each
  // direction drains through a queued delay line: a monotonic delivery cursor
  // makes deadlines non-decreasing, and ONE timer chain delivers in queue
  // order. A setTimeout per message would leave ordering to the timer heap's
  // tie-breaking, which is not stable for equal deadlines — and the cursor
  // clamps bursts to exactly-equal deadlines, so ties are the common case.
  const simDelayMs = () => Math.max(0, simulatedLatencyMs + (simulatedJitterMs > 0 ? (Math.random() * 2 - 1) * simulatedJitterMs : 0));
  const delayLine = () => {
    const queue: Array<{ deliverAt: number; fire: () => void }> = [];
    let cursor = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const drain = () => {
      timer = null;
      const now = performance.now();
      while (queue.length > 0 && queue[0].deliverAt <= now) queue.shift()!.fire();
      if (queue.length > 0) timer = setTimeout(drain, Math.max(0, queue[0].deliverAt - now));
    };
    return {
      push(fire: () => void) {
        const now = performance.now();
        const deliverAt = Math.max(now + simDelayMs(), cursor);
        cursor = deliverAt;
        queue.push({ deliverAt, fire });
        if (timer === null) timer = setTimeout(drain, deliverAt - now);
      },
      clear() {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        queue.length = 0;
      }
    };
  };
  const sendLine = delayLine();
  const recvLine = delayLine();

  const delayedSend = (data: string) => {
    const socket = ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    traffic.outBytes += data.length;
    if (simulatedLatencyMs > 0 || simulatedJitterMs > 0) {
      sendLine.push(() => {
        try {
          if (socket.readyState === WebSocket.OPEN) socket.send(data);
        } catch {
          /* socket closed under us */
        }
      });
      return;
    }
    socket.send(data);
  };

  // ── handshake: open a socket, send hello, await welcome ─────────────────────
  const handshake = (currentTicket: string, serverUrl: string): Promise<WelcomeMessage> =>
    new Promise<WelcomeMessage>((resolve, reject) => {
      const socket = makeSocket(`${serverUrl.replace(/\/$/, "")}/ws`);
      socket.binaryType = "arraybuffer";
      ws = socket;
      const timer = setTimeout(() => {
        reject(new Error("join timed out"));
        try {
          socket.close();
        } catch {
          /* already closing */
        }
      }, HANDSHAKE_TIMEOUT_MS);
      socket.onopen = () => socket.send(encodeClientMessage({ t: "hello", ticket: currentTicket, protocol: PROTOCOL_VERSION }));
      socket.onerror = () => reject(new Error("connection failed"));
      socket.onclose = (event) => reject(new Error(`refused: ${event.code} ${event.reason}`));
      socket.onmessage = (event) => {
        const message = decodeServerFrame(event.data);
        if (message?.t === "welcome") {
          clearTimeout(timer);
          // Hand the socket over to the steady-state handlers.
          socket.onmessage = (frame) => onServerFrame(frame.data);
          socket.onclose = (frame) => onSocketClosed(frame.code, frame.reason);
          socket.onerror = () => onSocketClosed(1006, "socket error");
          resolve(message);
        }
      };
    });

  const welcome = await handshake(ticket, url);
  setStatus("syncing");

  const playerId = welcome.playerId;

  // Every dispatch from the UI/input controller routes here (see
  // GameEngine.routeDispatch): presentation stays local, gameplay goes up.
  // Reinstalled on every replica rebuild (dimension travel).
  const routeDispatch = (command: Command) => {
    if (LOCAL_COMMANDS.has(command.type)) {
      engine.dispatch(command, playerId);
      return;
    }
    if (command.type === "selectSlot") engine.dispatch(command, playerId); // optimistic
    // Optimistic placement: apply locally when the replica is sure the click
    // is a pure block place, and remember it for journal reconciliation. The
    // cmd travels REGARDLESS — the server stays authoritative either way —
    // but never predict what can't currently be sent (a phantom un-sent edit
    // would only ever revert).
    if (command.type === "placeBlock" && status === "online" && ws?.readyState === WebSocket.OPEN) {
      const predicted = engine.predictPlaceBlock();
      if (predicted) ledger.add("place", predicted.edits, predicted.refund, performance.now(), clock.rttMs());
    }
    // Swing feedback is pure cosmetics — present it at click time and swallow
    // the attributed echo (hit results, damage, knockback stay server-owned).
    if (command.type === "attack" && status === "online") pendingEvents.push({ type: "attackSwung" });
    sendCmd(command);
  };

  // The replica engine + its aliases are REBINDABLE: dimension travel builds
  // a fresh mirror world (dimension profiles, worldgen, and the voxel field
  // are per-engine) and every helper below reads these bindings at call time.
  // Nothing may capture `engine`/`state`/`self` into a longer-lived closure
  // of its own — that would silently pin the pre-travel world.
  let engine!: GameEngine;
  let state!: GameState;
  let self!: PlayerState;

  /** (Re)builds the replica: an empty mirror world generated from the server's seed for one dimension. */
  const buildReplica = (dimension: DimensionId): void => {
    engine = new GameEngine({
      seed: welcome.seed,
      worldType: welcome.worldType as never,
      difficulty: welcome.difficulty as never,
      hardcore: welcome.hardcore,
      dimension,
      authority: "local",
      replica: true,
      bootPlayer: false,
      ...(options.worldSize ? { worldSize: options.worldSize } : {})
    });
    state = engine.state;
    state.primaryPlayerId = playerId;
    self = engine.addPlayer({ id: playerId });
    self.input = createIdleInput();
    engine.consumeEvents(); // drop the join echo
    engine.routeDispatch = routeDispatch;
  };

  buildReplica(welcome.dimension);
  state.dayClock = welcome.dayClock;
  serverTickTimeMs = welcome.tick * TICK_SECONDS * 1000;

  // Roster changes emit join/leave into the replica's event queue; those are
  // presented via the server's own tick `ev` instead, so drop them — but ONLY
  // them: a predicted blockPlaced emitted in the same frame must survive to
  // the shell's drain (its sound/particles are the whole point).
  const dropRosterEchoes = () => {
    const kept = engine.consumeEvents().filter((e) => e.type !== "playerJoined" && e.type !== "playerLeft");
    pendingEvents.push(...kept);
  };

  /** Every present player's dimension (self included) — the roster panel's source of truth. Replica avatars exist only for OUR dimension. */
  const dims = new Map<string, DimensionId>();

  const upsertRemotePlayer = (id: string, name: string, dim: DimensionId) => {
    names.set(id, name);
    dims.set(id, dim);
    if (id === playerId) return;
    if (dim !== state.dimension) {
      // In the world but not in our space: no replica avatar (the renderer
      // would draw them at raw coordinates inside the wrong terrain).
      if (state.players.has(id)) {
        engine.removePlayer(id);
        dropRosterEchoes();
        playerBuffers.delete(id);
      }
      notifyRoster();
      return;
    }
    if (state.players.has(id)) return;
    engine.addPlayer({ id });
    dropRosterEchoes();
    notifyRoster();
  };

  const applyRoster = (roster: WelcomeMessage["players"]) => {
    dims.clear(); // the roster is the full present set — playerDim races lose to it
    for (const entry of roster) upsertRemotePlayer(entry.id, entry.name, entry.dim);
    const present = new Set(roster.map((entry) => entry.id));
    // Anyone who left while we were away is no longer in the roster.
    for (const id of [...state.players.keys()]) {
      if (id === playerId || present.has(id)) continue;
      engine.removePlayer(id);
      dropRosterEchoes();
      playerBuffers.delete(id);
    }
    notifyRoster();
  };

  for (const entry of welcome.players) upsertRemotePlayer(entry.id, entry.name, entry.dim);
  dims.set(playerId, welcome.dimension);
  const myRoster = welcome.players.find((entry) => entry.id === playerId);
  if (myRoster) self.position.set(myRoster.x, myRoster.y, myRoster.z);

  /**
   * Server-initiated travel for the LOCAL player: rebuild the replica for the
   * target dimension in place — the socket stays open, the matching worldSync
   * (which seats us at the arrival portal) is already on the wire behind the
   * `dim` frame that triggered this.
   */
  let adoptSelfFromSync = false;
  const adoptDimension = (dimension: DimensionId, tick: number, dayClock: number) => {
    setStatus("syncing");
    buildReplica(dimension);
    state.dayClock = dayClock;
    serverTickTimeMs = tick * TICK_SECONDS * 1000;
    dims.set(playerId, dimension);
    // Nothing from the old space survives: predictions, interpolation
    // buffers, and the jitter window all described a world we just left.
    ledger.clear();
    playerBuffers.clear();
    mobBuffers.clear();
    delayCtl.reset();
    adoptSelfFromSync = true;
    const ev: GameEvent = { type: "playerDimension", playerId, dimension };
    pendingEvents.push(ev);
    callbacks.onEvent?.(ev);
    callbacks.onDimension?.(dimension);
    notifyRoster();
  };

  const applyWorldSync = (sync: WorldSync) => {
    // A (re)sync follows a gap that is not jitter — don't let it poison the window.
    delayCtl.reset();
    // The sync is a full keyframe: nothing pending survives it (and the block
    // diff it carries is truth, not an echo to suppress).
    ledger.clear();
    state.blockChanges.applySavedChanges(sync.changes);
    state.worldMeshDirty = true;
    state.dayClock = sync.dayClock;
    serverTickTimeMs = sync.tick * TICK_SECONDS * 1000;
    state.containers.clear();
    for (const entry of sync.blockEntities) {
      const restored = restoreInventorySlots({ id: "container", inventorySlots: entry.slots });
      if (restored) state.containers.set(entry.index, restored);
    }
    state.lootedWorldgenChests = new Set(sync.lootedChests);
    state.mobs = [];
    mobBuffers.clear();
    for (const pose of sync.liveMobs) upsertReplicaMob(pose);
    // Vehicles and in-flight arrows are replicated in (never simulated on the
    // replica); the join sync is their keyframe. Both were dropped in v1.
    state.vehicles = [];
    for (const pose of sync.vehicles) upsertReplicaVehicle(pose);
    applyProjectiles(sync.projectiles);
    applyRoster(sync.players);
    // Post-travel: the sync's roster carries our arrival-portal position — the
    // fresh replica seated us at a generic spawn. Ordinary resyncs never snap
    // (the client owns its own movement).
    if (adoptSelfFromSync) {
      adoptSelfFromSync = false;
      const mine = sync.players.find((entry) => entry.id === playerId);
      if (mine) {
        self.position.set(mine.x, mine.y, mine.z);
        self.velocity.set(0, 0, 0);
      }
    }
  };

  function upsertReplicaVehicle(pose: VehiclePose): void {
    const kind = (pose.kind === "ship" || pose.kind === "minecart" ? pose.kind : "raft") as VehicleKind;
    let vehicle = state.vehicles.find((v) => v.id === pose.id);
    if (!vehicle) {
      vehicle = { id: pose.id, kind, position: new THREE.Vector3(pose.x, pose.y, pose.z), yaw: pose.yaw, rider: pose.riderId };
      state.vehicles.push(vehicle);
    } else {
      vehicle.position.set(pose.x, pose.y, pose.z);
      vehicle.yaw = pose.yaw;
      vehicle.rider = pose.riderId;
    }
  }

  // Arrows snap per frame (they outrun the ~125 ms interpolation delay). Each
  // tick carries the FULL live set, so absence prunes: an arrow no longer listed
  // has landed/despawned server-side.
  function applyProjectiles(poses: ProjectilePose[]): void {
    const present = new Set(poses.map((p) => p.id));
    state.projectiles = state.projectiles.filter((p) => present.has(p.id));
    for (const pose of poses) upsertReplicaProjectile(pose);
  }

  function upsertReplicaProjectile(pose: ProjectilePose): void {
    let projectile = state.projectiles.find((p) => p.id === pose.id);
    if (!projectile) {
      // Non-simulated on the replica: only position + velocity feed the visual
      // (which derives orientation from velocity); the rest are inert placeholders.
      projectile = {
        id: pose.id,
        position: new THREE.Vector3(pose.x, pose.y, pose.z),
        velocity: new THREE.Vector3(pose.vx, pose.vy, pose.vz),
        yaw: 0,
        pitch: 0,
        damage: 0,
        knockback: 0,
        fromPlayer: true,
        ttl: 999
      };
      state.projectiles.push(projectile);
    } else {
      projectile.position.set(pose.x, pose.y, pose.z);
      projectile.velocity.set(pose.vx, pose.vy, pose.vz);
    }
  }

  function upsertReplicaMob(pose: MobPose): MobState {
    let mob = state.mobs.find((m) => m.id === pose.id);
    if (!mob) {
      const kind = (MOB_TEMPLATES[pose.kind as MobKind] ? pose.kind : "zombie") as MobKind;
      const template = MOB_TEMPLATES[kind];
      mob = {
        id: pose.id,
        kind,
        hostile: pose.hostile,
        faction: FACTION_BY_KIND[kind],
        targetId: null,
        retargetTimer: 0,
        hp: pose.hp,
        position: new THREE.Vector3(pose.x, pose.y, pose.z),
        direction: new THREE.Vector3(1, 0, 0),
        yaw: pose.yaw,
        turnTimer: 0,
        speed: template.speed,
        moveSpeed: pose.moveSpeed,
        detectRange: template.detectRange,
        attackDamage: 0,
        attackCooldown: 1,
        attackTimer: 0,
        halfHeight: mobHalfHeight(kind),
        bobSeed: pose.id * 0.7,
        fedTimer: 0,
        ageTimer: 0
      };
      state.mobs.push(mob);
    }
    mob.hp = pose.hp;
    mob.moveSpeed = pose.moveSpeed;
    let buffer = mobBuffers.get(pose.id);
    if (!buffer) {
      buffer = createPoseBuffer();
      mobBuffers.set(pose.id, buffer);
    }
    return mob;
  }

  const applySelfDelta = (delta: SelfDelta) => {
    const shim = { id: self.id, ...delta };
    if (delta.inventorySlots) self.inventory = restoreInventorySlots(shim) ?? self.inventory;
    if (delta.equippedArmor) self.equippedArmor = restoreEquippedArmor(shim) ?? self.equippedArmor;
    if (delta.selectedSlot !== undefined) self.selectedSlot = restoreSelectedSlot(shim) ?? self.selectedSlot;
    if (delta.hearts !== undefined) self.hearts = delta.hearts;
    if (delta.hunger !== undefined) self.hunger = delta.hunger;
    if (delta.oxygen !== undefined) self.oxygen = delta.oxygen;
    if (delta.xp !== undefined) self.xp = delta.xp;
    if (delta.isDead !== undefined) self.isDead = delta.isDead;
    if (delta.respawnSeconds !== undefined) self.respawnTimer = delta.respawnSeconds;
    if (delta.gameMode !== undefined) self.gameMode = delta.gameMode as never;
    if (delta.sleeping !== undefined) self.sleeping = delta.sleeping;
    if (delta.effects) {
      self.effects.clear();
      for (const { id, remaining } of restoreEffects(shim)) self.effects.set(id, remaining);
    }
    // Progression is server-owned: adopt our advancement set (grow-only) and the
    // event-driven stat counters. play_time/distance_walked aren't sent — the
    // replica's recordTick accrues those locally — so a plain set() preserves them.
    if (delta.advancements) self.advancements = new Set(delta.advancements);
    if (delta.stats) for (const { id, value } of delta.stats) self.stats.set(id, value);
    // Mounted: the server owns our position. Adopt the mount state and snap to
    // the authoritative position (the replica step skips its own motion while
    // mountedVehicleId is set, so the boat — not prediction — drives the camera).
    if (delta.mountedVehicleId !== undefined) self.mountedVehicleId = delta.mountedVehicleId;
    if (delta.x !== undefined && delta.y !== undefined && delta.z !== undefined) {
      self.position.set(delta.x, delta.y, delta.z);
      self.velocity.set(0, 0, 0);
    }
  };

  const cellOf = (idx: number) => {
    const layer = state.world.sizeX * state.world.sizeZ;
    const y = Math.floor(idx / layer);
    const rem = idx - y * layer;
    const z = Math.floor(rem / state.world.sizeX);
    const x = rem - z * state.world.sizeX;
    return { x, y, z };
  };

  /** Hand a rejected place's stack back; a full inventory drops it silently (the next full delta reconciles). */
  const refundToInventory = (refund: PredictionRefund) => {
    const updated = adjustSlotCount(self.inventory, refund.itemId, refund.count, self.selectedSlot);
    if (updated) self.inventory = updated;
  };

  /** Undo one predicted cell through the relight chokepoint (a predicted chest also brought a fresh container). */
  const revertPredictedEdit = (edit: { idx: number; block: number; prev: number }) => {
    const { x, y, z } = cellOf(edit.idx);
    if (edit.block === BlockId.Chest) state.containers.delete(edit.idx);
    state.blockChanges.set(x, y, z, edit.prev as never);
  };

  const applyBlocks = (blocks: Array<[number, number]>) => {
    for (const [idx, block] of blocks) {
      // The journal is the authority: it confirms matching predictions (skip
      // the redundant rewrite) and overrides losing ones — refund now (an
      // inventorySlots delta in the same tick wins over this anyway) and
      // revert the dropped prediction's unconfirmed sibling cells (a door's
      // other half): the server's placement may have failed entirely, and a
      // same-batch server write to a reverted cell still lands afterward.
      const { refunds, reverts } = ledger.onJournal(idx, block);
      for (const refund of refunds) refundToInventory(refund);
      for (const edit of reverts) revertPredictedEdit(edit);
      const { x, y, z } = cellOf(idx);
      if (state.world.get(x, y, z) !== block) state.blockChanges.set(x, y, z, block as never); // relights locally too
    }
    state.blockChanges.drainEditsDetailed(); // server writes must never register as predictions
    if (blocks.length > 0) state.worldMeshDirty = true;
  };

  // ── inbound frame processing (latency-shifted) ──────────────────────────────
  const onServerFrame = (data: unknown) => {
    traffic.inBytes += typeof data === "string" ? data.length : ((data as ArrayBuffer).byteLength ?? 0);
    if (simulatedLatencyMs > 0 || simulatedJitterMs > 0) {
      recvLine.push(() => void processServerFrame(data));
      return;
    }
    void processServerFrame(data);
  };

  async function processServerFrame(data: unknown): Promise<void> {
    if (typeof data !== "string") {
      const sync = await gunzipWorldSync(new Uint8Array(data as ArrayBuffer));
      if (sync) {
        // A sync for a dimension we're no longer in is a stale resync that
        // raced a travel swap — applying it would write the wrong world's
        // block diff into this replica.
        if (sync.dimension !== state.dimension) return;
        applyWorldSync(sync);
        setStatus("online");
      }
      return;
    }
    const message = decodeServerFrame(data);
    if (!message) return;
    switch (message.t) {
      case "tick": {
        delayCtl.onTickArrival(performance.now(), message.n);
        serverTickTimeMs = message.n * TICK_SECONDS * 1000;
        if (message.blocks) applyBlocks(message.blocks);
        if (message.day !== undefined) state.dayClock = message.day;
        if (message.self) applySelfDelta(message.self);
        for (const pose of message.pp) {
          // Tick poses are dimension-scoped by the server: anyone in `pp` is in OUR space.
          upsertRemotePlayer(pose.id, names.get(pose.id) ?? "player", state.dimension);
          let buffer = playerBuffers.get(pose.id);
          if (!buffer) {
            buffer = createPoseBuffer();
            playerBuffers.set(pose.id, buffer);
          }
          buffer.push({ tMs: serverTickTimeMs, ...pose });
        }
        for (const pose of message.mp) {
          upsertReplicaMob(pose);
          mobBuffers.get(pose.id)?.push({ tMs: serverTickTimeMs, x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw });
        }
        if (message.vp) for (const pose of message.vp) upsertReplicaVehicle(pose);
        if (message.prj) applyProjectiles(message.prj);
        const evNow = performance.now();
        for (const gameEvent of message.ev) {
          const ev = gameEvent as AttributedGameEvent;
          // Own block-edit echoes at predicted cells were already presented
          // at click time — swallowing the echo prevents the doubled sound/
          // particles. Other players' edits (and own non-predicted ones)
          // flow through untouched.
          if (
            (ev.type === "blockPlaced" || ev.type === "blockBroken") &&
            ev.playerId === playerId &&
            ledger.shouldSuppress(state.world.index(ev.x, ev.y, ev.z), evNow)
          ) {
            continue;
          }
          // Own swing echoes: the synthetic swing already played at click time.
          if (ev.type === "attackSwung" && ev.playerId === playerId) continue;
          pendingEvents.push(ev);
          callbacks.onEvent?.(ev);
        }
        return;
      }
      case "mobsKeyframe": {
        const alive = new Set(message.mobs.map((m) => m.id));
        state.mobs = state.mobs.filter((m) => alive.has(m.id));
        for (const id of [...mobBuffers.keys()]) if (!alive.has(id)) mobBuffers.delete(id);
        const tMs = message.n * TICK_SECONDS * 1000;
        for (const pose of message.mobs) {
          upsertReplicaMob(pose);
          mobBuffers.get(pose.id)?.push({ tMs, x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw });
        }
        return;
      }
      case "playerJoined": {
        upsertRemotePlayer(message.player.id, message.player.name, message.player.dim);
        const joined = state.players.get(message.player.id);
        joined?.position.set(message.player.x, message.player.y, message.player.z);
        return;
      }
      case "playerLeft": {
        if (message.id !== playerId) engine.removePlayer(message.id);
        playerBuffers.delete(message.id);
        dims.delete(message.id);
        dropRosterEchoes();
        notifyRoster();
        return;
      }
      case "dim": {
        adoptDimension(message.dimension, message.tick, message.dayClock);
        return;
      }
      case "playerDim": {
        // Someone ELSE changed dimension (our own travel rides the dim +
        // worldSync pair above). Prune their avatar if they left our space;
        // if they entered it, the very next tick's pose stream re-adds them
        // at their real spot (adding here would flash them at world spawn).
        if (message.id === playerId) return;
        dims.set(message.id, message.dimension);
        if (message.dimension !== state.dimension && state.players.has(message.id)) {
          engine.removePlayer(message.id);
          dropRosterEchoes();
        }
        if (message.dimension !== state.dimension) playerBuffers.delete(message.id);
        const ev: GameEvent = { type: "playerDimension", playerId: message.id, dimension: message.dimension };
        pendingEvents.push(ev);
        callbacks.onEvent?.(ev);
        notifyRoster();
        return;
      }
      case "container": {
        const restored = restoreInventorySlots({ id: "container", inventorySlots: message.slots });
        if (restored) state.containers.set(message.index, restored);
        return;
      }
      case "chat":
        callbacks.onChat?.(message);
        for (const listener of chatListeners) listener(message);
        return;
      case "pong":
        clock.onPong(message.tMs, performance.now(), message.serverTick);
        return;
      case "forcePose":
        self.position.set(message.x, message.y, message.z);
        self.velocity.set(0, 0, 0);
        return;
      case "welcome":
        return;
    }
  }

  // ── reconnect ladder ────────────────────────────────────────────────────────
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const onSocketClosed = (code: number, reason: string) => {
    if (disposed) return;
    if (FATAL_CLOSES.has(code) || !options.reconnect) {
      setStatus("closed", `${code} ${reason}`);
      return;
    }
    scheduleReconnect();
  };

  const scheduleReconnect = () => {
    if (disposed) return;
    if (reconnectAttempt >= RECONNECT_DELAYS_MS.length) {
      setStatus("closed", "could not reconnect");
      return;
    }
    const delay = RECONNECT_DELAYS_MS[reconnectAttempt];
    reconnectAttempt += 1;
    setStatus("reconnecting", `attempt ${reconnectAttempt}`);
    reconnectTimer = setTimeout(() => void tryReconnectOnce(), delay);
  };

  async function tryReconnectOnce(): Promise<void> {
    if (disposed || !options.reconnect) return;
    const grant = await options.reconnect();
    if (disposed) return;
    if (!grant) {
      scheduleReconnect();
      return;
    }
    try {
      const resumed = await handshake(grant.ticket, grant.url);
      if (disposed) return;
      // Same room, same id: keep the replica; the world-sync that follows
      // re-seeds it. Just refresh the roster and the server-time anchor.
      // EXCEPT when the server has us in another dimension (a drop raced a
      // travel, or we were moved while away) — then rebuild for it first so
      // the incoming sync lands in the right world.
      if (resumed.dimension !== state.dimension) {
        adoptDimension(resumed.dimension, resumed.tick, resumed.dayClock);
      } else {
        serverTickTimeMs = resumed.tick * TICK_SECONDS * 1000;
      }
      applyRoster(resumed.players);
      reconnectAttempt = 0;
      setStatus("syncing");
    } catch {
      scheduleReconnect();
    }
  }

  // ── outbound ────────────────────────────────────────────────────────────────
  let seq = 0;
  let lastPoseSentMs = 0;
  let lastPingMs = 0;
  /** The last frame's interpolation render time (server timeline ms) — the attack view stamp. Null until the clock syncs. */
  let lastRenderTimeMs: number | null = null;

  const sendCmd = (command: Command) => {
    seq += 1;
    // Foot position (matching the pose stream): the server clamps it into
    // player.position, then the engine derives the eye/aim ray from it by
    // adding EYE_HEIGHT — sending eye height here would double that offset.
    // Attacks additionally carry the render-time view stamp so the server can
    // rewind melee target selection to what this player saw (bounded there).
    delayedSend(
      encodeClientMessage({
        t: "cmd",
        seq,
        d: state.dimension,
        cmd: command,
        pose: { x: qPos(self.position.x), y: qPos(self.position.y), z: qPos(self.position.z), yaw: qAng(self.yaw), pitch: qAng(self.pitch) },
        ...(command.type === "attack" && lastRenderTimeMs !== null ? { view: Math.round(Math.max(0, lastRenderTimeMs)) } : {})
      })
    );
  };

  const session: NetworkSession = {
    // A getter, not a snapshot: dimension travel rebinds the engine.
    get engine() {
      return engine;
    },
    playerId,
    role: welcome.role,
    subscribeChat(listener) {
      chatListeners.add(listener);
      return () => chatListeners.delete(listener);
    },
    subscribeStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    subscribeRoster(listener) {
      rosterListeners.add(listener);
      return () => rosterListeners.delete(listener);
    },
    roster: () => [...dims.entries()].map(([id, dimension]) => ({ id, name: names.get(id) ?? "player", dimension })),
    kick(targetId) {
      if (targetId !== playerId) delayedSend(encodeClientMessage({ t: "kick", targetId }));
    },
    drainEvents: () => pendingEvents.splice(0, pendingEvents.length),
    status: () => status,
    rttMs: () => clock.rttMs(),
    playerName: (id) => names.get(id) ?? "player",

    dispatch(command) {
      engine.dispatch(command); // routeDispatch handles the local/network split
    },

    applyLook(deltaYaw, deltaPitch) {
      engine.applyLook(deltaYaw, deltaPitch);
    },

    sendChat(text) {
      if (text.trim()) delayedSend(encodeClientMessage({ t: "chat", text: text.slice(0, 256) }));
    },

    setSimulatedLatency(ms, jitterMs) {
      simulatedLatencyMs = Math.max(0, Math.floor(ms));
      simulatedJitterMs = Math.max(0, Math.floor(jitterMs ?? 0));
    },
    simulatedLatency: () => simulatedLatencyMs,
    simulatedJitter: () => simulatedJitterMs,

    netStats: () => ({
      rttMs: clock.rttMs(),
      jitterMs: delayCtl.jitterMs(),
      interpDelayMs: delayCtl.currentDelayMs(),
      inKBps: traffic.inKBps,
      outKBps: traffic.outKBps,
      pendingPredictions: ledger.size()
    }),

    afterFrame(nowMs) {
      rollTrafficWindow(nowMs);
      const socketOpen = ws?.readyState === WebSocket.OPEN;
      // Predictive-mining capture: any journal entries at this point are
      // breaks the replica step just committed (placement and server writes
      // drain inline where they happen). While disconnected the server can't
      // hear the mineHeld stream, so an offline break would ghost forever —
      // undo it on the spot instead of ledgering it.
      const mined = state.blockChanges.drainEditsDetailed().filter((e) => e.block !== e.prev);
      if (mined.length > 0) {
        if (socketOpen && status === "online") {
          ledger.add("break", mined, null, performance.now(), clock.rttMs());
        } else {
          for (const edit of [...mined].reverse()) {
            const { x, y, z } = cellOf(edit.idx);
            state.blockChanges.set(x, y, z, edit.prev as never);
          }
          state.blockChanges.drainEditsDetailed();
          state.worldMeshDirty = true;
        }
      }
      // Expired predictions: the server neither confirmed nor overrode in
      // time (a rejected place, a lost cmd). Revert newest-first through the
      // same chokepoint that applied them — relighting rides along — and hand
      // the stack back. The echo-suppress window deliberately outlives this:
      // a late confirm re-applies via the journal without a doubled sound.
      for (const prediction of ledger.expire(performance.now())) {
        for (const edit of [...prediction.edits].reverse()) {
          if (!edit.confirmed) revertPredictedEdit(edit);
        }
        if (prediction.refund) refundToInventory(prediction.refund);
        state.blockChanges.drainEditsDetailed(); // reverts aren't predictions either
        state.worldMeshDirty = true;
      }
      const open = socketOpen;
      // Pose stream at tick rate — but NOT while a travel swap awaits its
      // worldSync: the fresh replica seated `self` at a generic spawn, and
      // streaming that transient position can walk the server player out of
      // the arrival portal (clearing the latch — an idle player then re-dwells
      // and ping-pongs between dimensions).
      if (open && !adoptSelfFromSync && nowMs - lastPoseSentMs >= TICK_SECONDS * 1000) {
        lastPoseSentMs = nowMs;
        seq += 1;
        delayedSend(
          encodeClientMessage({
            t: "pose",
            seq,
            d: state.dimension,
            x: qPos(self.position.x),
            y: qPos(self.position.y),
            z: qPos(self.position.z),
            yaw: qAng(self.yaw),
            pitch: qAng(self.pitch),
            onGround: self.onGround,
            move: self.input.move,
            mineHeld: self.input.mineHeld
          })
        );
      }
      if (open && nowMs - lastPingMs >= PING_INTERVAL_MS) {
        lastPingMs = nowMs;
        delayedSend(encodeClientMessage({ t: "ping", id: seq, tMs: nowMs }));
      }
      // Interpolation: remote entities render in the past, far enough to
      // absorb the measured arrival jitter (adaptive, slewed — no warping).
      const renderTime = (clock.ready() ? clock.estimatedServerTimeMs(nowMs) : serverTickTimeMs) - delayCtl.effectiveDelayMs(nowMs);
      // The view stamp for lag compensation: a click lands between frames, so
      // the mobs on screen are the ones THIS sample time drew. Only trusted
      // once the clock is synced — until then attacks go out unstamped.
      if (clock.ready()) lastRenderTimeMs = renderTime;
      for (const [id, buffer] of playerBuffers) {
        const player = state.players.get(id);
        const pose = buffer.sample(renderTime);
        if (player && pose) {
          player.position.set(pose.x, pose.y, pose.z);
          player.yaw = pose.yaw;
          player.pitch = pose.pitch;
        }
      }
      for (const [id, buffer] of mobBuffers) {
        const mob = state.mobs.find((m) => m.id === id);
        const pose = buffer.sample(renderTime);
        if (mob && pose) {
          mob.position.set(pose.x, pose.y, pose.z);
          mob.yaw = pose.yaw;
        }
      }
    },

    dispose() {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      sendLine.clear();
      recvLine.clear();
      setStatus("closed", "left world");
      try {
        ws?.close(1000, "leaving");
      } catch {
        /* already closed */
      }
    }
  };
  return session;
}
