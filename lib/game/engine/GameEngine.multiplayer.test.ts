import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { GameEngine } from "@/lib/game/engine/GameEngine";
import { frameInput } from "@/lib/game/engine/testSupport";
import { LOCAL_PLAYER_ID, type MobState } from "@/lib/game/engine/state";
import { allEligiblePlayersSleeping, nearestTargetablePlayer } from "@/lib/game/engine/players";
import { restoreVehicle } from "@/lib/game/engine/systems/vehicles";
import { seedRedstoneCells } from "@/lib/game/engine/systems/redstone";
import { BlockId } from "@/lib/world";
import { createEmptySlot, createSlot } from "@/lib/game/items";

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

  test("moveStack acts on the commanding player's inventory, not the primary alias", () => {
    const engine = makeEngine();
    const second = engine.addPlayer({ id: "acct-2" });
    const primary = engine.state.player;
    second.inventory = [...second.inventory];
    second.inventory[0] = createSlot("emerald", 5);
    second.inventory[1] = createEmptySlot();
    const primarySlot0 = primary.inventory[0];

    engine.dispatch({ type: "moveStack", from: 0, to: 1 }, "acct-2");
    expect(second.inventory[1]).toMatchObject({ id: "emerald", count: 5 }); // moved for acct-2
    expect(second.inventory[0]?.id).not.toBe("emerald"); // vacated
    expect(primary.inventory[0]).toBe(primarySlot0); // the primary's inventory was untouched
  });

  test("restore brings back a joined player's persisted gameMode and gameOver", () => {
    const engine = makeEngine();
    const creative = engine.addPlayer({ id: "c" });
    creative.gameMode = "creative";
    const savedCreative = engine.removePlayer("c");
    expect(engine.addPlayer({ id: "c", restore: savedCreative }).gameMode).toBe("creative");

    const dead = engine.addPlayer({ id: "d" });
    dead.gameOver = true;
    const savedDead = engine.removePlayer("d");
    const rejoinedDead = engine.addPlayer({ id: "d", restore: savedDead });
    expect(rejoinedDead.gameOver).toBe(true);
    expect(rejoinedDead.gameMode).toBe("spectator"); // a dead world spectates
  });

  test("mobs don't target a dead player over a live one", () => {
    const engine = makeEngine();
    const primary = engine.state.player;
    const second = engine.addPlayer({ id: "acct-2" });
    primary.position.set(10, 40, 10);
    second.position.set(12, 40, 12);
    primary.isDead = true; // the nearer player is a corpse
    const target = nearestTargetablePlayer(engine.state, 11, 11);
    expect(target?.id).toBe("acct-2"); // the live (farther) player is chosen
  });

  test("serialize() carries every player; the world save round-trips a two-player world", () => {
    const engine = makeEngine();
    const second = engine.addPlayer({ id: "acct-2" });
    second.hearts = 7;
    const save = engine.serialize();
    expect(save.version).toBe(18);
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

describe("per-player progression & kill credit", () => {
  function pushZombie(engine: GameEngine, x: number, z: number, hp = 20): MobState {
    const zombie: MobState = {
      id: 555,
      kind: "zombie",
      hostile: true,
      faction: "hostile",
      targetId: null,
      retargetTimer: 0,
      hp,
      position: new THREE.Vector3(x, engine.state.player.position.y, z),
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
    };
    engine.state.mobs.push(zombie);
    return zombie;
  }

  test("each player earns their OWN advancements — a second player's bow shot is theirs alone", () => {
    const engine = makeEngine("server");
    calm(engine);
    const primary = engine.state.player;
    const second = engine.addPlayer({ id: "acct-2" });
    second.inventory = [...second.inventory];
    second.inventory[0] = createSlot("bow", 1);
    second.inventory[1] = createSlot("arrow", 5);
    second.selectedSlot = 0;

    // A bow shot dispatched as acct-2 attributes to acct-2 (the acting player).
    engine.dispatch({ type: "attack" }, "acct-2");
    expect(second.stats.get("arrows_fired")).toBe(1);
    expect(second.advancements.has("take_aim")).toBe(true);
    // The primary earned nothing — no world-wide bleed.
    expect(primary.stats.get("arrows_fired") ?? 0).toBe(0);
    expect(primary.advancements.has("take_aim")).toBe(false);
  });

  test("a rewind resolver on dispatch hits a mob that live-stands out of reach (lag compensation)", () => {
    const engine = makeEngine("server");
    calm(engine);
    engine.state.mobs = [];
    const second = engine.addPlayer({ id: "acct-2" });
    second.yaw = 0;
    second.pitch = 0;
    // Live zombie 30 blocks away — an unassisted attack can't touch it.
    const zombie = pushZombie(engine, second.position.x + 30, second.position.z + 30);
    engine.dispatch({ type: "attack" }, "acct-2");
    expect(zombie.hp).toBe(20);

    // The room's resolver says acct-2 SAW it two blocks ahead (yaw 0 → -Z).
    engine.dispatch({ type: "attack" }, "acct-2", { mobPosOf: () => ({ x: second.position.x, y: second.position.y + 1.6, z: second.position.z - 2 }) });
    expect(zombie.hp).toBeLessThan(20);
    expect(zombie.lastHitByPlayer).toBe("acct-2");
  });

  test("kill credit follows the last player to hit the mob — the sweep credits them, not the primary", () => {
    const engine = makeEngine("server");
    calm(engine); // day → no hostile spawns to muddy the counts
    engine.state.mobs = [];
    const primary = engine.state.player;
    const second = engine.addPlayer({ id: "acct-2" });
    const zombie = pushZombie(engine, 30, 30, 0); // already downed…
    zombie.lastHitByPlayer = "acct-2"; // …by the second player

    engine.step(0.05); // the post-loop sweep removes it and credits the killer

    expect(engine.state.mobs.some((m) => m.id === zombie.id)).toBe(false);
    expect(second.stats.get("hostiles_killed")).toBe(1);
    expect(second.xp).toBeGreaterThan(0);
    expect(second.advancements.has("monster_hunter")).toBe(true);
    // The primary gets no credit for a kill it had no part in.
    expect(primary.stats.get("hostiles_killed") ?? 0).toBe(0);
    expect(primary.xp).toBe(0);
    expect(primary.advancements.has("monster_hunter")).toBe(false);
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

  test("under local authority, setPlayerInput moves only that player", () => {
    // Local authority integrates motion from stored intents (the SP model,
    // extended to N players); server authority never does — see below.
    const engine = makeEngine("local");
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

  test("under server authority, walking is pose-driven: clamps accept honest moves and reject teleports", () => {
    const engine = makeEngine("server");
    calm(engine);
    const second = engine.addPlayer({ id: "acct-2" });
    const { x, y, z } = second.position;

    // An honest one-tick step is accepted and applied…
    const ok = engine.applyRemotePose("acct-2", { x: x + 0.3, y, z, yaw: 1, pitch: 0, onGround: true }, 0.05);
    expect(ok.accepted).toBe(true);
    expect(second.position.x).toBeCloseTo(x + 0.3, 6);
    expect(second.yaw).toBe(1);

    // …a teleport-sized jump is rejected and NOT applied (caller force-poses)…
    const hack = engine.applyRemotePose("acct-2", { x: x + 50, y, z: z + 50, yaw: 0, pitch: 0, onGround: true }, 0.05);
    expect(hack.accepted).toBe(false);
    expect(second.position.x).toBeCloseTo(x + 0.3, 6);

    // …and intents alone never move a server-authority player.
    engine.setPlayerInput("acct-2", frameInput({ keys: ["KeyW"] }));
    const before = second.position.clone();
    for (let i = 0; i < 20; i += 1) engine.step(0.05);
    expect(second.position.x).toBeCloseTo(before.x, 6);
    expect(second.position.z).toBeCloseTo(before.z, 6);
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
    const horizontal = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
    const before = horizontal(engine.state.mobs[0].position, second.position);
    for (let i = 0; i < 30; i += 1) engine.step(0.05);
    const mob = engine.state.mobs.find((m) => m.id === 999)!;
    // …closes on the second player, not the faraway primary. (Horizontal
    // distance: the mob ground-clamps to terrain while the un-posed player
    // hangs at spawn height, so 3D distance would measure the wrong thing.)
    expect(horizontal(mob.position, second.position)).toBeLessThan(before);
    expect(horizontal(mob.position, engine.state.player.position)).toBeGreaterThan(30);
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

  test("boarding works under server authority (the v1 mounted-vehicle gate is lifted)", () => {
    const engine = makeEngine("server");
    engine.state.mobs = [];
    const player = engine.state.player;
    player.position.set(10, 40, 10);
    player.yaw = 0; // look down -z (lookDirection(0,0) = (0,0,-1))
    player.pitch = 0;
    // A raft two blocks ahead along the aim ray, within VEHICLE_BOARD_REACH.
    restoreVehicle(engine.state, "raft", 10, 41, 8, 0);
    const vehicleId = engine.state.vehicles[0].id;

    // The right-click arrives as a networked placeBlock cmd (playerId set → runs
    // the switch, exactly as the authoritative server dispatches it).
    engine.dispatch({ type: "placeBlock" }, LOCAL_PLAYER_ID);
    expect(player.mountedVehicleId).toBe(vehicleId);
    expect(engine.state.vehicles[0].rider).toBe(LOCAL_PLAYER_ID);
  });
});

describe("replica boot (bootPlayer: false, with a React shell)", () => {
  // The client replica constructs PLAYERLESS but NOT headless — the exact
  // combination NetworkSession uses. The constructor must not dereference the
  // missing primary player, and the snapshot must become real when they join.
  test("constructs with zero players and serves a real snapshot once the primary is seated", () => {
    const engine = new GameEngine({
      seed: 1337,
      rng: mulberry32(42),
      worldSize: { x: 64, y: 150, z: 64 },
      authority: "local",
      replica: true,
      bootPlayer: false
    });
    expect(engine.state.players.size).toBe(0);
    expect(engine.getSnapshot().inventory).toBeUndefined(); // stub until a primary exists

    engine.state.primaryPlayerId = "acct-1";
    engine.addPlayer({ id: "acct-1" });
    expect(engine.getSnapshot().inventory).toBeDefined();
    engine.step(0.05);
    expect(engine.getSnapshot().hearts).toBeGreaterThan(0);
  });

  test("a mounted replica stops predicting its own motion (the server-driven position wins)", () => {
    const engine = new GameEngine({
      seed: 1337,
      rng: mulberry32(42),
      worldSize: { x: 64, y: 150, z: 64 },
      authority: "local",
      replica: true,
      bootPlayer: false
    });
    engine.state.primaryPlayerId = "acct-1";
    const self = engine.addPlayer({ id: "acct-1" });
    self.position.set(20, 100, 20); // high up: unmounted, gravity alone moves it
    self.input = frameInput({ keys: ["KeyW"] });

    const start = self.position.clone();
    for (let i = 0; i < 20; i += 1) engine.step(0.05);
    expect(self.position.distanceTo(start)).toBeGreaterThan(0.5); // predicted motion

    // Mounted: the SelfDelta owns the position, so the replica must not integrate
    // motion — it stays put between server updates even with forward held.
    self.mountedVehicleId = 7;
    const mountedStart = self.position.clone();
    for (let i = 0; i < 20; i += 1) engine.step(0.05);
    expect(self.position.distanceTo(mountedStart)).toBe(0);
  });
});

describe("event attribution", () => {
  test("a server engine stamps the acting player on dispatch events", () => {
    const engine = makeEngine("server");
    calm(engine);
    engine.addPlayer({ id: "acct-2" });
    engine.consumeEvents();
    engine.dispatch({ type: "attack" }, "acct-2");
    const swung = engine.consumeEvents().find((e) => e.type === "attackSwung");
    expect(swung).toBeDefined();
    expect(swung?.playerId).toBe("acct-2");
  });

  test("explicit event playerIds win over the acting player", () => {
    const engine = makeEngine("server");
    calm(engine);
    const second = engine.addPlayer({ id: "acct-2" });
    engine.consumeEvents();
    // A bow-kill advancement unlock is tagged with its earner even if another
    // player's step happens to be running — the ?? chain keeps explicit ids.
    second.stats.set("mobs_killed_bow", 0);
    engine.dispatch({ type: "attack" }, "acct-2");
    const events = engine.consumeEvents();
    for (const e of events) if (e.type === "advancementUnlocked") expect(e.playerId).toBe("acct-2");
  });

  test("a local engine leaves events unstamped", () => {
    const engine = makeEngine("local");
    calm(engine);
    engine.dispatch({ type: "attack" });
    const swung = engine.consumeEvents().find((e) => e.type === "attackSwung");
    expect(swung).toBeDefined();
    expect(swung?.playerId).toBeUndefined();
  });
});

describe("redstone online", () => {
  test("a server engine's power pass rides the block journal like any other edit", () => {
    const engine = makeEngine("server");
    calm(engine);
    const { state } = engine;
    const ground = 30;
    state.blockChanges.set(20, ground - 1, 20, BlockId.Stone);
    state.blockChanges.set(21, ground - 1, 20, BlockId.Stone);
    state.blockChanges.set(20, ground, 20, BlockId.LeverOn);
    state.blockChanges.set(21, ground, 20, BlockId.RedstoneWire);
    seedRedstoneCells(state);
    state.blockChanges.drainEdits(); // the setup is scenery; drain it like the room does

    engine.step(0.2); // past REDSTONE_TICK_SECONDS — the pass flips the wire on
    const edits = state.blockChanges.drainEdits();
    expect(edits).toContainEqual([state.world.index(21, ground, 20), BlockId.RedstoneWireOn]);
  });

  test("a replica never simulates redstone — the server's deltas own it", () => {
    const replica = new GameEngine({ seed: 1337, rng: mulberry32(42), worldSize: { x: 64, y: 150, z: 64 }, authority: "local", replica: true });
    const { state } = replica;
    const ground = 30;
    state.blockChanges.set(20, ground - 1, 20, BlockId.Stone);
    state.blockChanges.set(21, ground - 1, 20, BlockId.Stone);
    state.blockChanges.set(20, ground, 20, BlockId.LeverOn);
    state.blockChanges.set(21, ground, 20, BlockId.RedstoneWire);
    seedRedstoneCells(state);
    state.blockChanges.drainEditsDetailed();

    for (let t = 0; t < 1; t += 0.05) replica.step(0.05, frameInput());
    expect(state.world.get(21, ground, 20)).toBe(BlockId.RedstoneWire); // untouched
    expect(state.blockChanges.drainEditsDetailed()).toHaveLength(0);
  });
});

describe("predictive mining (replica step)", () => {
  function makeReplica(): GameEngine {
    return new GameEngine({ seed: 1337, rng: mulberry32(42), worldSize: { x: 64, y: 150, z: 64 }, authority: "local", replica: true });
  }

  /** Pin `block` underfoot, center + aim the player straight down at it. */
  function aimUnderfoot(engine: GameEngine, block: BlockId): { px: number; py: number; pz: number } {
    const { state } = engine;
    const px = Math.floor(state.player.position.x);
    const py = Math.floor(state.player.position.y) - 1;
    const pz = Math.floor(state.player.position.z);
    state.blockChanges.set(px, py, pz, block);
    state.blockChanges.drainEditsDetailed(); // the pin is scenery, not a prediction
    state.player.position.x = px + 0.5;
    state.player.position.z = pz + 0.5;
    state.player.pitch = -Math.PI / 2 + 0.02;
    return { px, py, pz };
  }

  const mine = (engine: GameEngine, seconds: number) => {
    const held = frameInput({ mineHeld: true });
    for (let t = 0; t < seconds; t += 0.05) engine.step(0.05, held);
  };

  /** Hold the mouse just until the pinned cell breaks — one more frame and the ray cascades into the terrain below. */
  const mineUntilBroken = (engine: GameEngine, px: number, py: number, pz: number) => {
    const held = frameInput({ mineHeld: true });
    for (let t = 0; t < 8 && engine.state.world.get(px, py, pz) !== BlockId.Air; t += 0.05) engine.step(0.05, held);
  };

  test("the break commits at full crack — block + event, but no drops, XP, or tool wear", () => {
    const engine = makeReplica();
    const { state } = engine;
    const { px, py, pz } = aimUnderfoot(engine, BlockId.Dirt);
    const invBefore = state.player.inventory;
    const xpBefore = state.player.xp;
    engine.consumeEvents();

    mineUntilBroken(engine, px, py, pz);

    expect(state.world.get(px, py, pz)).toBe(BlockId.Air);
    expect(engine.consumeEvents().some((e) => e.type === "blockBroken")).toBe(true);
    expect(state.player.inventory).toBe(invBefore); // no drop, no durability write
    expect(state.player.xp).toBe(xpBefore);
    const edits = state.blockChanges.drainEditsDetailed();
    expect(edits).toEqual([{ idx: state.world.index(px, py, pz), block: BlockId.Air, prev: BlockId.Dirt }]);
  });

  test("chests hold at the final crack stage and wait for the server", () => {
    const engine = makeReplica();
    const { state } = engine;
    const { px, py, pz } = aimUnderfoot(engine, BlockId.Chest);

    mine(engine, 8);

    expect(state.world.get(px, py, pz)).toBe(BlockId.Chest);
    expect(state.player.mining.progress).toBeGreaterThan(0);
    expect(state.blockChanges.drainEditsDetailed()).toEqual([]);
  });
});
