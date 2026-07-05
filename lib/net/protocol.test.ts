import { describe, expect, test } from "bun:test";
import { decodeClientFrame, gunzipWorldSync, gzipWorldSync } from "./codec";
import { createClockSync } from "./clock";
import { readClientMessage, readCommand, type WorldSync } from "./protocol";

describe("client message validation", () => {
  const move = { forward: true, back: false, left: false, right: false, jump: false, sprint: false, crouch: false };

  test("round-trips well-formed frames", () => {
    expect(readClientMessage({ t: "hello", ticket: "abc", protocol: 1 })).toMatchObject({ t: "hello", ticket: "abc" });
    expect(readClientMessage({ t: "pose", seq: 1, x: 1, y: 2, z: 3, yaw: 0.5, pitch: -0.2, onGround: true, move, mineHeld: false })).toMatchObject({
      t: "pose",
      x: 1,
      move: { forward: true }
    });
    expect(readClientMessage({ t: "cmd", seq: 2, cmd: { type: "attack" }, pose: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 } })).toMatchObject({
      t: "cmd",
      cmd: { type: "attack" }
    });
    expect(readClientMessage({ t: "chat", text: "hi" })).toMatchObject({ t: "chat", text: "hi" });
    expect(readClientMessage({ t: "ping", id: 1, tMs: 123 })).toMatchObject({ t: "ping" });
    expect(readClientMessage({ t: "resync" })).toMatchObject({ t: "resync" });
    expect(readClientMessage({ t: "kick", targetId: "acct-2" })).toMatchObject({ t: "kick", targetId: "acct-2" });
    expect(readClientMessage({ t: "kick" })).toBeNull(); // missing targetId
    expect(readClientMessage({ t: "kick", targetId: 5 })).toBeNull(); // non-string targetId
  });

  test("rejects garbage totally (no exceptions, just null)", () => {
    for (const garbage of [
      null,
      42,
      "hello",
      {},
      { t: "nope" },
      { t: "pose", seq: 1, x: Number.NaN, y: 0, z: 0, yaw: 0, pitch: 0, onGround: true, move, mineHeld: false },
      { t: "pose", seq: 1, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, onGround: "yes", move, mineHeld: false },
      { t: "pose", seq: 1, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, onGround: true, move: { forward: 1 }, mineHeld: false },
      { t: "cmd", seq: 1, cmd: { type: "hackTheGibson" }, pose: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 } },
      { t: "cmd", seq: 1, cmd: { type: "attack" }, pose: { x: "here", y: 0, z: 0, yaw: 0, pitch: 0 } },
      { t: "chat", text: "   " },
      { t: "ping", id: "one", tMs: 2 }
    ]) {
      expect(readClientMessage(garbage)).toBeNull();
    }
  });

  test("chat is clipped to 256 chars", () => {
    const long = readClientMessage({ t: "chat", text: "x".repeat(999) });
    expect(long && long.t === "chat" ? long.text.length : 0).toBe(256);
  });

  test("the command allow-list drops local-presentation and malformed commands", () => {
    expect(readCommand({ type: "pause" })).toBeNull(); // never on the wire
    expect(readCommand({ type: "toggleDebug" })).toBeNull();
    expect(readCommand({ type: "toggleCameraView" })).toBeNull();
    expect(readCommand({ type: "selectSlot", index: "3" })).toBeNull();
    expect(readCommand({ type: "craft", recipeId: { evil: true } })).toBeNull();
    expect(readCommand({ type: "anvilRename", name: "y".repeat(200) })).toMatchObject({ type: "anvilRename", name: "y".repeat(64) });
    expect(readCommand({ type: "selectSlot", index: 3.7 })).toMatchObject({ type: "selectSlot", index: 3 });
    // enchant ids are allow-listed: an unknown one would throw in canEnchant.
    expect(readCommand({ type: "enchant", enchant: "sharpness" })).toMatchObject({ type: "enchant", enchant: "sharpness" });
    expect(readCommand({ type: "enchant", enchant: "not_a_real_enchant" })).toBeNull();
    expect(readCommand({ type: "enchant", enchant: "__proto__" })).toBeNull();
  });

  test("decodeClientFrame handles non-JSON and binary", () => {
    expect(decodeClientFrame("not json{")).toBeNull();
    expect(decodeClientFrame(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(decodeClientFrame(JSON.stringify({ t: "resync" }))).toMatchObject({ t: "resync" });
  });
});

describe("world-sync codec", () => {
  test("gzip round-trips and compresses the block diff", async () => {
    const sync: WorldSync = {
      t: "worldSync",
      tick: 7,
      dayClock: 42,
      changes: Array.from({ length: 5000 }, (_, i) => [i * 3, i % 7] as [number, number]),
      blockEntities: [],
      lootedChests: [1, 2, 3],
      mobs: [],
      liveMobs: [{ id: 1, kind: "zombie", hostile: true, x: 1, y: 2, z: 3, yaw: 0, hp: 20, moveSpeed: 2 }],
      vehicles: [{ id: 5, kind: "raft", x: 4, y: 5, z: 6, yaw: 1, riderId: null }],
      projectiles: [{ id: 2, x: 7, y: 8, z: 9, vx: 1, vy: -1, vz: 0 }],
      players: [{ id: "p1", name: "P", skinId: null, x: 0, y: 64, z: 0, yaw: 0 }]
    };
    const bytes = await gzipWorldSync(sync);
    expect(bytes.byteLength).toBeLessThan(JSON.stringify(sync).length / 2);
    expect(await gunzipWorldSync(bytes)).toEqual(sync);
  });

  test("gunzip is total on garbage", async () => {
    expect(await gunzipWorldSync(new Uint8Array([9, 9, 9]))).toBeNull();
  });
});

describe("clock sync", () => {
  test("estimates the server timeline through jittery pongs", () => {
    const clock = createClockSync();
    expect(clock.ready()).toBe(false);
    // Server is at tick 1000 (= 50_000ms on the tick clock); RTT ~80ms.
    clock.onPong(1000, 1080, 1000);
    expect(clock.ready()).toBe(true);
    expect(clock.rttMs()).toBeCloseTo(80, 5);
    // At local 1080: serverTime ≈ 50_000 + 40 (half RTT since the pong left).
    expect(clock.estimatedServerTimeMs(1080)).toBeCloseTo(50_040, 5);
    // Jittery follow-ups move the estimate smoothly, not wildly.
    clock.onPong(2000, 2200, 1024);
    const drifted = clock.estimatedServerTimeMs(2200);
    expect(Math.abs(drifted - 51_240)).toBeLessThan(300);
  });
});
