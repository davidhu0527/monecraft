/**
 * Soak load: drives N synthetic clients into one room and reports the server's
 * tick budget and bandwidth so MAX_ROOMS and the deadbands can be tuned from
 * numbers, not guesses:
 *
 *   GAME_TICKET_SECRET=… ADMIN_TOKEN=… \
 *     bun scripts/loadSim.ts ws://localhost:8080 my-world 8 30
 *                            └ url            └ world └ clients └ seconds
 *
 * Each client joins, streams a 20 Hz pose walking a small circle plus an
 * occasional block break, and tallies bytes received. Meanwhile it polls the
 * admin /rooms endpoint (ADMIN_TOKEN) once a second for the server's own
 * players/tick/slowest-tick/bandwidth counters, then prints per-client and
 * server-side p95 tick time and aggregate throughput.
 */
import { PROTOCOL_VERSION } from "@/lib/net/protocol";
import { signTicket } from "@/lib/net/tickets";

const [, , urlArg, worldArg, clientsArg, secondsArg] = process.argv;
const wsUrl = urlArg ?? "ws://localhost:8080";
const httpUrl = wsUrl.replace(/^ws/, "http");
const worldId = worldArg ?? "loadsim-world";
const clientCount = Math.max(1, Number.parseInt(clientsArg ?? "8", 10));
const durationMs = Math.max(1, Number.parseInt(secondsArg ?? "30", 10)) * 1000;

const secret = process.env.GAME_TICKET_SECRET;
if (!secret) {
  console.error("GAME_TICKET_SECRET required (must match the server)");
  process.exit(1);
}
const adminToken = process.env.ADMIN_TOKEN;

type ClientStat = { id: string; bytesIn: number; frames: number; connected: boolean };

async function spawnClient(index: number): Promise<ClientStat> {
  const stat: ClientStat = { id: `sim-${index}`, bytesIn: 0, frames: 0, connected: false };
  const ticket = await signTicket(
    { sub: stat.id, wid: worldId, name: `Sim${index}`, skinId: null, role: index === 0 ? "owner" : "member", pv: PROTOCOL_VERSION },
    secret!
  );
  const ws = new WebSocket(`${wsUrl}/ws`);
  ws.binaryType = "arraybuffer";

  let seq = 0;
  const center = { x: 256, y: 80, z: 256 };
  const phase = (index / clientCount) * Math.PI * 2;

  ws.onopen = () => ws.send(JSON.stringify({ t: "hello", ticket, protocol: PROTOCOL_VERSION }));
  ws.onmessage = (event) => {
    stat.frames += 1;
    stat.bytesIn += typeof event.data === "string" ? event.data.length : (event.data as ArrayBuffer).byteLength;
    if (typeof event.data === "string") {
      const message = JSON.parse(event.data) as { t: string };
      if (message.t === "welcome") stat.connected = true;
    }
  };
  ws.onclose = () => {
    stat.connected = false;
  };

  const move = { forward: true, back: false, left: false, right: false, jump: false, sprint: false, crouch: false };
  const poser = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    seq += 1;
    const t = seq / 20;
    const x = center.x + Math.cos(t + phase) * 6;
    const z = center.z + Math.sin(t + phase) * 6;
    ws.send(JSON.stringify({ t: "pose", seq, x, y: center.y, z, yaw: t, pitch: 0, onGround: true, move, mineHeld: seq % 40 < 10 }));
    if (seq % 20 === 0) ws.send(JSON.stringify({ t: "ping", id: seq, tMs: Date.now() }));
    // A block break every ~3s so the edit/journal path is exercised under load.
    if (seq % 60 === 0) ws.send(JSON.stringify({ t: "cmd", seq, cmd: { type: "attack" }, pose: { x, y: center.y + 1.6, z, yaw: t, pitch: -1.4 } }));
  }, 50);

  setTimeout(() => {
    clearInterval(poser);
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }, durationMs);
  return stat;
}

async function pollRooms(): Promise<{ players: number; tick: number; slowestTickMs: number; kbOutPerSec: number } | null> {
  if (!adminToken) return null;
  try {
    const response = await fetch(`${httpUrl}/rooms`, { headers: { authorization: `Bearer ${adminToken}` } });
    if (!response.ok) return null;
    const body = (await response.json()) as { rooms: Array<{ worldId: string; players: number; tick: number; slowestTickMs: number; kbOutPerSec: number }> };
    return body.rooms.find((r) => r.worldId === worldId) ?? null;
  } catch {
    return null;
  }
}

console.log(`loadSim: ${clientCount} clients → ${worldId} for ${durationMs / 1000}s`);
const stats = await Promise.all(Array.from({ length: clientCount }, (_, i) => spawnClient(i)));

const slowestSamples: number[] = [];
let peakKbOut = 0;
const sampler = setInterval(async () => {
  const room = await pollRooms();
  if (!room) return;
  slowestSamples.push(room.slowestTickMs);
  peakKbOut = Math.max(peakKbOut, room.kbOutPerSec);
  console.log(`  t=${(room.tick / 20).toFixed(0)}s players=${room.players} slowestTick=${room.slowestTickMs}ms out=${room.kbOutPerSec}KB/s`);
}, 1000);

await new Promise((resolve) => setTimeout(resolve, durationMs + 500));
clearInterval(sampler);

const connected = stats.filter((s) => s.connected || s.frames > 0).length;
const totalKbIn = stats.reduce((sum, s) => sum + s.bytesIn, 0) / 1024;
const p95 = slowestSamples.length
  ? [...slowestSamples].sort((a, b) => a - b)[Math.min(slowestSamples.length - 1, Math.floor(slowestSamples.length * 0.95))]
  : null;

console.log(`\n── results ──`);
console.log(`clients that joined: ${connected}/${clientCount}`);
console.log(`downstream received: ${totalKbIn.toFixed(0)} KB total, ${(totalKbIn / (durationMs / 1000)).toFixed(1)} KB/s aggregate`);
if (p95 !== null) console.log(`server tick p95: ${p95}ms (budget is 50ms); peak downstream: ${peakKbOut} KB/s`);
else console.log(`(set ADMIN_TOKEN to sample server-side tick/bandwidth stats)`);
process.exit(0);
