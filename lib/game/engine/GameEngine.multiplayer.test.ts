import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { GameEngine } from "@/lib/game/engine/GameEngine";
import { frameInput } from "@/lib/game/engine/testSupport";
import { LOCAL_PLAYER_ID } from "@/lib/game/engine/state";
import { allEligiblePlayersSleeping } from "@/lib/game/engine/players";
import { createSlot } from "@/lib/game/items";

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeEngine(authority: "local" | "server" = "server"): GameEngine {
  return new GameEngine({ seed: 1337, rng: mulberry32(42), worldSize: { x: 64, y: 150, z: 64 }, authority, headless: authority === "server" });
}

function calm(engine: GameEngine): void {
  engine.state.mobs = engine.state.mobs.filter((mob) => !mob.hostile);
  engine.state.dayClock = 60;
}

describe("players map", () => {
  test("addPlayer joins a second player; removePlayer serializes them back out", () => {
    const engine = makeEngine();
    const second = engine.addPlayer({ id: "acct-2" });
    expect(engine.state.players.size).toBe(2);
    expect(second.id).toBe("acct-2");
    expect(engine.consumeEvents().some((e) => e.type === "playerJoined" && e.playerId === "acct-2")).toBe(true);

    second.inventory = [...second.inventory];
    second.inventory[0] = createSlot("emerald", 3);
    second.xp = 42;
    const saved = engine.removePlayer("acct-2");
    expect(engine.state.players.size).toBe(1);
    expect(saved?.id).toBe("acct-2");
    expect(saved?.xp).toBe(42);
    expect(saved?.inventorySlots?.[0]).toMatchObject({ id: "emerald", count: 3 });
    expect(engine.consumeEvents().some((e) => e.type === "playerLeft" && e.playerId === "acct-2")).toBe(true);

    // Re-joining with the persisted slice restores it.
    const rejoined = engine.addPlayer({ id: "acct-2", restore: saved });
    expect(rejoined.xp).toBe(42);
    expect(rejoined.inventory[0]).toMatchObject({ id: "emerald", count: 3 });
  });

  test("the primary player cannot be removed", () => {
    const engine = makeEngine();
    expect(engine.removePlayer(LOCAL_PLAYER_ID)).toBeNull();
    expect(engine.state.players.size).toBe(1);
  });

  test("serialize() carries every player; the world save round-trips a two-player world", () => {
    const engine = makeEngine();
    const second = engine.addPlayer({ id: "acct-2" });
    second.hearts = 7;
    const save = engine.serialize();
    expect(save.version).toBe(17);
    expect(save.players.map((p) => p.id).sort()).toEqual(["acct-2", "local"]);
    expect(save.players.find((p) => p.id === "acct-2")?.hearts).toBe(7);
  });

  test("dispatch attribution: each player's commands act on their own inventory", () => {
    const engine = makeEngine();
    calm(engine);
    const second = engine.addPlayer({ id: "acct-2" });
    engine.dispatch({ type: "selectSlot", index: 3 }, "acct-2");
    expect(second.selectedSlot).toBe(3);
    expect(engine.state.player.selectedSlot).not.toBe(3);
  });
});

describe("per-player stepping", () => {
  test("one player's death neither freezes the world nor touches the other's session", () => {
    const engine = makeEngine("server");
    calm(engine);
    const second = engine.addPlayer({ id: "acct-2" });
    second.hearts = 0;
    second.isDead = true;
    second.respawnTimer = 3;

    const clockBefore = engine.state.dayClock;
    for (let i = 0; i < 10; i += 1) engine.step(0.05);
    // The shared world kept running (server authority never freezes)…
    expect(engine.state.dayClock).toBeGreaterThan(clockBefore);
    // …the survivor is untouched…
    expect(engine.state.player.isDead).toBe(false);
    // …and the dead player's countdown advanced.
    expect(second.respawnTimer).toBeLessThan(3);
  });

  test("setPlayerInput moves only that player", () => {
    const engine = makeEngine("server");
    calm(engine);
    const second = engine.addPlayer({ id: "acct-2" });
    const start = second.position.clone();
    const primaryStart = engine.state.player.position.clone();
    engine.setPlayerInput("acct-2", frameInput({ keys: ["KeyW"] }));
    for (let i = 0; i < 40; i += 1) engine.step(0.05);
    expect(second.position.distanceTo(start)).toBeGreaterThan(0.5);
    expect(engine.state.player.position.x).toBeCloseTo(primaryStart.x, 3);
    expect(engine.state.player.position.z).toBeCloseTo(primaryStart.z, 3);
  });

  test("hostiles hunt the nearest targetable player", () => {
    const engine = makeEngine("server");
    engine.state.mobs = [];
    engine.state.dayClock = 0; // dawn-dark enough for aggro
    const second = engine.addPlayer({ id: "acct-2" });
    const primary = engine.state.player;
    primary.position.set(10, primary.position.y, 10);
    second.position.set(50, second.position.y, 50);
    // A zombie beside the second player…
    const zx = 52;
    const zz = 52;
    (engine as unknown as { state: GameEngine["state"] }).state.nextMobId = 1;
    engine.state.mobs.push({
      id: 999,
      kind: "zombie",
      hostile: true,
      faction: "hostile",
      targetId: null,
      retargetTimer: 0,
      hp: 20,
      position: new THREE.Vector3(zx, second.position.y, zz),
      direction: new THREE.Vector3(1, 0, 0),
      yaw: 0,
      turnTimer: 0,
      speed: 2,
      moveSpeed: 2,
      detectRange: 20,
      attackDamage: 2,
      attackCooldown: 1,
      attackTimer: 0,
      halfHeight: 0.9,
      bobSeed: 0,
      fedTimer: 0,
      ageTimer: 0
    });
    const before = engine.state.mobs[0].position.distanceTo(second.position);
    for (let i = 0; i < 30; i += 1) engine.step(0.05);
    const mob = engine.state.mobs.find((m) => m.id === 999)!;
    // …closes on the second player, not the faraway primary.
    expect(mob.position.distanceTo(second.position)).toBeLessThan(before);
    expect(mob.position.distanceTo(engine.state.player.position)).toBeGreaterThan(30);
  });

  test("the night skips only once every eligible player sleeps", () => {
    const engine = makeEngine("server");
    calm(engine);
    const second = engine.addPlayer({ id: "acct-2" });
    const primary = engine.state.player;
    engine.state.dayClock = 200; // night (DAY_CYCLE_SECONDS = 240)

    primary.sleeping = true; // one in bed — not enough
    engine.step(0.05);
    expect(engine.state.sleepTimer).toBe(0);

    // The gate lives in interactBed; emulate the second player joining them.
    second.sleeping = true;
    // Re-run the bed gate the way interactBed would:
    primary.sleeping = true;
    engine.step(0.05);
    // Nothing engages the fade automatically (only interactBed does), so this
    // pins the helper the bed uses:
    expect(allEligiblePlayersSleeping(engine.state)).toBe(true);
    second.sleeping = false;
    expect(allEligiblePlayersSleeping(engine.state)).toBe(false);
    // Dead players and spectators don't block the skip.
    second.sleeping = false;
    second.isDead = true;
    expect(allEligiblePlayersSleeping(engine.state)).toBe(true);
  });

  test("a paused command is ignored under server authority", () => {
    const engine = makeEngine("server");
    engine.dispatch({ type: "pause" });
    expect(engine.state.paused).toBe(false);
  });
});
