import { describe, expect, test } from "bun:test";
import { connectNetworkSession, type JoinGrant, type NetworkSession } from "./NetworkSession";
import { BlockId } from "@/lib/world";
import { createSlot } from "@/lib/game/items";
import { frameInput } from "@/lib/game/engine/testSupport";
import { gzipWorldSync } from "./codec";
import type { SelfDelta, WelcomeMessage, WorldSync } from "./protocol";

/**
 * The client session end-to-end against a scriptable fake socket: the
 * handshake, command routing (local vs networked), self-delta application,
 * chat, the simulated-latency knob, and — the Phase 6 headline — the
 * reconnect ladder resuming the SAME replica after a non-fatal drop. Driving
 * a real browser socket-kill would be flaky; a fake makes every edge
 * deterministic (the server half is covered by server/room.test.ts).
 */

/** A tiny replica world keeps each test's worldgen fast (the real footprint is 512²). */
const SMALL = { x: 32, y: 64, z: 32 };

const WELCOME: WelcomeMessage = {
  t: "welcome",
  protocol: 1,
  playerId: "acct-1",
  worldId: "w1",
  seed: 1337,
  // Superflat keeps each test's replica worldgen cheap (no noise/caves) at the
  // real 512² footprint — the routing/reconnect logic under test is size-blind.
  worldType: "flat",
  difficulty: "normal",
  hardcore: false,
  dayClock: 60,
  tick: 100,
  role: "owner",
  players: [{ id: "acct-1", name: "Alpha", skinId: null, x: 5, y: 40, z: 5, yaw: 0 }]
};

function worldSync(players: WorldSync["players"], overrides: Partial<WorldSync> = {}): WorldSync {
  return {
    t: "worldSync",
    tick: 100,
    dayClock: 60,
    changes: [],
    blockEntities: [],
    lootedChests: [],
    mobs: [],
    liveMobs: [],
    vehicles: [],
    projectiles: [],
    players,
    ...overrides
  };
}

/** A minimal scriptable WebSocket: auto-answers the hello with a welcome, records sends, lets the test emit frames. */
class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  binaryType = "blob";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: string[] = [];

  constructor(
    public url: string,
    private readonly welcome: WelcomeMessage
  ) {
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  send(data: string): void {
    this.sent.push(data);
    const message = JSON.parse(data) as { t: string };
    if (message.t === "hello") this.onmessage?.({ data: JSON.stringify(this.welcome) });
  }

  emit(data: unknown): void {
    this.onmessage?.({ data });
  }

  emitClose(code: number, reason = ""): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  close(code = 1000, reason = ""): void {
    this.emitClose(code, reason);
  }

  sentTypes(): string[] {
    return this.sent.map((s) => (JSON.parse(s) as { t: string }).t);
  }
}

function socketFactory(welcome: WelcomeMessage = WELCOME) {
  const instances: FakeSocket[] = [];
  const make = (url: string) => {
    const socket = new FakeSocket(url, welcome);
    instances.push(socket);
    return socket as unknown as WebSocket;
  };
  return { make, instances };
}

async function pushWorldSync(socket: FakeSocket, sync: WorldSync): Promise<void> {
  const gz = await gzipWorldSync(sync);
  socket.emit(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength));
  await Promise.resolve(); // let the async gunzip settle
  await Promise.resolve();
}

const tick = (self?: SelfDelta, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ t: "tick", n: 101, ev: [], pp: [], mp: [], ...extra, ...(self ? { self } : {}) });

describe("connectNetworkSession", () => {
  test("handshakes, syncs, and mounts a replica engine seeded from the welcome", async () => {
    const { make, instances } = socketFactory();
    const session = await connectNetworkSession("ws://game", "ticket-1", {}, { makeSocket: make, worldSize: SMALL });

    expect(session.playerId).toBe("acct-1");
    expect(instances[0].sentTypes()[0]).toBe("hello");
    expect(session.status()).toBe("syncing");

    await pushWorldSync(instances[0], worldSync(WELCOME.players));
    expect(session.status()).toBe("online");
    expect(session.engine.state.world.seed).toBe(1337);
    session.dispose();
  });

  test("routes gameplay commands to the wire but keeps presentation on the replica", async () => {
    const { make, instances } = socketFactory();
    const session = await connectNetworkSession("ws://game", "ticket-1", {}, { makeSocket: make, worldSize: SMALL });
    await pushWorldSync(instances[0], worldSync(WELCOME.players));

    session.dispatch({ type: "placeBlock" });
    expect(instances[0].sentTypes()).toContain("cmd");

    // toggleInventory is local: it never hits the wire, only the replica.
    const before = instances[0].sent.length;
    session.dispatch({ type: "toggleInventory" });
    expect(instances[0].sent.length).toBe(before);
    expect(session.engine.state.player.inventoryOpen).toBe(true);
    session.dispose();
  });

  test("applies self-deltas onto the local player and delivers chat", async () => {
    const { make, instances } = socketFactory();
    const chats: string[] = [];
    const session = await connectNetworkSession("ws://game", "ticket-1", {}, { makeSocket: make, worldSize: SMALL });
    session.subscribeChat((entry) => chats.push(`${entry.name}:${entry.text}`));
    await pushWorldSync(instances[0], worldSync(WELCOME.players));

    instances[0].emit(tick({ hearts: 7, xp: 42 }));
    expect(session.engine.state.player.hearts).toBe(7);
    expect(session.engine.state.player.xp).toBe(42);

    instances[0].emit(JSON.stringify({ t: "chat", from: "acct-2", name: "Beta", text: "hi" }));
    expect(chats).toEqual(["Beta:hi"]);
    session.dispose();
  });

  test("applies advancement and stat deltas onto the local player", async () => {
    const { make, instances } = socketFactory();
    const session = await connectNetworkSession("ws://game", "ticket-1", {}, { makeSocket: make, worldSize: SMALL });
    await pushWorldSync(instances[0], worldSync(WELCOME.players));

    instances[0].emit(tick({ advancements: ["take_aim", "monster_hunter"], stats: [{ id: "hostiles_killed", value: 3 }] }));
    expect([...session.engine.state.player.advancements].sort()).toEqual(["monster_hunter", "take_aim"]);
    expect(session.engine.state.player.stats.get("hostiles_killed")).toBe(3);
    session.dispose();
  });

  test("tracks the roster, fires its subscription on join/leave, and sends owner kicks", async () => {
    const { make, instances } = socketFactory();
    const session = await connectNetworkSession("ws://game", "ticket-1", {}, { makeSocket: make, worldSize: SMALL });
    await pushWorldSync(instances[0], worldSync(WELCOME.players));

    expect(session.role).toBe("owner"); // from the welcome
    let notifications = 0;
    const unsubscribe = session.subscribeRoster(() => {
      notifications += 1;
    });

    // A second player joins → the roster grows and the subscription fires.
    instances[0].emit(JSON.stringify({ t: "playerJoined", player: { id: "acct-2", name: "Beta", skinId: null, x: 0, y: 40, z: 0, yaw: 0 } }));
    expect(
      session
        .roster()
        .map((m) => m.id)
        .sort()
    ).toEqual(["acct-1", "acct-2"]);
    expect(notifications).toBeGreaterThan(0);

    // The owner kicks them — a kick frame goes on the wire (self-kick is dropped client-side).
    session.kick("acct-1");
    expect(instances[0].sentTypes()).not.toContain("kick");
    session.kick("acct-2");
    expect(instances[0].sentTypes()).toContain("kick");

    // They leave → the roster shrinks and the subscription fires again.
    const before = notifications;
    instances[0].emit(JSON.stringify({ t: "playerLeft", id: "acct-2" }));
    expect(session.roster().map((m) => m.id)).toEqual(["acct-1"]);
    expect(notifications).toBeGreaterThan(before);

    unsubscribe();
    session.dispose();
  });

  test("restores vehicles and arrows from the world-sync keyframe", async () => {
    const { make, instances } = socketFactory();
    const session = await connectNetworkSession("ws://game", "ticket-1", {}, { makeSocket: make, worldSize: SMALL });
    await pushWorldSync(
      instances[0],
      worldSync(WELCOME.players, {
        vehicles: [{ id: 7, kind: "raft", x: 10, y: 41, z: 12, yaw: 1.5, riderId: null }],
        projectiles: [{ id: 3, x: 1, y: 42, z: 2, vx: 8, vy: 0, vz: 0 }]
      })
    );

    const vehicle = session.engine.state.vehicles.find((v) => v.id === 7);
    expect(vehicle).toBeDefined();
    expect(vehicle?.kind).toBe("raft");
    expect(vehicle?.position.x).toBe(10);
    expect(session.engine.state.projectiles.find((p) => p.id === 3)?.velocity.x).toBe(8);
    session.dispose();
  });

  test("upserts vehicle/arrow poses from ticks and prunes arrows by absence", async () => {
    const { make, instances } = socketFactory();
    const session = await connectNetworkSession("ws://game", "ticket-1", {}, { makeSocket: make, worldSize: SMALL });
    await pushWorldSync(instances[0], worldSync(WELCOME.players));

    // A boat appears and an arrow flies.
    instances[0].emit(
      tick(undefined, {
        vp: [{ id: 7, kind: "ship", x: 20, y: 41, z: 20, yaw: 0, riderId: "acct-2" }],
        prj: [{ id: 3, x: 1, y: 42, z: 2, vx: 8, vy: 0, vz: 0 }]
      })
    );
    expect(session.engine.state.vehicles.find((v) => v.id === 7)?.rider).toBe("acct-2");
    expect(session.engine.state.projectiles).toHaveLength(1);

    // The boat moves; the arrow is gone (empty list prunes it), boat persists.
    instances[0].emit(tick(undefined, { vp: [{ id: 7, kind: "ship", x: 21, y: 41, z: 20, yaw: 0.1, riderId: "acct-2" }], prj: [] }));
    expect(session.engine.state.vehicles.find((v) => v.id === 7)?.position.x).toBe(21);
    expect(session.engine.state.projectiles).toHaveLength(0);
    session.dispose();
  });

  test("a mounted self-delta snaps position and stops the replica predicting local motion", async () => {
    const { make, instances } = socketFactory();
    const session = await connectNetworkSession("ws://game", "ticket-1", {}, { makeSocket: make, worldSize: SMALL });
    await pushWorldSync(instances[0], worldSync(WELCOME.players));
    const self = session.engine.state.player;

    instances[0].emit(tick({ mountedVehicleId: 7, x: 30, y: 41, z: 30 }));
    expect(self.mountedVehicleId).toBe(7);
    expect(self.position.x).toBe(30);

    // Even fed forward-walk input, a mounted replica does not integrate motion —
    // the server-driven position stands until the next self-delta.
    self.input = { move: { forward: true, back: false, left: false, right: false, jump: false, sprint: false, crouch: false }, mineHeld: false };
    session.engine.step(0.05);
    expect(self.position.x).toBe(30);
    expect(self.position.z).toBe(30);

    // Dismount: the server clears the mount and hands back a ground position.
    instances[0].emit(tick({ mountedVehicleId: null, x: 31, y: 40, z: 31 }));
    expect(self.mountedVehicleId).toBeNull();
    expect(self.position.x).toBe(31);
    session.dispose();
  });

  test("the simulated-latency knob defers sends", async () => {
    const { make, instances } = socketFactory();
    const session = await connectNetworkSession("ws://game", "ticket-1", {}, { makeSocket: make, worldSize: SMALL });
    await pushWorldSync(instances[0], worldSync(WELCOME.players));

    session.setSimulatedLatency(40);
    expect(session.simulatedLatency()).toBe(40);
    const before = instances[0].sent.length;
    session.sendChat("delayed");
    expect(instances[0].sent.length).toBe(before); // not yet — held by the latency timer
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(instances[0].sentTypes()).toContain("chat");
    session.dispose();
  });

  test("jittered simulated latency never reorders sends (FIFO cursor)", async () => {
    const { make, instances } = socketFactory();
    const session = await connectNetworkSession("ws://game", "ticket-1", {}, { makeSocket: make, worldSize: SMALL });
    await pushWorldSync(instances[0], worldSync(WELCOME.players));

    // Jitter larger than the base delay: naive per-message timers would swap
    // neighbors constantly; the monotonic delivery cursor must not.
    session.setSimulatedLatency(10, 30);
    expect(session.simulatedJitter()).toBe(30);
    const before = instances[0].sent.length;
    for (let i = 0; i < 20; i += 1) session.sendChat(`m${i}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const chats = instances[0].sent
      .slice(before)
      .map((s) => JSON.parse(s) as { t: string; text?: string })
      .filter((m) => m.t === "chat")
      .map((m) => m.text);
    expect(chats).toEqual(Array.from({ length: 20 }, (_, i) => `m${i}`));
    session.dispose();
  });

  test("netStats reports traffic over the rolling window", async () => {
    const { make, instances } = socketFactory();
    const session = await connectNetworkSession("ws://game", "ticket-1", {}, { makeSocket: make, worldSize: SMALL });
    await pushWorldSync(instances[0], worldSync(WELCOME.players));

    expect(session.netStats().pendingPredictions).toBe(0);
    session.sendChat("count me");
    instances[0].emit(tick());
    // Two afterFrames: one opens the window, the second (past 2 s) rolls it.
    session.afterFrame(1000);
    session.afterFrame(4000);
    const stats = session.netStats();
    expect(stats.outKBps).toBeGreaterThan(0);
    expect(stats.inKBps).toBeGreaterThan(0);
    session.dispose();
  });

  test("a non-fatal drop runs the reconnect ladder and resumes the same replica", async () => {
    const { make, instances } = socketFactory();
    let ticketsMinted = 0;
    const reconnect = async (): Promise<JoinGrant | null> => {
      ticketsMinted += 1;
      return { url: "ws://game", ticket: `ticket-${ticketsMinted + 1}` };
    };
    const session = await connectNetworkSession("ws://game", "ticket-1", {}, { makeSocket: make, reconnect, worldSize: SMALL });
    await pushWorldSync(instances[0], worldSync(WELCOME.players));
    const engineBefore = session.engine;

    // A non-fatal close (idle timeout 4004) drops us into the ladder.
    instances[0].emitClose(4004, "idle");
    expect(session.status()).toBe("reconnecting");

    // First rung fires at ~1s: a fresh ticket, a new socket, a fresh handshake.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(ticketsMinted).toBe(1);
    expect(instances.length).toBe(2);
    expect(session.status()).toBe("syncing"); // welcome back, awaiting world-sync

    await pushWorldSync(instances[1], worldSync(WELCOME.players));
    expect(session.status()).toBe("online");
    expect(session.engine).toBe(engineBefore); // SAME replica, not a fresh one
    session.dispose();
  }, 10000);

  test("a fatal drop (bad ticket) closes without retrying", async () => {
    const { make, instances } = socketFactory();
    let reconnects = 0;
    const session = await connectNetworkSession(
      "ws://game",
      "ticket-1",
      {},
      {
        makeSocket: make,
        worldSize: SMALL,
        reconnect: async () => {
          reconnects += 1;
          return null;
        }
      }
    );
    await pushWorldSync(instances[0], worldSync(WELCOME.players));

    instances[0].emitClose(4000, "invalid ticket"); // CLOSE_BAD_TICKET
    expect(session.status()).toBe("closed");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(reconnects).toBe(0);
    session.dispose();
  });
});

/**
 * Optimistic placement scene: the local player stands on flat ground at
 * (5.5, g+1, 5.5) aiming down-forward (+x), dirt in hand — the ray hits the
 * ground top two cells ahead, so a predicted place lands at (6, g+1, 5).
 */
async function placeScene() {
  const { make, instances } = socketFactory();
  const session = await connectNetworkSession("ws://game", "ticket-1", {}, { makeSocket: make, worldSize: SMALL });
  await pushWorldSync(instances[0], worldSync(WELCOME.players));
  const state = session.engine.state;
  const self = state.players.get("acct-1")!;
  const g = state.world.highestSolidY(6, 5);
  self.position.set(5.5, g + 1, 5.5);
  self.yaw = -Math.PI / 2;
  self.pitch = -0.9;
  self.inventory = [...self.inventory];
  self.inventory[0] = createSlot("dirt", 5);
  self.selectedSlot = 0;
  const idx = state.world.index(6, g + 1, 5);
  return { session, instances, state, self, g, idx };
}

const dirtCount = (session: NetworkSession) => session.engine.state.players.get("acct-1")!.inventory[0]?.count;

describe("optimistic block placement", () => {
  test("a predicted place lands instantly: world block, stack take, local event, cmd on the wire", async () => {
    const { session, instances, state, g, idx } = await placeScene();
    session.dispatch({ type: "placeBlock" });

    expect(state.world.get(6, g + 1, 5)).toBe(BlockId.Dirt);
    expect(dirtCount(session)).toBe(4);
    expect(session.netStats().pendingPredictions).toBe(1);
    expect(session.engine.consumeEvents().some((e) => e.type === "blockPlaced")).toBe(true);
    expect(instances[0].sentTypes()).toContain("cmd");
    expect(idx).toBe(state.world.index(6, g + 1, 5));
    session.dispose();
  });

  test("a matching journal confirms without flicker and the own echo is suppressed", async () => {
    const { session, instances, state, g, idx } = await placeScene();
    session.dispatch({ type: "placeBlock" });
    session.drainEvents(); // clear anything pre-echo

    instances[0].emit(
      tick(undefined, {
        blocks: [[idx, BlockId.Dirt]],
        ev: [{ type: "blockPlaced", blockId: BlockId.Dirt, x: 6, y: g + 1, z: 5, playerId: "acct-1" }]
      })
    );

    expect(state.world.get(6, g + 1, 5)).toBe(BlockId.Dirt);
    expect(session.netStats().pendingPredictions).toBe(0);
    expect(session.drainEvents().some((e) => e.type === "blockPlaced")).toBe(false); // echo swallowed
    expect(dirtCount(session)).toBe(4); // no spurious refund
    session.dispose();
  });

  test("another player's edit at an unpredicted cell flows through untouched", async () => {
    const { session, instances, state, g } = await placeScene();
    const otherIdx = state.world.index(9, g + 1, 5);
    instances[0].emit(
      tick(undefined, {
        blocks: [[otherIdx, BlockId.Stone]],
        ev: [{ type: "blockPlaced", blockId: BlockId.Stone, x: 9, y: g + 1, z: 5, playerId: "acct-2" }]
      })
    );
    expect(state.world.get(9, g + 1, 5)).toBe(BlockId.Stone);
    expect(session.drainEvents().some((e) => e.type === "blockPlaced")).toBe(true);
    session.dispose();
  });

  test("a lost race reverts to the server's block and refunds the stack", async () => {
    const { session, instances, state, g, idx } = await placeScene();
    session.dispatch({ type: "placeBlock" });
    expect(dirtCount(session)).toBe(4);

    instances[0].emit(tick(undefined, { blocks: [[idx, BlockId.Stone]] }));
    expect(state.world.get(6, g + 1, 5)).toBe(BlockId.Stone); // server won
    expect(dirtCount(session)).toBe(5); // stack handed back
    expect(session.netStats().pendingPredictions).toBe(0);
    session.dispose();
  });

  test("an unanswered prediction times out: block reverts (with relight path) and the item returns", async () => {
    const { session, state, g } = await placeScene();
    session.dispatch({ type: "placeBlock" });
    expect(state.world.get(6, g + 1, 5)).toBe(BlockId.Dirt);

    await new Promise((resolve) => setTimeout(resolve, 1250)); // > the 1000 ms floor at rtt 0
    session.afterFrame(performance.now());

    expect(state.world.get(6, g + 1, 5)).toBe(BlockId.Air);
    expect(dirtCount(session)).toBe(5);
    expect(session.netStats().pendingPredictions).toBe(0);
    session.dispose();
  }, 10_000);

  test("a world-sync clears pending predictions", async () => {
    const { session, instances } = await placeScene();
    session.dispatch({ type: "placeBlock" });
    expect(session.netStats().pendingPredictions).toBe(1);
    await pushWorldSync(instances[0], worldSync(WELCOME.players));
    expect(session.netStats().pendingPredictions).toBe(0);
    session.dispose();
  });

  test("no prediction without a placeable block in hand (the cmd still travels)", async () => {
    const { session, instances, self } = await placeScene();
    self.inventory = [...self.inventory];
    self.inventory[0] = createSlot("wheat_seeds", 3); // item-driven branch: server decides
    const cmdsBefore = instances[0].sentTypes().filter((t) => t === "cmd").length;
    session.dispatch({ type: "placeBlock" });
    expect(session.netStats().pendingPredictions).toBe(0);
    expect(instances[0].sentTypes().filter((t) => t === "cmd").length).toBe(cmdsBefore + 1);
    session.dispose();
  });
});

describe("predictive block breaking + instant swing", () => {
  /** Pin dirt underfoot, aim straight down, and hold the mouse until the replica commits the break. */
  async function breakScene() {
    const { make, instances } = socketFactory();
    const session = await connectNetworkSession("ws://game", "ticket-1", {}, { makeSocket: make, worldSize: SMALL });
    await pushWorldSync(instances[0], worldSync(WELCOME.players));
    const state = session.engine.state;
    const self = state.players.get("acct-1")!;
    const g = state.world.highestSolidY(5, 5);
    state.blockChanges.set(5, g, 5, BlockId.Dirt);
    state.blockChanges.drainEditsDetailed(); // the pin is scenery, not a prediction
    self.position.set(5.5, g + 1, 5.5);
    self.pitch = -Math.PI / 2 + 0.02;
    const held = frameInput({ mineHeld: true });
    for (let t = 0; t < 8 && state.world.get(5, g, 5) !== BlockId.Air; t += 0.05) session.engine.step(0.05, held);
    const idx = state.world.index(5, g, 5);
    return { session, instances, state, g, idx };
  }

  test("a mined block vanishes at crack completion and the ledger tracks it through confirmation", async () => {
    const { session, instances, state, g, idx } = await breakScene();
    expect(state.world.get(5, g, 5)).toBe(BlockId.Air); // committed by the replica step

    session.afterFrame(performance.now()); // capture into the ledger
    expect(session.netStats().pendingPredictions).toBe(1);

    session.drainEvents();
    instances[0].emit(
      tick(undefined, {
        blocks: [[idx, BlockId.Air]],
        ev: [{ type: "blockBroken", blockId: BlockId.Dirt, x: 5, y: g, z: 5, playerId: "acct-1" }]
      })
    );
    expect(state.world.get(5, g, 5)).toBe(BlockId.Air);
    expect(session.netStats().pendingPredictions).toBe(0);
    expect(session.drainEvents().some((e) => e.type === "blockBroken")).toBe(false); // echo swallowed
    session.dispose();
  });

  test("a break committed while disconnected reverts immediately (the server never heard the mining)", async () => {
    const { session, instances, state, g } = await breakScene();
    expect(state.world.get(5, g, 5)).toBe(BlockId.Air);

    instances[0].emitClose(4000, "bad ticket"); // fatal: no reconnect, socket gone
    session.afterFrame(performance.now());

    expect(state.world.get(5, g, 5)).toBe(BlockId.Dirt); // undone on the spot
    expect(session.netStats().pendingPredictions).toBe(0);
    session.dispose();
  });

  test("attack swings locally at click time and its echo is suppressed; other players' swings pass", async () => {
    const { make, instances } = socketFactory();
    const session = await connectNetworkSession("ws://game", "ticket-1", {}, { makeSocket: make, worldSize: SMALL });
    await pushWorldSync(instances[0], worldSync(WELCOME.players));

    session.dispatch({ type: "attack" });
    expect(instances[0].sentTypes()).toContain("cmd");
    expect(session.drainEvents().some((e) => e.type === "attackSwung")).toBe(true); // synthetic, instant

    instances[0].emit(tick(undefined, { ev: [{ type: "attackSwung", playerId: "acct-1" }] }));
    expect(session.drainEvents().some((e) => e.type === "attackSwung")).toBe(false); // own echo

    instances[0].emit(tick(undefined, { ev: [{ type: "attackSwung", playerId: "acct-2" }] }));
    expect(session.drainEvents().some((e) => e.type === "attackSwung")).toBe(true); // someone else's
    session.dispose();
  });
});
