import * as THREE from "three";
import { GameEngine } from "@/lib/game/engine/GameEngine";
import type { Command } from "@/lib/game/engine/commands";
import { createIdleInput, type GameEvent, type MobState, type PlayerId } from "@/lib/game/engine/state";
import { TICK_SECONDS } from "@/lib/game/engine/tickDriver";
import { restoreEffects, restoreEquippedArmor, restoreInventorySlots, restoreSelectedSlot } from "@/lib/game/save";
import { MOB_TEMPLATES, mobHalfHeight } from "@/lib/game/mobs";
import { FACTION_BY_KIND } from "@/lib/game/mobs";
import type { MobKind } from "@/lib/game/types";
import { createClockSync } from "./clock";
import { decodeServerFrame, encodeClientMessage, gunzipWorldSync } from "./codec";
import { createPoseBuffer, INTERPOLATION_DELAY_MS, type PoseBuffer } from "./interpolation";
import {
  CLOSE_BAD_TICKET,
  CLOSE_KICKED,
  CLOSE_PROTOCOL_MISMATCH,
  CLOSE_ROOM_FULL,
  CLOSE_SLOW_CLIENT,
  PROTOCOL_VERSION,
  RECONNECT_DELAYS_MS,
  type MobPose,
  type SelfDelta,
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

export type NetworkSession = {
  readonly engine: GameEngine;
  readonly playerId: PlayerId;
  /** UI subscriptions (React components mount after connect; unsubscribe on cleanup). */
  subscribeChat(listener: (entry: { from: string; name: string; text: string }) => void): () => void;
  subscribeStatus(listener: (status: NetStatus) => void): () => void;
  status(): NetStatus;
  rttMs(): number;
  /** Names for remote player ids (name tags, chat). */
  playerName(id: PlayerId): string;
  dispatch(command: Command): void;
  applyLook(deltaYaw: number, deltaPitch: number): void;
  sendChat(text: string): void;
  /** Debug knob: inject symmetric latency on every send/receive (0 disables). */
  setSimulatedLatency(ms: number): void;
  simulatedLatency(): number;
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
  let simulatedLatencyMs = options.simulatedLatencyMs ?? (Number.isFinite(envLatency) ? envLatency : 0);

  let status: NetStatus = "connecting";
  let disposed = false;
  let ws: WebSocket | null = null;
  const chatListeners = new Set<(entry: { from: string; name: string; text: string }) => void>();
  const statusListeners = new Set<(status: NetStatus) => void>();
  const setStatus = (next: NetStatus, detail?: string) => {
    status = next;
    callbacks.onStatus?.(next, detail);
    for (const listener of statusListeners) listener(next);
  };

  const clock = createClockSync();
  const pendingEvents: GameEvent[] = [];
  const playerBuffers = new Map<string, PoseBuffer>();
  const mobBuffers = new Map<number, PoseBuffer>();
  const names = new Map<string, string>();
  let serverTickTimeMs = 0;

  // Latency simulation wraps both directions symmetrically so `ms` reads as a
  // one-way delay (round-trip ≈ 2×ms), matching how a player would set it.
  const delayedSend = (data: string) => {
    const socket = ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (simulatedLatencyMs > 0) {
      setTimeout(() => {
        try {
          if (socket.readyState === WebSocket.OPEN) socket.send(data);
        } catch {
          /* socket closed under us */
        }
      }, simulatedLatencyMs);
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

  // The replica: an empty mirror world generated from the server's seed.
  const engine = new GameEngine({
    seed: welcome.seed,
    worldType: welcome.worldType as never,
    difficulty: welcome.difficulty as never,
    hardcore: welcome.hardcore,
    authority: "local",
    replica: true,
    bootPlayer: false,
    ...(options.worldSize ? { worldSize: options.worldSize } : {})
  });
  const state = engine.state;
  const playerId = welcome.playerId;
  state.dayClock = welcome.dayClock;
  state.primaryPlayerId = playerId;
  const self = engine.addPlayer({ id: playerId });
  self.input = createIdleInput();
  engine.consumeEvents(); // drop the join echo
  serverTickTimeMs = welcome.tick * TICK_SECONDS * 1000;

  // Every dispatch from the UI/input controller routes here (see
  // GameEngine.routeDispatch): presentation stays local, gameplay goes up.
  engine.routeDispatch = (command) => {
    if (LOCAL_COMMANDS.has(command.type)) {
      engine.dispatch(command, playerId);
      return;
    }
    if (command.type === "selectSlot") engine.dispatch(command, playerId); // optimistic
    sendCmd(command);
  };

  const upsertRemotePlayer = (id: string, name: string) => {
    names.set(id, name);
    if (id === playerId || state.players.has(id)) return;
    engine.addPlayer({ id });
    engine.consumeEvents();
  };

  const applyRoster = (roster: WelcomeMessage["players"]) => {
    for (const entry of roster) upsertRemotePlayer(entry.id, entry.name);
    const present = new Set(roster.map((entry) => entry.id));
    // Anyone who left while we were away is no longer in the roster.
    for (const id of [...state.players.keys()]) {
      if (id === playerId || present.has(id)) continue;
      engine.removePlayer(id);
      engine.consumeEvents();
      playerBuffers.delete(id);
    }
  };

  for (const entry of welcome.players) upsertRemotePlayer(entry.id, entry.name);
  const myRoster = welcome.players.find((entry) => entry.id === playerId);
  if (myRoster) self.position.set(myRoster.x, myRoster.y, myRoster.z);

  const applyWorldSync = (sync: WorldSync) => {
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
    applyRoster(sync.players);
  };

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
  };

  const applyBlocks = (blocks: Array<[number, number]>) => {
    const layer = state.world.sizeX * state.world.sizeZ;
    for (const [idx, block] of blocks) {
      const y = Math.floor(idx / layer);
      const rem = idx - y * layer;
      const z = Math.floor(rem / state.world.sizeX);
      const x = rem - z * state.world.sizeX;
      state.blockChanges.set(x, y, z, block as never); // relights locally too
    }
    if (blocks.length > 0) state.worldMeshDirty = true;
  };

  // ── inbound frame processing (latency-shifted) ──────────────────────────────
  const onServerFrame = (data: unknown) => {
    if (simulatedLatencyMs > 0) {
      setTimeout(() => void processServerFrame(data), simulatedLatencyMs);
      return;
    }
    void processServerFrame(data);
  };

  async function processServerFrame(data: unknown): Promise<void> {
    if (typeof data !== "string") {
      const sync = await gunzipWorldSync(new Uint8Array(data as ArrayBuffer));
      if (sync) {
        applyWorldSync(sync);
        setStatus("online");
      }
      return;
    }
    const message = decodeServerFrame(data);
    if (!message) return;
    switch (message.t) {
      case "tick": {
        serverTickTimeMs = message.n * TICK_SECONDS * 1000;
        if (message.blocks) applyBlocks(message.blocks);
        if (message.day !== undefined) state.dayClock = message.day;
        if (message.self) applySelfDelta(message.self);
        for (const pose of message.pp) {
          upsertRemotePlayer(pose.id, names.get(pose.id) ?? "player");
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
        for (const gameEvent of message.ev) {
          pendingEvents.push(gameEvent as GameEvent);
          callbacks.onEvent?.(gameEvent as GameEvent);
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
        upsertRemotePlayer(message.player.id, message.player.name);
        const joined = state.players.get(message.player.id);
        joined?.position.set(message.player.x, message.player.y, message.player.z);
        return;
      }
      case "playerLeft": {
        if (message.id !== playerId) engine.removePlayer(message.id);
        playerBuffers.delete(message.id);
        engine.consumeEvents();
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
      serverTickTimeMs = resumed.tick * TICK_SECONDS * 1000;
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

  const sendCmd = (command: Command) => {
    seq += 1;
    delayedSend(
      encodeClientMessage({
        t: "cmd",
        seq,
        cmd: command,
        pose: { x: self.position.x, y: self.position.y + 1.62, z: self.position.z, yaw: self.yaw, pitch: self.pitch }
      })
    );
  };

  const session: NetworkSession = {
    engine,
    playerId,
    subscribeChat(listener) {
      chatListeners.add(listener);
      return () => chatListeners.delete(listener);
    },
    subscribeStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
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

    setSimulatedLatency(ms) {
      simulatedLatencyMs = Math.max(0, Math.floor(ms));
    },
    simulatedLatency: () => simulatedLatencyMs,

    afterFrame(nowMs) {
      const open = ws?.readyState === WebSocket.OPEN;
      // Pose stream at tick rate.
      if (open && nowMs - lastPoseSentMs >= TICK_SECONDS * 1000) {
        lastPoseSentMs = nowMs;
        seq += 1;
        delayedSend(
          encodeClientMessage({
            t: "pose",
            seq,
            x: self.position.x,
            y: self.position.y,
            z: self.position.z,
            yaw: self.yaw,
            pitch: self.pitch,
            onGround: self.onGround,
            move: self.input.move,
            mineHeld: self.input.mineHeld
          })
        );
      }
      if (open && nowMs - lastPingMs >= 2000) {
        lastPingMs = nowMs;
        delayedSend(encodeClientMessage({ t: "ping", id: seq, tMs: nowMs }));
      }
      // Interpolation: remote entities render ~125ms in the past.
      const renderTime = (clock.ready() ? clock.estimatedServerTimeMs(nowMs) : serverTickTimeMs) - INTERPOLATION_DELAY_MS;
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
