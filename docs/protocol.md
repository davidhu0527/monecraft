# Wire protocol (v1)

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

**Server → client**

- `tick { n, ev, pp, mp, day?, self? }` @20 Hz — world events since last
  tick (block edits ride these), other players' poses, deadbanded mob poses
  (~10 Hz), the day clock every second, and `self`: the private, server-
  authoritative delta of YOUR state (inventory/hearts/hunger/xp/effects/…),
  sent only on change.
- `mobsKeyframe` every 5s (drift correction), `playerJoined`/`playerLeft`,
  `container` (open-chest updates), `chat`, `pong`, `forcePose`.

Backpressure: past 256 KB buffered, a client's `pp`/`mp` are shed (events
and `self` still flow); sustained >1 MB is a `4008` kick.

## Close codes

| Code | Meaning                                           |
| ---- | ------------------------------------------------- |
| 4000 | bad/expired ticket (or no hello in time)          |
| 4001 | protocol version mismatch                         |
| 4002 | room full (8 players) or server at MAX_ROOMS      |
| 4003 | kicked (owner action, or replaced by a reconnect) |
| 4004 | idle timeout                                      |
| 4005 | server shutting down (redeploy — reconnect after) |
| 4008 | slow client (sustained backpressure)              |

## Trust model

The server is authoritative for the world: every gameplay command executes
in ITS engine; clients cannot invent items or edits. The one client-owned
thing is each avatar's own movement (clamped, never trusted blindly). The
claimed eye pose on `cmd` is the hybrid model's soft spot — acceptable for
invite-only co-op, and the envelope already carries what stricter server-side
rewind validation would need.
