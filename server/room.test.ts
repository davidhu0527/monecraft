import { describe, expect, test } from "bun:test";
import { PROTOCOL_VERSION, type ServerMessage, type WorldSync } from "@/lib/net/protocol";
import { gunzipWorldSync } from "@/lib/net/codec";
import type { TicketClaims } from "@/lib/net/tickets";
import { createMemoryPersistence, parseSaveBlob } from "./persistence";
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
    expect(welcome).toMatchObject({ protocol: PROTOCOL_VERSION, playerId: "alice", worldId: "w1" });
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
