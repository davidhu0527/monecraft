import { describe, expect, test } from "bun:test";
import { connectNetworkSession, type JoinGrant } from "./NetworkSession";
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
