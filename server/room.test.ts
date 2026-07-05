import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { PROTOCOL_VERSION, type ServerMessage, type WorldSync } from "@/lib/net/protocol";
import { gunzipWorldSync } from "@/lib/net/codec";
import { restoreVehicle } from "@/lib/game/engine/systems/vehicles";
import type { TicketClaims } from "@/lib/net/tickets";
import { FACTION_BY_KIND } from "@/lib/game/mobs";
import type { MobState } from "@/lib/game/engine/state";
import { createMemoryPersistence, parseSaveBlob } from "./persistence";
import { MELEE_REWIND_MAX_TICKS } from "./mobHistory";
import { Room, type ClientSink } from "./room";

/**
 * The room's contracts, exercised through fake sockets against the in-memory
 * persistence — every joined client is a scripted sink, every tick is driven
 * by hand (no real timers), and the world is a real (small… no — full-size)
 * engine. Room construction takes a couple of seconds (worldgen); the suite
 * shares one room per describe where isolation allows.
 */

type Frame = { kind: "text"; message: ServerMessage } | { kind: "binary"; sync: Promise<WorldSync | null> } | { kind: "close"; code: number };

function fakeSink(): ClientSink & { frames: Frame[]; messagesOf<T extends ServerMessage["t"]>(t: T): Array<Extract<ServerMessage, { t: T }>> } {
  const frames: Frame[] = [];
  return {
    frames,
    send(data) {
      if (typeof data === "string") frames.push({ kind: "text", message: JSON.parse(data) as ServerMessage });
      else frames.push({ kind: "binary", sync: gunzipWorldSync(data) });
    },
    close(code) {
      frames.push({ kind: "close", code });
    },
    bufferedAmount: () => 0,
    messagesOf<T extends ServerMessage["t"]>(t: T) {
      return frames
        .filter((f): f is Extract<Frame, { kind: "text" }> => f.kind === "text")
        .map((f) => f.message)
        .filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
    }
  };
}

function claimsFor(id: string, wid: string, role: "owner" | "member" = "member"): TicketClaims {
  return { sub: id, wid, name: id.toUpperCase(), skinId: null, role, pv: PROTOCOL_VERSION, iat: 0, exp: 9999999999 };
}

const move = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, crouch: false };

async function makeRoom(worldId = "w1") {
  const persistence = createMemoryPersistence();
  const record = await persistence.loadWorld(worldId);
  const room = new Room(record!, persistence, () => 0);
  return { room, persistence };
}

describe("room lifecycle", () => {
  test("join → welcome + gzipped world sync; a second join is announced to the first", async () => {
    const { room } = await makeRoom();
    const a = fakeSink();
    expect(await room.join(claimsFor("alice", "w1", "owner"), a)).toBe(true);

    const welcome = a.messagesOf("welcome")[0];
    expect(welcome).toMatchObject({ protocol: PROTOCOL_VERSION, playerId: "alice", worldId: "w1", role: "owner" });
    expect(welcome.seed).toBeGreaterThan(0);

    const binary = a.frames.find((f) => f.kind === "binary");
    expect(binary).toBeTruthy();
    const sync = await (binary as Extract<Frame, { kind: "binary" }>).sync;
    expect(sync).toMatchObject({ t: "worldSync" });
    expect(Array.isArray(sync!.changes)).toBe(true);

    const b = fakeSink();
    await room.join(claimsFor("bob", "w1"), b);
    expect(a.messagesOf("playerJoined")[0]?.player.id).toBe("bob");
    expect(room.playerCount()).toBe(2);
  });

  test("a 9th join is refused with ROOM_FULL", async () => {
    const { room } = await makeRoom();
    for (let i = 0; i < 8; i += 1) expect(await room.join(claimsFor(`p${i}`, "w1"), fakeSink())).toBe(true);
    const ninth = fakeSink();
    expect(await room.join(claimsFor("p9", "w1"), ninth)).toBe(false);
    expect(ninth.frames.find((f) => f.kind === "close")).toMatchObject({ code: 4002 });
  });

  test("block edits propagate: one player's placeBlock reaches the other as a tick event", async () => {
    const { room } = await makeRoom();
    const a = fakeSink();
    const b = fakeSink();
    await room.join(claimsFor("alice", "w1", "owner"), a);
    await room.join(claimsFor("bob", "w1"), b);
    // Aim alice straight down at the block underfoot and give her a mined-out
    // path… simpler: force a block change through the engine's own dispatch
    // (the same door a cmd message takes) and let the tick broadcast it.
    const alice = room.engine.state.players.get("alice")!;
    alice.inventory = [...alice.inventory];
    room.engine.state.blockChanges.set(5, 5, 5, 1);
    room.engine.state.worldMeshDirty = true;
    (room.engine as unknown as { emit: (e: unknown) => void }).emit({ type: "blockPlaced", blockId: 1, x: 5, y: 5, z: 5 });
    (room as unknown as { tick(dt: number): void }).tick(0.05);

    const tickB = b.messagesOf("tick").at(-1);
    expect(tickB?.ev.some((e) => e.type === "blockPlaced" && e.x === 5)).toBe(true);
    // …and bob's tick carries alice's pose, not his own.
    expect(tickB?.pp.some((p) => p.id === "alice")).toBe(true);
    expect(tickB?.pp.some((p) => p.id === "bob")).toBe(false);
    // Wire poses are quantized (re-quantizing is a no-op).
    for (const p of tickB!.pp) {
      expect(p.x).toBe(Math.round(p.x * 100) / 100);
      expect(p.yaw).toBe(Math.round(p.yaw * 1000) / 1000);
    }
  });

  test("tick events carry the acting player's id (echo dedup relies on it)", async () => {
    const { room } = await makeRoom();
    const a = fakeSink();
    const b = fakeSink();
    await room.join(claimsFor("alice", "w1", "owner"), a);
    await room.join(claimsFor("bob", "w1"), b);
    const alice = room.engine.state.players.get("alice")!;

    const pose = { x: alice.position.x, y: alice.position.y, z: alice.position.z, yaw: 0, pitch: 0 };
    await room.handleMessage("alice", { t: "cmd", seq: 1, cmd: { type: "attack" }, pose });
    (room as unknown as { tick(dt: number): void }).tick(0.05);

    const swungAtB = b
      .messagesOf("tick")
      .at(-1)
      ?.ev.find((e) => e.type === "attackSwung");
    expect(swungAtB).toBeDefined();
    expect(swungAtB?.playerId).toBe("alice");
  });

  test("a speed-hacked pose is refused and answered with forcePose; an honest one sticks", async () => {
    const { room } = await makeRoom();
    const a = fakeSink();
    await room.join(claimsFor("alice", "w1"), a);
    const alice = room.engine.state.players.get("alice")!;
    const { x, y, z } = alice.position;

    await room.handleMessage("alice", { t: "pose", seq: 1, x: x + 0.4, y, z, yaw: 0.3, pitch: 0, onGround: true, move, mineHeld: false });
    expect(alice.position.x).toBeCloseTo(x + 0.4, 6);
    expect(a.messagesOf("forcePose")).toHaveLength(0);

    await room.handleMessage("alice", { t: "pose", seq: 2, x: x + 90, y, z: z + 90, yaw: 0, pitch: 0, onGround: true, move, mineHeld: false });
    expect(alice.position.x).toBeCloseTo(x + 0.4, 6); // unmoved
    expect(a.messagesOf("forcePose")).toHaveLength(1);

    // Stale seq replay is silently dropped.
    await room.handleMessage("alice", { t: "pose", seq: 2, x: x + 1, y, z, yaw: 0, pitch: 0, onGround: true, move, mineHeld: false });
    expect(alice.position.x).toBeCloseTo(x + 0.4, 6);
  });

  test("self-deltas ship only on change; chat is rate-limited and broadcast", async () => {
    const { room } = await makeRoom();
    const a = fakeSink();
    const b = fakeSink();
    await room.join(claimsFor("alice", "w1"), a);
    await room.join(claimsFor("bob", "w1"), b);
    const roomTick = () => (room as unknown as { tick(dt: number): void }).tick(0.05);

    roomTick(); // first tick: full self snapshot
    const first = a.messagesOf("tick").at(-1);
    expect(first?.self?.hearts).toBeDefined();
    roomTick(); // nothing changed → no self at all (or an empty-free tick)
    const second = a.messagesOf("tick").at(-1);
    expect(second?.self).toBeUndefined();

    const alice = room.engine.state.players.get("alice")!;
    alice.hearts = 5;
    roomTick();
    expect(a.messagesOf("tick").at(-1)?.self?.hearts).toBe(5);

    for (let i = 0; i < 5; i += 1) await room.handleMessage("alice", { t: "chat", text: `hi ${i}` });
    const bobChats = b.messagesOf("chat");
    expect(bobChats).toHaveLength(3); // 3/s budget
    expect(bobChats[0]).toMatchObject({ from: "alice", name: "ALICE" });
  });

  test("the self-delta carries advancements and event-driven stats on change; the continuous display stats stay local", async () => {
    const { room } = await makeRoom();
    const a = fakeSink();
    await room.join(claimsFor("alice", "w1"), a);
    const roomTick = () => (room as unknown as { tick(dt: number): void }).tick(0.05);
    roomTick(); // first tick: full snapshot (baseline the shadow)

    const alice = room.engine.state.players.get("alice")!;
    alice.advancements.add("take_aim");
    alice.stats.set("hostiles_killed", 2);
    roomTick();
    const t = a.messagesOf("tick").at(-1);
    expect(t?.self?.advancements).toContain("take_aim");
    expect(t?.self?.stats?.find((s) => s.id === "hostiles_killed")?.value).toBe(2);

    // play_time accrues client-side (recordTick on the replica), so it is never
    // synced — bumping it alone produces no stats delta.
    alice.stats.set("play_time", 999);
    roomTick();
    expect(
      a
        .messagesOf("tick")
        .at(-1)
        ?.self?.stats?.some((s) => s.id === "play_time")
    ).toBeFalsy();
  });

  test("vehicle and arrow poses reach other clients; the world-sync carries them; arrows prune, parked boats deadband", async () => {
    const { room } = await makeRoom();
    const a = fakeSink();
    const b = fakeSink();
    await room.join(claimsFor("alice", "w1", "owner"), a);
    await room.join(claimsFor("bob", "w1"), b);
    const state = room.engine.state;
    restoreVehicle(state, "raft", 10, 41, 12, 1.2);
    const vehicleId = state.vehicles[0].id;
    // High and moving horizontally so the authoritative step doesn't sink it into
    // terrain before we can observe the broadcast (arrows are simulated server-side).
    state.projectiles.push({
      id: 99,
      position: new THREE.Vector3(5, 100, 5),
      velocity: new THREE.Vector3(8, 0, 0),
      yaw: 0,
      pitch: 0,
      damage: 3,
      knockback: 0,
      fromPlayer: true,
      ttl: 5
    });

    // First tick: the freshly-seeded boat (no shadow yet) and the live arrow
    // reach the already-connected client.
    const tickRoom = () => (room as unknown as { tick(dt: number): void }).tick(0.05);
    tickRoom();
    const t = b.messagesOf("tick").at(-1);
    expect(t?.vp?.some((v) => v.id === vehicleId && v.kind === "raft")).toBe(true);
    expect(t?.prj?.some((p) => p.id === 99 && p.vx === 8)).toBe(true);
    // Wire quantization holds on every pose channel (re-quantizing is a no-op).
    for (const v of t!.vp!) {
      expect(v.x).toBe(Math.round(v.x * 100) / 100);
      expect(v.yaw).toBe(Math.round(v.yaw * 1000) / 1000);
    }
    for (const p of t!.prj!) {
      expect(p.x).toBe(Math.round(p.x * 100) / 100);
      expect(p.vx).toBe(Math.round(p.vx * 100) / 100);
    }
    for (const m of t?.mp ?? []) expect(m.x).toBe(Math.round(m.x * 100) / 100);

    // A late joiner's world-sync keyframe carries both (force-emits past the deadband).
    const c = fakeSink();
    await room.join(claimsFor("carol", "w1"), c);
    const sync = await (c.frames.find((f) => f.kind === "binary") as Extract<Frame, { kind: "binary" }>).sync;
    expect(sync!.vehicles.some((v) => v.id === vehicleId && v.kind === "raft")).toBe(true);
    expect(sync!.projectiles.some((p) => p.id === 99)).toBe(true);

    // The arrow despawns: exactly one trailing empty `prj` prunes it client-side,
    // and the unmoved raft is deadbanded out (no `vp`).
    state.projectiles.length = 0;
    tickRoom();
    const t2 = b.messagesOf("tick").at(-1);
    expect(t2?.prj).toEqual([]);
    expect(t2?.vp).toBeUndefined();
    tickRoom();
    expect(b.messagesOf("tick").at(-1)?.prj).toBeUndefined(); // steady state: no arrows, no frame
  });

  test("a mounted rider's self-delta carries the server-owned position and suppresses forcePose", async () => {
    const { room } = await makeRoom();
    const a = fakeSink();
    await room.join(claimsFor("alice", "w1"), a);
    const state = room.engine.state;
    restoreVehicle(state, "raft", 10, 41, 12, 0);
    const alice = state.players.get("alice")!;
    const vehicleId = state.vehicles[0].id;
    // Seat her directly (the aim flow is covered in the engine suite): what we
    // assert here is the mount transition surfacing on the wire.
    alice.mountedVehicleId = vehicleId;
    state.vehicles[0].rider = "alice";

    (room as unknown as { tick(dt: number): void }).tick(0.05);
    const first = a.messagesOf("tick").at(-1);
    expect(first?.self?.mountedVehicleId).toBe(vehicleId);
    expect(first?.self?.x).toBeCloseTo(10, 6); // syncPlayerToVehicle put her on the raft

    // A pose while mounted is ignored (position is server-owned) and must NOT be
    // answered with forcePose — that reject means "ignore the stream", not "desync".
    a.frames.length = 0;
    await room.handleMessage("alice", { t: "pose", seq: 1, x: 999, y: 41, z: 999, yaw: 0, pitch: 0, onGround: true, move, mineHeld: false });
    expect(alice.position.x).toBeCloseTo(10, 6);
    expect(a.messagesOf("forcePose")).toHaveLength(0);
  });

  test("leave persists the player's slice; rejoin restores it; shutdown stores the merged world", async () => {
    const { room, persistence } = await makeRoom();
    const a = fakeSink();
    await room.join(claimsFor("alice", "w1"), a);
    const alice = room.engine.state.players.get("alice")!;
    alice.xp = 77;
    room.leave("alice");
    expect(room.playerCount()).toBe(0);

    const again = fakeSink();
    await room.join(claimsFor("alice", "w1"), again);
    expect(room.engine.state.players.get("alice")!.xp).toBe(77);

    await room.shutdown();
    const blob = persistence.blobs.get("w1");
    expect(blob).toBeTruthy();
    const save = await parseSaveBlob(blob!);
    expect(save?.version).toBe(17);
    expect(save?.players.find((p) => p.id === "alice")?.xp).toBe(77);
  });

  test("resync answers with a fresh world sync and re-arms the full self-delta", async () => {
    const { room } = await makeRoom();
    const a = fakeSink();
    await room.join(claimsFor("alice", "w1"), a);
    (room as unknown as { tick(dt: number): void }).tick(0.05);
    a.frames.length = 0;
    await room.handleMessage("alice", { t: "resync" });
    expect(a.frames.some((f) => f.kind === "binary")).toBe(true);
    (room as unknown as { tick(dt: number): void }).tick(0.05);
    expect(a.messagesOf("tick").at(-1)?.self?.hearts).toBeDefined();
  });
});

describe("ops surface", () => {
  const eyePose = { x: 0, y: 40, z: 0, yaw: 0, pitch: 0 };

  test("the command log records dispatched commands (with pose) and pose anchors", async () => {
    const { room } = await makeRoom();
    const a = fakeSink();
    await room.join(claimsFor("alice", "w1"), a);

    await room.handleMessage("alice", { t: "cmd", seq: 1, cmd: { type: "toggleInventory" }, pose: eyePose });
    for (let i = 0; i < 20; i += 1) (room as unknown as { tick(dt: number): void }).tick(0.05); // triggers a pose checkpoint at tick 20

    const dump = room.logDump();
    expect(dump.worldId).toBe("w1");
    expect(dump.seed).toBeGreaterThan(0);
    const commands = dump.entries.filter((e): e is Extract<typeof e, { cmd: unknown }> => "cmd" in e);
    expect(commands.some((e) => e.cmd.type === "toggleInventory")).toBe(true);
    expect(commands[0].pose).toEqual(eyePose);
    expect(dump.entries.some((e) => !("cmd" in e) && e.playerId === "alice")).toBe(true); // a pose anchor
  });

  test("the ring buffer is bounded to its configured size", async () => {
    const persistence = createMemoryPersistence();
    const record = await persistence.loadWorld("w1");
    const room = new Room(record!, persistence, () => 0, 5); // tiny log
    const a = fakeSink();
    await room.join(claimsFor("alice", "w1"), a);
    for (let i = 0; i < 30; i += 1) await room.handleMessage("alice", { t: "cmd", seq: i + 1, cmd: { type: "toggleInventory" }, pose: eyePose });
    expect(room.logDump().entries.length).toBeLessThanOrEqual(5);
  });

  test("kick ejects a live player with a fatal close and returns false for a stranger", async () => {
    const { room } = await makeRoom();
    const a = fakeSink();
    const b = fakeSink();
    await room.join(claimsFor("alice", "w1", "owner"), a);
    await room.join(claimsFor("bob", "w1"), b);

    expect(room.kick("bob")).toBe(true);
    expect(room.playerCount()).toBe(1);
    expect(b.frames.some((f) => f.kind === "close" && f.code === 4003)).toBe(true); // CLOSE_KICKED
    expect(a.messagesOf("playerLeft").some((m) => m.id === "bob")).toBe(true);
    expect(room.kick("nobody")).toBe(false);
  });

  test("a kick MESSAGE is owner-gated: the owner ejects a member, a member's kick is ignored, self-kick is a no-op", async () => {
    const { room } = await makeRoom();
    const owner = fakeSink();
    const member = fakeSink();
    const target = fakeSink();
    await room.join(claimsFor("alice", "w1", "owner"), owner);
    await room.join(claimsFor("bob", "w1", "member"), member);
    await room.join(claimsFor("carol", "w1", "member"), target);
    expect((member.messagesOf("welcome")[0] as { role: string }).role).toBe("member");

    // A member trying to kick someone is ignored (the server re-checks the ticket role).
    await room.handleMessage("bob", { t: "kick", targetId: "carol" });
    expect(room.playerCount()).toBe(3);

    // The owner can't kick themselves…
    await room.handleMessage("alice", { t: "kick", targetId: "alice" });
    expect(room.playerCount()).toBe(3);

    // …but the owner ejects carol with a fatal close.
    await room.handleMessage("alice", { t: "kick", targetId: "carol" });
    expect(room.playerCount()).toBe(2);
    expect(target.frames.some((f) => f.kind === "close" && f.code === 4003)).toBe(true); // CLOSE_KICKED
  });

  test("diagnostics report bandwidth once traffic flows", async () => {
    const { room } = await makeRoom();
    const a = fakeSink();
    await room.join(claimsFor("alice", "w1"), a);
    for (let i = 0; i < 20; i += 1) (room as unknown as { tick(dt: number): void }).tick(0.05);
    const diag = room.diagnostics();
    expect(diag.players).toBe(1);
    expect(diag.tick).toBe(20);
    expect(diag.kbOutPerSec).toBeGreaterThan(0);
    // Windowed, not lifetime: a second read with no new traffic reports ~0.
    expect(room.diagnostics().kbOutPerSec).toBe(0);
  });

  test("world-wide settings are owner-only over the wire", async () => {
    const { room } = await makeRoom();
    const owner = fakeSink();
    const member = fakeSink();
    await room.join(claimsFor("alice", "w1", "owner"), owner);
    await room.join(claimsFor("bob", "w1", "member"), member);
    const pose = { x: 0, y: 40, z: 0, yaw: 0, pitch: 0 };

    await room.handleMessage("bob", { t: "cmd", seq: 1, cmd: { type: "setDifficulty", difficulty: "peaceful" }, pose });
    expect(room.engine.state.difficulty).not.toBe("peaceful"); // member ignored

    await room.handleMessage("alice", { t: "cmd", seq: 1, cmd: { type: "setDifficulty", difficulty: "peaceful" }, pose });
    expect(room.engine.state.difficulty).toBe("peaceful"); // owner honored
  });

  test("a member can reconnect into a full room (their own slot doesn't count against capacity)", async () => {
    const { room } = await makeRoom();
    // Fill the room to capacity (ROOM_CAPACITY = 8).
    for (let i = 0; i < 8; i += 1) expect(await room.join(claimsFor(`p${i}`, "w1"), fakeSink())).toBe(true);
    expect(room.playerCount()).toBe(8);

    // A NEW 9th player is refused…
    const stranger = fakeSink();
    expect(await room.join(claimsFor("stranger", "w1"), stranger)).toBe(false);
    expect(stranger.frames.some((f) => f.kind === "close" && f.code === 4002)).toBe(true); // CLOSE_ROOM_FULL

    // …but an already-present member reconnecting is admitted (replaces their socket).
    const reconnect = fakeSink();
    expect(await room.join(claimsFor("p3", "w1"), reconnect)).toBe(true);
    expect(room.playerCount()).toBe(8);
  });

  test("a cmd-only client can't inflate the pose clamp (lastPoseTick advances on accepted cmd poses)", async () => {
    const { room } = await makeRoom();
    const a = fakeSink();
    await room.join(claimsFor("alice", "w1"), a);
    const alice = room.engine.state.players.get("alice")!;
    const { x, y, z } = alice.position;
    const tickRoom = () => (room as unknown as { tick(dt: number): void }).tick(0.05);

    // Let many ticks pass WITHOUT sending poses, sending only in-place cmds so
    // each advances lastPoseTick. Then a teleport-sized cmd pose must be rejected.
    for (let i = 0; i < 40; i += 1) {
      tickRoom();
      await room.handleMessage("alice", { t: "cmd", seq: i + 1, cmd: { type: "toggleInventory" }, pose: { x, y, z, yaw: 0, pitch: 0 } });
    }
    a.frames.length = 0;
    await room.handleMessage("alice", { t: "cmd", seq: 999, cmd: { type: "attack" }, pose: { x: x + 60, y, z: z + 60, yaw: 0, pitch: 0 } });
    expect(alice.position.x).toBeCloseTo(x, 3); // the jump was clamped, not admitted
  });
});

describe("melee lag compensation (view-stamped attacks)", () => {
  /** A stationary passive mob the AI won't move, burn, or aggro. */
  function pushSheep(room: Room, id: number, x: number, y: number, z: number): MobState {
    const sheep = {
      id,
      kind: "sheep",
      hostile: false,
      faction: FACTION_BY_KIND.sheep,
      targetId: null,
      retargetTimer: 0,
      hp: 50,
      position: new THREE.Vector3(x, y, z),
      direction: new THREE.Vector3(),
      yaw: 0,
      turnTimer: 9999,
      speed: 0,
      moveSpeed: 0,
      detectRange: 0,
      attackDamage: 0,
      attackCooldown: 1,
      attackTimer: 0,
      halfHeight: 0.9,
      bobSeed: 0,
      fedTimer: 0,
      ageTimer: 0
    } as unknown as MobState;
    room.engine.state.mobs.push(sheep);
    return sheep;
  }

  /**
   * One room per suite (worldgen is slow); each scenario below re-derives its
   * timing from the CURRENT tick count via ticksSoFar(), so they compose.
   * The aim pose targets the position history actually recorded (the engine
   * may settle a pinned mob during its step), which is what a real client's
   * interpolated view shows too.
   */
  async function setup() {
    const { room } = await makeRoom();
    const a = fakeSink();
    await room.join(claimsFor("alice", "w1", "owner"), a);
    const alice = room.engine.state.players.get("alice")!;
    room.engine.state.mobs = [];
    room.engine.state.dayClock = 60; // calm daytime — no hostile spawn noise
    const tick = () => (room as unknown as { tick(dt: number): void }).tick(0.05);
    const tickCount = () => (room as unknown as { tickCount: number }).tickCount;
    const eye = () => new THREE.Vector3(alice.position.x, alice.position.y + 1.62, alice.position.z);
    /** The cmd pose whose eye ray points from alice at `target` (lookDirection inverse). */
    const poseAiming = (target: THREE.Vector3) => {
      const dir = target.clone().sub(eye()).normalize();
      return { x: alice.position.x, y: alice.position.y, z: alice.position.z, yaw: Math.atan2(-dir.x, -dir.z), pitch: Math.asin(dir.y) };
    };
    return { room, alice, tick, tickCount, eye, poseAiming };
  }

  test("a stamped attack hits where the attacker saw the mob; an unstamped one misses live", async () => {
    const { room, tick, tickCount, eye, poseAiming } = await setup();
    const front = eye().add(new THREE.Vector3(0, 0, -2));
    const sheep = pushSheep(room, 4242, front.x, front.y, front.z);

    // Five ticks with the mob pinned in front, then it "bolts" 30 blocks away.
    for (let i = 0; i < 5; i += 1) {
      sheep.position.set(front.x, front.y, front.z);
      tick();
    }
    const seenAt = tickCount(); // the last tick recorded with the mob in front
    const seen = sheep.position.clone(); // wherever the engine settled it — what history holds
    for (let i = 0; i < 3; i += 1) {
      sheep.position.set(front.x + 30, front.y, front.z + 30);
      tick();
    }

    const pose = poseAiming(seen);
    // Unstamped: judged at the live (far) position — a whiff.
    await room.handleMessage("alice", { t: "cmd", seq: 1, cmd: { type: "attack" }, pose });
    expect(sheep.hp).toBe(50);

    // Stamped with the tick alice was rendering: judged where she SAW it.
    await room.handleMessage("alice", { t: "cmd", seq: 2, cmd: { type: "attack" }, pose, view: seenAt * 50 });
    expect(sheep.hp).toBeLessThan(50);
  });

  test("stale and future view stamps clamp to live behavior", async () => {
    const { room, tick, tickCount, eye, poseAiming } = await setup();
    const front = eye().add(new THREE.Vector3(0, 0, -2));
    const sheep = pushSheep(room, 4243, front.x, front.y, front.z);

    for (let i = 0; i < 3; i += 1) {
      sheep.position.set(front.x, front.y, front.z);
      tick();
    }
    const seenAt = tickCount();
    const seen = sheep.position.clone();
    // Far away for longer than the whole rewind window (18 ticks + slack).
    for (let i = 0; i < MELEE_REWIND_MAX_TICKS + 8; i += 1) {
      sheep.position.set(front.x + 30, front.y, front.z + 30);
      tick();
    }

    const pose = poseAiming(seen);
    // The in-front tick is beyond the clamp: floored inside the far window → miss.
    await room.handleMessage("alice", { t: "cmd", seq: 1, cmd: { type: "attack" }, pose, view: seenAt * 50 });
    expect(sheep.hp).toBe(50);
    // A future stamp clamps to the current tick → plain live selection → miss.
    await room.handleMessage("alice", { t: "cmd", seq: 2, cmd: { type: "attack" }, pose, view: (tickCount() + 100) * 50 });
    expect(sheep.hp).toBe(50);
  });

  test("a mob with no history at the viewed tick falls back to its live position", async () => {
    const { room, tick, tickCount, eye, poseAiming } = await setup();
    const viewTick = tickCount() + 2;
    for (let i = 0; i < 5; i += 1) tick(); // history exists, but without this mob…
    const front = eye().add(new THREE.Vector3(0, 0, -2));
    const sheep = pushSheep(room, 4244, front.x, front.y, front.z);
    sheep.position.set(front.x, front.y, front.z);
    tick(); // …which only enters history now
    const live = sheep.position.clone();

    // The stamp predates the mob's existence: selection falls back to live → hit.
    await room.handleMessage("alice", { t: "cmd", seq: 1, cmd: { type: "attack" }, pose: poseAiming(live), view: viewTick * 50 });
    expect(sheep.hp).toBeLessThan(50);
  });

  test("attack commands are budgeted per second; the budget refills at the boundary", async () => {
    const { room } = await makeRoom();
    const a = fakeSink();
    const b = fakeSink();
    await room.join(claimsFor("alice", "w1", "owner"), a);
    await room.join(claimsFor("bob", "w1"), b);
    const alice = room.engine.state.players.get("alice")!;
    const pose = { x: alice.position.x, y: alice.position.y, z: alice.position.z, yaw: 0, pitch: 0 };
    const tick = () => (room as unknown as { tick(dt: number): void }).tick(0.05);

    // A 20-attack burst inside one second: only 12 swings make it through.
    for (let i = 0; i < 20; i += 1) await room.handleMessage("alice", { t: "cmd", seq: i + 1, cmd: { type: "attack" }, pose });
    tick();
    const swings = b
      .messagesOf("tick")
      .at(-1)
      ?.ev.filter((e) => e.type === "attackSwung").length;
    expect(swings).toBe(12);

    // Cross a second boundary (budgets reset every 20th tick) and swing again.
    for (let i = 0; i < 20; i += 1) tick();
    await room.handleMessage("alice", { t: "cmd", seq: 99, cmd: { type: "attack" }, pose });
    tick();
    expect(
      b
        .messagesOf("tick")
        .at(-1)
        ?.ev.filter((e) => e.type === "attackSwung").length
    ).toBe(1);
  });

  test("a view stamp on a non-attack command is inert", async () => {
    const { room, alice, tick } = await setup();
    tick();
    const pose = { x: alice.position.x, y: alice.position.y, z: alice.position.z, yaw: 0, pitch: 0 };
    await room.handleMessage("alice", { t: "cmd", seq: 1, cmd: { type: "selectSlot", index: 4 }, pose, view: 50 });
    expect(alice.selectedSlot).toBe(4);
  });
});
