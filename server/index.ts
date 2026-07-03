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

type SocketData = {
  helloTimer: ReturnType<typeof setTimeout> | null;
  room: Room | null;
  playerId: string | null;
};

const server = Bun.serve<SocketData>({
  port: PORT,
  fetch(request, bunServer) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true, rooms: registry.diagnostics().length });
    if (url.pathname === "/rooms") {
      const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
      if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) return new Response("forbidden", { status: 403 });
      return Response.json({ rooms: registry.diagnostics() });
    }
    if (url.pathname === "/ws") {
      const upgraded = bunServer.upgrade(request, { data: { helloTimer: null, room: null, playerId: null } satisfies SocketData });
      if (upgraded) return undefined as unknown as Response;
      return new Response("expected a websocket", { status: 426 });
    }
    return new Response("not found", { status: 404 });
  },
  websocket: {
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
        }
        return;
      }

      if (ws.data.playerId) await ws.data.room.handleMessage(ws.data.playerId, message);
    },
    close(ws) {
      if (ws.data.helloTimer) clearTimeout(ws.data.helloTimer);
      if (ws.data.room && ws.data.playerId) ws.data.room.leave(ws.data.playerId);
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
