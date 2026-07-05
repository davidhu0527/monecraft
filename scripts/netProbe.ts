/**
 * A tiny CLI game client for poking a live game server (local or staging)
 * without a browser:
 *
 *   GAME_TICKET_SECRET=… bun scripts/netProbe.ts ws://localhost:8080 my-world
 *
 * Mints its own ticket (so the secret must match the server's), joins, walks
 * forward for a few seconds, and logs every message class it sees.
 */
import { PROTOCOL_VERSION } from "@/lib/net/protocol";
import { gunzipWorldSync } from "@/lib/net/codec";
import { signTicket } from "@/lib/net/tickets";

const [, , urlArg, worldArg] = process.argv;
const url = urlArg ?? "ws://localhost:8080";
const worldId = worldArg ?? "probe-world";
const secret = process.env.GAME_TICKET_SECRET;
if (!secret) {
  console.error("GAME_TICKET_SECRET required (must match the server)");
  process.exit(1);
}

const ticket = await signTicket(
  { sub: `probe-${Date.now() % 100000}`, wid: worldId, name: "Probe", skinId: null, role: "member", pv: PROTOCOL_VERSION },
  secret
);
const ws = new WebSocket(`${url}/ws`);
ws.binaryType = "arraybuffer";

let seq = 0;
let pose: { x: number; y: number; z: number } | null = null;
const counts = new Map<string, number>();

ws.onopen = () => {
  console.log("connected — sending hello");
  ws.send(JSON.stringify({ t: "hello", ticket, protocol: PROTOCOL_VERSION }));
};
ws.onclose = (event) => {
  console.log(`closed: ${event.code} ${event.reason}`);
  console.log("message counts:", Object.fromEntries(counts));
  process.exit(0);
};
ws.onmessage = async (event) => {
  if (typeof event.data !== "string") {
    const sync = await gunzipWorldSync(new Uint8Array(event.data as ArrayBuffer));
    console.log(`worldSync: ${sync?.changes.length} block changes, ${sync?.players.length} players, ${sync?.liveMobs.length} mobs`);
    counts.set("worldSync", (counts.get("worldSync") ?? 0) + 1);
    return;
  }
  const message = JSON.parse(event.data) as { t: string } & Record<string, unknown>;
  counts.set(message.t, (counts.get(message.t) ?? 0) + 1);
  if (message.t === "welcome") {
    console.log("welcome:", message.playerId, "world seed", message.seed);
  }
  if (message.t === "tick" && !pose) {
    // Adopt whatever spawn the server gave us, then start walking.
    const self = message.self as { hearts?: number } | undefined;
    if (self) console.log("self:", JSON.stringify(self).slice(0, 120));
    pose = { x: 256, y: 80, z: 256 };
  }
};

const move = { forward: true, back: false, left: false, right: false, jump: false, sprint: false, crouch: false };
setInterval(() => {
  if (ws.readyState !== WebSocket.OPEN || !pose) return;
  pose.z -= 0.2; // amble north at ~4 blocks/s
  seq += 1;
  ws.send(JSON.stringify({ t: "pose", seq, ...pose, yaw: 0, pitch: 0, onGround: true, move, mineHeld: false }));
  if (seq % 40 === 0) ws.send(JSON.stringify({ t: "ping", id: seq, tMs: Date.now() }));
}, 50);

setTimeout(() => {
  console.log("probe done");
  ws.close();
}, 8000);
