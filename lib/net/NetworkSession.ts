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
import { PROTOCOL_VERSION, type MobPose, type SelfDelta, type ServerMessage, type WorldSync } from "./protocol";

/**
 * The client end of a multiplayer world: owns the WebSocket and a REPLICA
 * engine the existing renderer/audio/HUD consume unchanged. Outbound, it
 * streams the local player's pose at tick rate and routes commands — local
 * presentation stays on the replica, gameplay goes to the server (selectSlot
 * optimistically does both). Inbound, it applies the server's block journal,
 * replays events into the shell's existing event drain, feeds pose buffers
 * for ~125 ms-delayed interpolation, and overwrites the local player's
 * private state from self-deltas (the server owns your vitals).
 */

export type NetStatus = "connecting" | "syncing" | "online" | "closed";

export type NetworkSessionCallbacks = {
  onStatus?(status: NetStatus, detail?: string): void;
  onChat?(entry: { from: string; name: string; text: string }): void;
  /** Server events the shell's drain should also see (toasts, audio, particles). */
  onEvent?(event: GameEvent): void;
};

/** Commands that never leave the client: pure presentation on the replica. */
const LOCAL_COMMANDS = new Set<Command["type"]>(["toggleInventory", "toggleAdvancements", "toggleDebug", "toggleCameraView", "pause", "resume"]);

export type NetworkSession = {
  readonly engine: GameEngine;
  readonly playerId: PlayerId;
  status(): NetStatus;
  rttMs(): number;
  /** Names for remote player ids (name tags, chat). */
  playerName(id: PlayerId): string;
  dispatch(command: Command): void;
  applyLook(deltaYaw: number, deltaPitch: number): void;
  sendChat(text: string): void;
  /** Call once per rAF after engine.step: flushes the pose stream and samples interpolation. */
  afterFrame(nowMs: number): void;
  dispose(): void;
};

export async function connectNetworkSession(
  url: string,
  ticket: string,
  callbacks: NetworkSessionCallbacks = {},
  makeSocket: (url: string) => WebSocket = (u) => new WebSocket(u)
): Promise<NetworkSession> {
  const ws = makeSocket(`${url.replace(/\/$/, "")}/ws`);
  ws.binaryType = "arraybuffer";
  let status: NetStatus = "connecting";
  const setStatus = (next: NetStatus, detail?: string) => {
    status = next;
    callbacks.onStatus?.(next, detail);
  };

  const clock = createClockSync();
  const playerBuffers = new Map<string, PoseBuffer>();
  const mobBuffers = new Map<number, PoseBuffer>();
  const names = new Map<string, string>();

  // ── handshake: hello → welcome → binary world sync ─────────────────────────
  const welcome = await new Promise<Extract<ServerMessage, { t: "welcome" }>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("join timed out")), 15000);
    ws.onerror = () => reject(new Error("connection failed"));
    ws.onclose = (event) => reject(new Error(`refused: ${event.code} ${event.reason}`));
    ws.onopen = () => ws.send(encodeClientMessage({ t: "hello", ticket, protocol: PROTOCOL_VERSION }));
    ws.onmessage = (event) => {
      const message = decodeServerFrame(event.data);
      if (message?.t === "welcome") {
        clearTimeout(timer);
        resolve(message);
      }
    };
  });
  setStatus("syncing");

  // The replica: an empty mirror world generated from the server's seed.
  const engine = new GameEngine({
    seed: welcome.seed,
    worldType: welcome.worldType as never,
    difficulty: welcome.difficulty as never,
    hardcore: welcome.hardcore,
    authority: "local",
    replica: true,
    bootPlayer: false
  });
  const state = engine.state;
  state.dayClock = welcome.dayClock;
  state.primaryPlayerId = welcome.playerId;
  const self = engine.addPlayer({ id: welcome.playerId });
  self.input = createIdleInput();
  engine.consumeEvents(); // drop the join echo
  for (const entry of welcome.players) names.set(entry.id, entry.name);
  const myRoster = welcome.players.find((entry) => entry.id === welcome.playerId);
  if (myRoster) self.position.set(myRoster.x, myRoster.y, myRoster.z);

  const upsertRemotePlayer = (id: string, name: string) => {
    if (id === welcome.playerId || state.players.has(id)) return;
    engine.addPlayer({ id });
    engine.consumeEvents();
    names.set(id, name);
  };
  for (const entry of welcome.players) upsertRemotePlayer(entry.id, entry.name);

  const applyWorldSync = (sync: WorldSync) => {
    state.blockChanges.applySavedChanges(sync.changes);
    state.worldMeshDirty = true;
    state.dayClock = sync.dayClock;
    state.containers.clear();
    for (const entry of sync.blockEntities) {
      const restored = restoreInventorySlots({ id: "container", inventorySlots: entry.slots });
      if (restored) state.containers.set(entry.index, restored);
    }
    state.lootedWorldgenChests = new Set(sync.lootedChests);
    state.mobs = [];
    mobBuffers.clear();
    for (const pose of sync.liveMobs) upsertReplicaMob(pose);
    for (const entry of sync.players) upsertRemotePlayer(entry.id, entry.name);
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

  let serverTickTimeMs = welcome.tick * TICK_SECONDS * 1000;

  ws.onclose = (event) => setStatus("closed", `${event.code} ${event.reason}`);
  ws.onerror = () => setStatus("closed", "socket error");
  ws.onmessage = async (event) => {
    if (typeof event.data !== "string") {
      const sync = await gunzipWorldSync(new Uint8Array(event.data as ArrayBuffer));
      if (sync) {
        applyWorldSync(sync);
        setStatus("online");
      }
      return;
    }
    const message = decodeServerFrame(event.data);
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
        for (const gameEvent of message.ev) callbacks.onEvent?.(gameEvent as GameEvent);
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
        if (message.id !== welcome.playerId) engine.removePlayer(message.id);
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
  };

  // ── outbound ────────────────────────────────────────────────────────────────
  let seq = 0;
  let lastPoseSentMs = 0;
  let lastPingMs = 0;

  const sendCmd = (command: Command) => {
    seq += 1;
    ws.send(
      encodeClientMessage({
        t: "cmd",
        seq,
        cmd: command,
        pose: { x: self.position.x, y: self.position.y + 1.62, z: self.position.z, yaw: self.yaw, pitch: self.pitch }
      })
    );
  };

  return {
    engine,
    playerId: welcome.playerId,
    status: () => status,
    rttMs: () => clock.rttMs(),
    playerName: (id) => names.get(id) ?? "player",

    dispatch(command) {
      if (LOCAL_COMMANDS.has(command.type)) {
        engine.dispatch(command);
        return;
      }
      // Optimistic hotbar: instant local feedback, server confirms via self-delta.
      if (command.type === "selectSlot") engine.dispatch(command);
      if (ws.readyState === WebSocket.OPEN) sendCmd(command);
    },

    applyLook(deltaYaw, deltaPitch) {
      engine.applyLook(deltaYaw, deltaPitch);
    },

    sendChat(text) {
      if (ws.readyState === WebSocket.OPEN && text.trim()) ws.send(encodeClientMessage({ t: "chat", text: text.slice(0, 256) }));
    },

    afterFrame(nowMs) {
      // Pose stream at tick rate.
      if (ws.readyState === WebSocket.OPEN && nowMs - lastPoseSentMs >= TICK_SECONDS * 1000) {
        lastPoseSentMs = nowMs;
        seq += 1;
        ws.send(
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
      if (ws.readyState === WebSocket.OPEN && nowMs - lastPingMs >= 2000) {
        lastPingMs = nowMs;
        ws.send(encodeClientMessage({ t: "ping", id: seq, tMs: nowMs }));
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
      setStatus("closed", "left world");
      try {
        ws.close(1000, "leaving");
      } catch {
        /* already closed */
      }
    }
  };
}
