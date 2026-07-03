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

function worldSync(players: WorldSync["players"]): WorldSync {
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
    players
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

const tick = (self?: SelfDelta) => JSON.stringify({ t: "tick", n: 101, ev: [], pp: [], mp: [], ...(self ? { self } : {}) });

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
