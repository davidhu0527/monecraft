import { expect, test } from "bun:test";
import { PROTOCOL_VERSION } from "@/lib/net/protocol";
import type { TicketClaims } from "@/lib/net/tickets";
import { createMemoryPersistence } from "./persistence";
import { Room, type ClientSink } from "./room";

/**
 * Streamed held-mining, end-to-end through the room: a pose carrying
 * mineHeld=true and an aim at the block underfoot must break that block for a
 * joiner who has NEVER moved since being seated. A fresh joiner sits at exact
 * integer coordinates — on the cell boundary — which is precisely where the
 * old raycast degeneracy sent the mining ray sideways into a neighbor column
 * (see voxelRaycast in lib/world/queries.ts): the second player in a co-op
 * world could not mine at all until they walked, and the friend-dig e2e was
 * passing on random-tick noise instead of this.
 */

function sink(): ClientSink {
  return { send() {}, close() {}, bufferedAmount: () => 0 };
}

function claimsFor(id: string, wid: string, role: "owner" | "member" = "member"): TicketClaims {
  return { sub: id, wid, name: id.toUpperCase(), skinId: null, role, pv: PROTOCOL_VERSION, iat: 0, exp: 9999999999 } as TicketClaims;
}

const move = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, crouch: false };

test("a never-moved joiner's streamed mineHeld breaks the block underfoot", async () => {
  const persistence = createMemoryPersistence();
  const record = await persistence.loadWorld("w1");
  const room = new Room(record!, persistence, () => 0);
  await room.join(claimsFor("alice", "w1", "owner"), sink());
  await room.join(claimsFor("bob", "w1"), sink());
  const tick = (room as unknown as { tick(dt: number): void }).tick.bind(room);

  const bob = room.engine.state.players.get("bob")!;
  const px = bob.position.x;
  const py = bob.position.y;
  const pz = bob.position.z;
  const fx = Math.floor(px);
  const fz = Math.floor(pz);
  const belowY = Math.floor(py) - 1;
  expect(room.engine.state.world.get(fx, belowY, fz)).not.toBe(0);

  // Aim at the CENTER of the block underfoot — a fixed straight-down pitch
  // from an on-boundary origin legitimately rays along the boundary into the
  // neighbor column, which may hold nothing in reach (a cliff edge).
  const dx = fx + 0.5 - px;
  const dy = belowY + 0.5 - (py + 1.62);
  const dz = fz + 0.5 - pz;
  const len = Math.hypot(dx, dy, dz);
  await room.handleMessage("bob", {
    t: "pose",
    d: "overworld",
    seq: 1,
    x: px,
    y: py,
    z: pz,
    yaw: Math.atan2(-dx, -dz),
    pitch: Math.asin(dy / len),
    onGround: true,
    move,
    mineHeld: true
  } as never);

  // Survival bare-hand mining of the surface block takes a couple of
  // simulated seconds at most; stop as soon as it breaks.
  for (let i = 0; i < 200 && room.engine.state.world.get(fx, belowY, fz) !== 0; i += 1) tick(0.05);
  expect(room.engine.state.world.get(fx, belowY, fz)).toBe(0);
}, 60000);
