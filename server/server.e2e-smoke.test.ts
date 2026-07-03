import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { natives } from "../tests/setup";
import { PROTOCOL_VERSION } from "@/lib/net/protocol";
import { signTicket } from "@/lib/net/tickets";

/**
 * One REAL socket against the REAL server process (memory persistence): the
 * fake-sink suite covers room logic; this covers what fakes can't — Bun.serve
 * wiring, the upgrade path, the hello deadline plumbing, and binary frames on
 * an actual WebSocket.
 *
 * The shared test setup registers happy-dom, whose browser-emulating fetch/
 * WebSocket can't reach real sockets — this file uses the Bun natives the
 * setup captured before registration.
 */

const PORT = 20000 + Math.floor(Math.random() * 10000);
const SECRET = "smoke-secret";
const ADMIN = "smoke-admin";
let proc: ReturnType<typeof Bun.spawn> | null = null;

beforeAll(async () => {
  proc = Bun.spawn(["bun", "server/index.ts"], {
    cwd: import.meta.dir + "/..",
    env: { ...process.env, PORT: String(PORT), GAME_TICKET_SECRET: SECRET, PERSISTENCE: "memory", ADMIN_TOKEN: ADMIN },
    stdout: "pipe",
    stderr: "pipe"
  });
  // Wait for /health to answer.
  for (let i = 0; i < 100; i += 1) {
    try {
      const response = await natives.fetch(`http://localhost:${PORT}/health`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("game server did not come up");
}, 20000);

afterAll(() => {
  proc?.kill();
});

describe("game server over a real socket", () => {
  test("hello with a valid ticket → welcome + binary world sync; garbage ticket → 4000", async () => {
    const ticket = await signTicket({ sub: "smoke-1", wid: "smoke-world", name: "Smoke", skinId: null, role: "owner", pv: PROTOCOL_VERSION }, SECRET);

    const ws = new natives.WebSocket(`ws://localhost:${PORT}/ws`);
    ws.binaryType = "arraybuffer";
    const frames: Array<string | ArrayBuffer> = [];
    const welcome = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no welcome")), 15000);
      ws.onmessage = (event) => {
        frames.push(event.data as string | ArrayBuffer);
        // welcome (text) + worldSync (binary) both in → done.
        if (frames.some((f) => typeof f === "string") && frames.some((f) => typeof f !== "string")) {
          clearTimeout(timer);
          resolve();
        }
      };
      ws.onopen = () => ws.send(JSON.stringify({ t: "hello", ticket, protocol: PROTOCOL_VERSION }));
    });
    await welcome;
    const text = frames.find((f) => typeof f === "string") as string;
    expect(JSON.parse(text)).toMatchObject({ t: "welcome", playerId: "smoke-1", worldId: "smoke-world" });
    const binary = frames.find((f) => typeof f !== "string") as ArrayBuffer;
    expect(binary.byteLength).toBeGreaterThan(16);
    ws.close();

    const bad = new natives.WebSocket(`ws://localhost:${PORT}/ws`);
    const closed = new Promise<number>((resolve) => {
      bad.onclose = (event) => resolve(event.code);
      bad.onopen = () => bad.send(JSON.stringify({ t: "hello", ticket: "garbage", protocol: PROTOCOL_VERSION }));
    });
    expect(await closed).toBe(4000);
  }, 30000);

  test("/health answers; /rooms requires the admin token", async () => {
    expect((await natives.fetch(`http://localhost:${PORT}/health`)).ok).toBe(true);
    expect((await natives.fetch(`http://localhost:${PORT}/rooms`)).status).toBe(403);
  });

  test("admin diagnostics + replay log are token-gated and report the joined room", async () => {
    const auth = { headers: { authorization: `Bearer ${ADMIN}` } };
    // The prior test joined "smoke-world"; it lingers loaded (idle-evict is 5 min).
    const rooms = (await (await natives.fetch(`http://localhost:${PORT}/rooms`, auth)).json()) as { rooms: Array<{ worldId: string; kbOutPerSec: number }> };
    expect(rooms.rooms.some((r) => r.worldId === "smoke-world")).toBe(true);

    expect((await natives.fetch(`http://localhost:${PORT}/rooms/smoke-world/log`)).status).toBe(403); // no token
    const dump = (await (await natives.fetch(`http://localhost:${PORT}/rooms/smoke-world/log`, auth)).json()) as {
      worldId: string;
      seed: number;
      entries: unknown[];
    };
    expect(dump.worldId).toBe("smoke-world");
    expect(dump.seed).toBeGreaterThan(0);

    expect((await natives.fetch(`http://localhost:${PORT}/rooms/does-not-exist/log`, auth)).status).toBe(404);
  });
});
