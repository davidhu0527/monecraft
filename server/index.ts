import { decodeClientFrame } from "@/lib/net/codec";
import { CLOSE_BAD_TICKET, CLOSE_PROTOCOL_MISMATCH, CLOSE_ROOM_FULL, PROTOCOL_VERSION } from "@/lib/net/protocol";
import { verifyTicket } from "@/lib/net/tickets";
import { createDrizzlePersistence, createMemoryPersistence } from "./persistence";
import { RoomRegistry } from "./roomRegistry";
import type { Room, ClientSink } from "./room";

/**
 * The game server: one Bun process hosting many world rooms over WebSocket.
 * Run with `bun server/index.ts`. Environment:
 *
 *   PORT               listen port (default 8080)
 *   GAME_TICKET_SECRET shared with the web app — REQUIRED (tickets are the door)
 *   PERSISTENCE        "postgres" (default; needs DATABASE_URL) or "memory"
 *   MAX_ROOMS          concurrent worlds in this process (default 6)
 *   ADMIN_TOKEN        guards GET /rooms diagnostics (optional)
 *
 * The socket handshake: the FIRST frame must be a valid `hello` carrying a
 * live ticket (minted by the web app) and a matching protocol version, within
 * 5 seconds — anything else closes the socket with a 4xxx code.
 */

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const SECRET = process.env.GAME_TICKET_SECRET;
const MAX_ROOMS = Number.parseInt(process.env.MAX_ROOMS ?? "6", 10);
const HELLO_DEADLINE_MS = 5000;

if (!SECRET) {
  console.error("GAME_TICKET_SECRET is required (see .env.example)");
  process.exit(1);
}

const persistence = process.env.PERSISTENCE === "memory" ? createMemoryPersistence() : createDrizzlePersistence();
const registry = new RoomRegistry(persistence, MAX_ROOMS);
registry.startSweeper();

const forbidden = new Response("forbidden", { status: 403 });
/** Bearer-token gate shared by every /rooms* admin endpoint. Absent ADMIN_TOKEN = always denied. */
function authorized(request: Request): boolean {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  return Boolean(process.env.ADMIN_TOKEN) && token === process.env.ADMIN_TOKEN;
}

type SocketData = {
  helloTimer: ReturnType<typeof setTimeout> | null;
  room: Room | null;
  playerId: string | null;
  /** THIS socket's sink identity — scopes the close-time leave so a replaced socket's late close can't tear down its successor. */
  sink: ClientSink | null;
};

const server = Bun.serve<SocketData>({
  port: PORT,
  fetch(request, bunServer) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true, rooms: registry.diagnostics().length });
    if (url.pathname === "/rooms") {
      if (!authorized(request)) return forbidden;
      return Response.json({ rooms: registry.diagnostics() });
    }
    // GET /rooms/:id/log — the replay ring buffer for offline debugging.
    const logMatch = url.pathname.match(/^\/rooms\/([^/]+)\/log$/);
    if (logMatch) {
      if (!authorized(request)) return forbidden;
      const room = registry.getExisting(decodeURIComponent(logMatch[1]));
      return room ? Response.json(room.logDump()) : new Response("no such room", { status: 404 });
    }
    // POST /rooms/:id/kick/:playerId — owner-initiated eject (via the web API's admin token).
    const kickMatch = url.pathname.match(/^\/rooms\/([^/]+)\/kick\/([^/]+)$/);
    if (kickMatch && request.method === "POST") {
      if (!authorized(request)) return forbidden;
      const room = registry.getExisting(decodeURIComponent(kickMatch[1]));
      const kicked = room?.kick(decodeURIComponent(kickMatch[2])) ?? false;
      return Response.json({ kicked });
    }
    if (url.pathname === "/ws") {
      const upgraded = bunServer.upgrade(request, { data: { helloTimer: null, room: null, playerId: null, sink: null } satisfies SocketData });
      if (upgraded) return undefined as unknown as Response;
      return new Response("expected a websocket", { status: 426 });
    }
    return new Response("not found", { status: 404 });
  },
  websocket: {
    // Tick frames are ~1–4 KB of highly repetitive JSON keys — deflate gets
    // 3–5× and browsers negotiate it automatically. Dedicated 16 KB windows:
    // ≤24 sockets (8 players × MAX_ROOMS) costs ~1 MB, trivial on the VM.
    perMessageDeflate: { compress: "16KB", decompress: true },
    open(ws) {
      ws.data.helloTimer = setTimeout(() => ws.close(CLOSE_BAD_TICKET, "no hello"), HELLO_DEADLINE_MS);
    },
    async message(ws, raw) {
      const message = decodeClientFrame(typeof raw === "string" ? raw : null);
      if (!message) return;

      // Pre-admission: only a valid hello gets past this block.
      if (!ws.data.room) {
        if (message.t !== "hello") return;
        if (ws.data.helloTimer) clearTimeout(ws.data.helloTimer);
        if (message.protocol !== PROTOCOL_VERSION) return ws.close(CLOSE_PROTOCOL_MISMATCH, `server speaks v${PROTOCOL_VERSION}`);
        const claims = await verifyTicket(message.ticket, SECRET!);
        if (!claims || claims.pv !== PROTOCOL_VERSION) return ws.close(CLOSE_BAD_TICKET, "invalid ticket");
        const room = await registry.getOrLoad(claims.wid);
        if (!room) return ws.close(CLOSE_ROOM_FULL, "no room available");
        const sink: ClientSink = {
          send: (data) => void ws.send(data),
          close: (code, reason) => ws.close(code, reason),
          bufferedAmount: () => ws.getBufferedAmount()
        };
        if (await room.join(claims, sink)) {
          ws.data.room = room;
          ws.data.playerId = claims.sub;
          ws.data.sink = sink;
        }
        return;
      }

      if (ws.data.playerId) await ws.data.room.handleMessage(ws.data.playerId, message);
    },
    close(ws) {
      if (ws.data.helloTimer) clearTimeout(ws.data.helloTimer);
      // Scoped to THIS socket's sink: a reconnect replaces the conn before the
      // old socket's close fires, and that late close must not evict the
      // fresh session (leave would otherwise match by playerId alone).
      if (ws.data.room && ws.data.playerId && ws.data.sink) ws.data.room.leave(ws.data.playerId, ws.data.sink);
    }
  }
});

console.log(`monecraft game server on :${server.port} (${process.env.PERSISTENCE === "memory" ? "memory" : "postgres"} persistence, ≤${MAX_ROOMS} rooms)`);

// Fly sends SIGTERM on deploy/stop: drain every room (persist + close) first.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void registry.shutdownAll().then(() => process.exit(0));
  });
}
