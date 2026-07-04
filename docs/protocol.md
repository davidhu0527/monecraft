# Wire protocol (v2)

The client↔game-server protocol, defined in `lib/net/protocol.ts` (single
source of truth — this page is the narrative). Versioned as a whole via
`PROTOCOL_VERSION`; join tickets stamp it, and a mismatch is refused at the
door, so format drift mid-session cannot happen.

## Transport & framing

WebSocket to the game server's `/ws`. Everything is a JSON text frame
discriminated on `t`, except **one binary frame**: the world sync (join and
`resync`), which is gzipped JSON — a fresh world's block diff is bytes, a
terraformed one compresses >2×. Hot paths (pose/tick) can move to packed
binary later without renegotiating anything: the envelope shape is the
contract, not the encoding.

## Handshake

1. Client connects and must send `hello { ticket, protocol }` within **5s**.
2. The server verifies the ticket (HS256, 60s TTL, minted by the web API —
   see [online.md](online.md)), checks `protocol === PROTOCOL_VERSION`, loads
   the room, and answers `welcome` + the binary `worldSync`.
3. Anything else → close with an application code (below).

A client regenerates the world from `welcome.seed` (bit-identical since
worldgen v11 — see [testing.md](testing.md)) and applies `worldSync.changes`;
the join payload is KBs, not the 37 MB voxel field.

## Steady state

**Client → server**

- `pose` @20 Hz — client-authoritative avatar movement + live intents.
  Clamped server-side (sprint-ceiling speed, jump/fall vertical, teleport
  rejection → `forcePose`); accepted movement drives server-side hunger,
  distance stats, and fall damage.
- `cmd` — a discrete `Command` + the claimed eye pose (applied through the
  same clamps before dispatch, so aimed raycasts resolve where the client
  looked). Validated against a per-type **allow-list**; local-presentation
  commands (pause/debug/camera) never travel. Budget: 60/s.
- `chat` (≤256 chars, 3/s), `ping`, `resync`.
- `kick { targetId }` — **owner-only**: eject a player. The server re-checks
  the sender's ticket `role` (same gate as the owner-wide `setDifficulty`/
  `setGameMode`), so a forged kick from a member is dropped; self-kick is a
  no-op. The `welcome` carries the recipient's own `role`, so the client shows
  the control only to the owner.

**Server → client**

- `tick { n, ev, pp, mp, vp?, prj?, day?, self? }` @20 Hz — world events since
  last tick (block edits ride these), other players' poses, deadbanded mob
  poses (~10 Hz), **vehicle poses** (`vp`, deadbanded — a parked boat costs
  nothing; vehicles never despawn so no absence-pruning), **arrow poses**
  (`prj`, the full live set every tick — arrows are few and fast, so they snap
  and prune by absence; one trailing empty `prj` clears the last one), the day
  clock every second, and `self`: the private, server-authoritative delta of
  YOUR state (inventory/hearts/hunger/xp/effects/…), sent only on change.
- `mobsKeyframe` every 5s (drift correction), `playerJoined`/`playerLeft`,
  `container` (open-chest updates), `chat`, `pong`, `forcePose`.

**Vehicles & mounted riders (v2).** A vehicle's pose (`VehiclePose`: id, kind,
x/y/z, yaw, riderId) replicates on `vp` and in the join `worldSync` (keyed by
server id, so per-tick deltas line up). Arrows (`ProjectilePose`: id, x/y/z,
vx/vy/vz — velocity so the client orients the mesh) replicate on `prj`. A
**mounted** rider is the one hybrid-model exception: the server owns their
position (`tickVehicles` drives it from their input intents), so the pose
stream is rejected without a `forcePose` correction, and the `SelfDelta`
carries `mountedVehicleId` (on mount/dismount) plus the authoritative `x/y/z`
(while mounted). The replica adopts that mount state and snaps to the position,
skipping its own motion integration until it dismounts.

Backpressure: past 256 KB buffered, a client's `pp`/`mp`/`vp`/`prj` are shed
(events and `self` still flow); sustained >1 MB is a `4008` kick.

## Reconnect

The replica engine outlives the socket. On a **non-fatal** drop the client
walks a back-off ladder (`RECONNECT_DELAYS_MS` = 1/2/4/8/8 s), minting a
**fresh** ticket each rung (the 60 s TTL kills a stale one) and doing a whole
new `hello` → `welcome` → world-sync — a reconnect is an ordinary join on a
new socket, not a special frame, so the server's `join` already re-syncs the
same room in place. The server closes the player's _previous_ socket with
`4003` when the new one lands (see the table). `resync` stays the same-socket
path (a client that's still connected but suspects drift asks for a fresh
world-sync + keyframe). Fatal closes are not retried; after the ladder is
exhausted the client shows the disconnect modal.

## Close codes

| Code | Meaning                                           | Client retries? |
| ---- | ------------------------------------------------- | --------------- |
| 4000 | bad/expired ticket (or no hello in time)          | no (fatal)      |
| 4001 | protocol version mismatch                         | no (fatal)      |
| 4002 | room full (8 players) or server at MAX_ROOMS      | no (fatal)      |
| 4003 | kicked (owner action, or replaced by a reconnect) | no (fatal)      |
| 4004 | idle timeout                                      | yes (ladder)    |
| 4005 | server shutting down (redeploy — reconnect after) | yes (ladder)    |
| 4008 | slow client (sustained backpressure)              | no (fatal)      |
| 1006 | abnormal close (network drop)                     | yes (ladder)    |

## Trust model

The server is authoritative for the world: every gameplay command executes
in ITS engine; clients cannot invent items or edits. The one client-owned
thing is each avatar's own movement (clamped, never trusted blindly). The
claimed eye pose on `cmd` is the hybrid model's soft spot — acceptable for
invite-only co-op, and the envelope already carries what stricter server-side
rewind validation would need.
