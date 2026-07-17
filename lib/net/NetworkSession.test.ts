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
  dimension: "overworld" as const,
  players: [{ id: "acct-1", name: "Alpha", skinId: null, dim: "overworld" as const, x: 5, y: 40, z: 5, yaw: 0 }]
};

function worldSync(players: WorldSync["players"], overrides: Partial<WorldSync> = {}): WorldSync {
  return {
    t: "worldSync",
    tick: 100,
    dimension: "overworld",
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

  emitError(): void {
    this.onerror?.();
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

  // A binary worldSync awaits gunzip (several macrotasks in a real browser),
  // and a text tick arriving during that await used to run to completion first,
  // then the older worldSync landed on top and clobbered it. Frames must APPLY
  // in arrival order regardless of how long each takes to process.
  test("a later text frame is not overwritten by an earlier binary frame that finishes late", async () => {
    const { make, instances } = socketFactory();
    const session = await connectNetworkSession("ws://game", "ticket-1", {}, { makeSocket: make, worldSize: SMALL });
    await pushWorldSync(instances[0], worldSync(WELCOME.players));

    const world = session.engine.state.world;
    const cell = { x: 4, y: 5, z: 6 };
    const idx = cell.x + cell.z * world.sizeX + cell.y * world.sizeX * world.sizeZ;

    // Emit both back-to-back, NO awaits between: the worldSync's gunzip is still
    // pending when the tick arrives. The tick is the later frame, so its block
    // must be the one that survives.
    const gz = await gzipWorldSync(worldSync(WELCOME.players, { changes: [[idx, BlockId.Stone]] }));
    instances[0].emit(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength));
    instances[0].emit(JSON.stringify({ t: "tick", n: 102, ev: [], pp: [], mp: [], blocks: [[idx, BlockId.Dirt]] }));

    // Let the whole inbound chain drain.
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    expect(world.get(cell.x, cell.y, cell.z)).toBe(BlockId.Dirt); // the later frame won
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
    const chatsSoFar = () =>
      instances[0].sent
        .slice(before)
        .map((s) => JSON.parse(s) as { t: string; text?: string })
        .filter((m) => m.t === "chat")
        .map((m) => m.text);
    // Poll for completeness rather than sleeping a fixed 300 ms — a loaded CI
    // runner can starve the delivery timers past any fixed deadline, and this
    // test is about ORDER, not delivery speed.
    const deadline = Date.now() + 5000;
    while (chatsSoFar().length < 20 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(chatsSoFar()).toEqual(Array.from({ length: 20 }, (_, i) => `m${i}`));
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

  // Browsers fire error THEN close for an abnormal drop. Both used to call the
  // close handler, so a single failure burned two rungs of the ladder, minted
  // two tickets, and raced two handshakes.
  test("a socket's error+close pair schedules exactly one reconnect", async () => {
    const { make, instances } = socketFactory();
    let ticketsMinted = 0;
    const session = await connectNetworkSession(
      "ws://game",
      "ticket-1",
      {},
      {
        makeSocket: make,
        worldSize: SMALL,
        reconnect: async () => {
          ticketsMinted += 1;
          return { url: "ws://game", ticket: `ticket-${ticketsMinted + 1}` };
        }
      }
    );
    await pushWorldSync(instances[0], worldSync(WELCOME.players));

    // One abnormal drop, both events — as a real browser delivers it.
    instances[0].emitError();
    instances[0].emitClose(1006, "abnormal");
    expect(session.status()).toBe("reconnecting");

    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(ticketsMinted).toBe(1); // one reconnect, not two
    expect(instances.length).toBe(2); // one new socket, not two racing handshakes
    session.dispose();
  }, 10000);

  // After a successful reconnect, the OLD socket may still close late — the
  // server kicks it when the new join lands (CLOSE_KICKED is fatal). That stale
  // close must not tear down the live session that already reconnected.
  test("a superseded socket's late close doesn't kill the reconnected session", async () => {
    const { make, instances } = socketFactory();
    let ticketsMinted = 0;
    const session = await connectNetworkSession(
      "ws://game",
      "ticket-1",
      {},
      {
        makeSocket: make,
        worldSize: SMALL,
        reconnect: async () => {
          ticketsMinted += 1;
          return { url: "ws://game", ticket: `ticket-${ticketsMinted + 1}` };
        }
      }
    );
    await pushWorldSync(instances[0], worldSync(WELCOME.players));

    instances[0].emitClose(4004, "idle");
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await pushWorldSync(instances[1], worldSync(WELCOME.players));
    expect(session.status()).toBe("online"); // reconnected on socket #2

    // The dead socket #1 now closes with the server's kick — a FATAL code.
    instances[0].emitClose(4003, "kicked");
    expect(session.status()).toBe("online"); // still live: the stale close was ignored
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

  test("a door race reverts the stranded upper half, not just the contested cell", async () => {
    const { session, instances, state, self, g } = await placeScene();
    self.inventory = [...self.inventory];
    self.inventory[0] = createSlot("door", 2);
    session.dispatch({ type: "placeBlock" }); // predicts BOTH door cells at (6, g+1..g+2, 5)
    expect(state.world.get(6, g + 1, 5)).not.toBe(BlockId.Air);
    expect(state.world.get(6, g + 2, 5)).not.toBe(BlockId.Air);
    expect(session.netStats().pendingPredictions).toBe(1);

    // Another player's stone won the lower cell; the server never wrote the
    // upper (its whole door placement failed) — the replica must not keep a
    // floating half-door.
    const lowerIdx = state.world.index(6, g + 1, 5);
    instances[0].emit(tick(undefined, { blocks: [[lowerIdx, BlockId.Stone]] }));

    expect(state.world.get(6, g + 1, 5)).toBe(BlockId.Stone); // server truth
    expect(state.world.get(6, g + 2, 5)).toBe(BlockId.Air); // sibling reverted
    expect(state.players.get("acct-1")!.inventory[0]?.count).toBe(2); // door refunded
    expect(session.netStats().pendingPredictions).toBe(0);
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

  test("attack cmds carry the render-time view stamp once the clock is synced; nothing else does", async () => {
    const { make, instances } = socketFactory();
    const session = await connectNetworkSession("ws://game", "ticket-1", {}, { makeSocket: make, worldSize: SMALL });
    await pushWorldSync(instances[0], worldSync(WELCOME.players));
    const lastCmd = () =>
      instances[0].sent
        .map((s) => JSON.parse(s) as { t: string; cmd?: { type: string }; view?: number })
        .filter((m) => m.t === "cmd")
        .at(-1)!;

    // Before any pong the clock isn't synced: attacks go out unstamped.
    session.dispatch({ type: "attack" });
    expect(lastCmd().cmd?.type).toBe("attack");
    expect("view" in lastCmd()).toBe(false);

    // One pong (serverTick 100 → the 5000 ms mark on the server timeline) syncs
    // the clock; the next frame samples the interpolation render time.
    instances[0].emit(JSON.stringify({ t: "pong", id: 1, tMs: performance.now() - 20, serverTick: 100 }));
    session.afterFrame(performance.now());
    session.dispatch({ type: "attack" });
    const stamped = lastCmd();
    expect(stamped.view).toBeDefined();
    // The stamp is the render time: behind the ~5000 ms server-time estimate by
    // the interpolation delay (125–450 ms), never ahead of it.
    expect(stamped.view!).toBeGreaterThan(5000 - 450 - 100);
    expect(stamped.view!).toBeLessThan(5000 - 125 + 100);

    // Non-attack commands are never stamped, synced or not.
    session.dispatch({ type: "selectSlot", index: 2 });
    expect(lastCmd().cmd?.type).toBe("selectSlot");
    expect("view" in lastCmd()).toBe(false);
    session.dispose();
  });
});

describe("dimension travel (the nether online)", () => {
  /** The nether generator needs real vertical room; the engine suite's proven nether test size. */
  const NETHER_SIZE = { x: 64, y: 150, z: 64 };
  const netherSync = (players: WorldSync["players"]) => worldSync(players, { dimension: "nether", tick: 200 });
  const mySpot = (x: number, y: number, z: number, dim: "overworld" | "nether") => [{ id: "acct-1", name: "Alpha", skinId: null, dim, x, y, z, yaw: 0 }];

  test("a dim frame rebuilds the replica in place: engine rebound, socket alive, self seated from the sync", async () => {
    const { make, instances } = socketFactory();
    const dims: string[] = [];
    const session = await connectNetworkSession("ws://game", "ticket-1", { onDimension: (d) => dims.push(d) }, { makeSocket: make, worldSize: NETHER_SIZE });
    await pushWorldSync(instances[0], worldSync(WELCOME.players));
    expect(session.status()).toBe("online");
    const engineBefore = session.engine;

    instances[0].emit(JSON.stringify({ t: "dim", dimension: "nether", tick: 200, dayClock: 61 }));
    // The swap is immediate and in place: new engine, same socket, syncing.
    expect(session.engine).not.toBe(engineBefore);
    expect(session.engine.state.dimension).toBe("nether");
    expect(session.status()).toBe("syncing");
    expect(instances).toHaveLength(1);
    expect(dims).toEqual(["nether"]);
    // The local traveler's toast event fires through the drain.
    expect(session.drainEvents().some((e) => e.type === "playerDimension" && e.playerId === "acct-1" && e.dimension === "nether")).toBe(true);

    // The matching sync seats us at the arrival portal and flips us online.
    await pushWorldSync(instances[0], netherSync(mySpot(20, 40, 20, "nether")));
    expect(session.status()).toBe("online");
    expect(session.engine.state.player.position.x).toBeCloseTo(20, 5);
    expect(session.engine.state.player.position.y).toBeCloseTo(40, 5);

    // Outgoing frames now stamp the new dimension.
    session.afterFrame(10_000);
    const lastPose = instances[0].sent
      .map((s) => JSON.parse(s) as { t: string; d?: string })
      .filter((m) => m.t === "pose")
      .at(-1);
    expect(lastPose?.d).toBe("nether");
    session.dispose();
  });

  test("the pose stream pauses between the dim swap and its worldSync (the fresh replica's spawn is transient)", async () => {
    const { make, instances } = socketFactory();
    const session = await connectNetworkSession("ws://game", "ticket-1", {}, { makeSocket: make, worldSize: NETHER_SIZE });
    await pushWorldSync(instances[0], worldSync(WELCOME.players));
    session.afterFrame(5_000); // baseline: online poses flow
    const posesBefore = instances[0].sent.filter((s) => (JSON.parse(s) as { t: string }).t === "pose").length;
    expect(posesBefore).toBeGreaterThan(0);

    instances[0].emit(JSON.stringify({ t: "dim", dimension: "nether", tick: 200, dayClock: 61 }));
    // Mid-swap: self sits at a generic spawn the sync hasn't corrected yet —
    // streaming it could walk the server player out of the arrival portal.
    session.afterFrame(10_000);
    session.afterFrame(10_100);
    expect(instances[0].sent.filter((s) => (JSON.parse(s) as { t: string }).t === "pose").length).toBe(posesBefore);

    // The sync seats us; the stream resumes with the new stamp.
    await pushWorldSync(instances[0], netherSync(mySpot(20, 40, 20, "nether")));
    session.afterFrame(20_000);
    const poses = instances[0].sent.map((s) => JSON.parse(s) as { t: string; d?: string }).filter((m) => m.t === "pose");
    expect(poses.length).toBe(posesBefore + 1);
    expect(poses.at(-1)?.d).toBe("nether");
    session.dispose();
  });

  test("a stale worldSync for the departed dimension is ignored", async () => {
    const { make, instances } = socketFactory();
    const session = await connectNetworkSession("ws://game", "ticket-1", {}, { makeSocket: make, worldSize: NETHER_SIZE });
    await pushWorldSync(instances[0], worldSync(WELCOME.players));

    instances[0].emit(JSON.stringify({ t: "dim", dimension: "nether", tick: 200, dayClock: 61 }));
    // An overworld-stamped sync racing the swap (a resync answered pre-travel)
    // must not land in the nether replica.
    await pushWorldSync(instances[0], worldSync(mySpot(9, 40, 9, "overworld")));
    expect(session.status()).toBe("syncing");
    expect(session.engine.state.dimension).toBe("nether");

    await pushWorldSync(instances[0], netherSync(mySpot(20, 40, 20, "nether")));
    expect(session.status()).toBe("online");
    session.dispose();
  });

  test("playerDim prunes a remote avatar that left our dimension and the pose stream re-adopts it on return", async () => {
    const { make, instances } = socketFactory();
    const session = await connectNetworkSession("ws://game", "ticket-1", {}, { makeSocket: make, worldSize: SMALL });
    const bob = { id: "acct-2", name: "Bob", skinId: null, dim: "overworld" as const, x: 8, y: 40, z: 8, yaw: 0 };
    await pushWorldSync(instances[0], worldSync([...WELCOME.players, bob]));
    expect(session.engine.state.players.has("acct-2")).toBe(true);

    instances[0].emit(JSON.stringify({ t: "playerDim", id: "acct-2", dimension: "nether" }));
    expect(session.engine.state.players.has("acct-2")).toBe(false); // no avatar in the wrong terrain
    expect(session.roster().find((m) => m.id === "acct-2")?.dimension).toBe("nether"); // still in the world
    expect(session.drainEvents().some((e) => e.type === "playerDimension" && e.playerId === "acct-2")).toBe(true);

    // Back to our dimension: the next pose frame re-adds them at their real spot.
    instances[0].emit(JSON.stringify({ t: "playerDim", id: "acct-2", dimension: "overworld" }));
    expect(session.engine.state.players.has("acct-2")).toBe(false); // not yet — no flash at world spawn
    instances[0].emit(tick(undefined, { pp: [{ id: "acct-2", x: 9, y: 40, z: 9, yaw: 0, pitch: 0 }] }));
    expect(session.engine.state.players.has("acct-2")).toBe(true);
    session.dispose();
  });

  test("a welcome that says nether boots a nether replica (rejoin where you left)", async () => {
    const { make, instances } = socketFactory({ ...WELCOME, dimension: "nether", players: mySpot(20, 40, 20, "nether") });
    const session = await connectNetworkSession("ws://game", "ticket-1", {}, { makeSocket: make, worldSize: NETHER_SIZE });
    expect(session.engine.state.dimension).toBe("nether");
    await pushWorldSync(instances[0], netherSync(mySpot(20, 40, 20, "nether")));
    expect(session.status()).toBe("online");
    session.dispose();
  });

  test("a reconnect whose welcome says another dimension adopts it before the resync", async () => {
    const welcome = { ...WELCOME, players: [...WELCOME.players] };
    const { make, instances } = socketFactory(welcome);
    const session = await connectNetworkSession(
      "ws://game",
      "ticket-1",
      {},
      { makeSocket: make, worldSize: NETHER_SIZE, reconnect: async () => ({ url: "ws://game", ticket: "ticket-2" }) }
    );
    await pushWorldSync(instances[0], worldSync(WELCOME.players));
    expect(session.engine.state.dimension).toBe("overworld");

    // While we were away the server moved us (drop raced a travel).
    welcome.dimension = "nether";
    welcome.players = mySpot(20, 40, 20, "nether");
    instances[0].emitClose(4004, "idle");
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(instances).toHaveLength(2);
    expect(session.engine.state.dimension).toBe("nether");
    await pushWorldSync(instances[1], netherSync(mySpot(20, 40, 20, "nether")));
    expect(session.status()).toBe("online");
    session.dispose();
  }, 10_000);
});
