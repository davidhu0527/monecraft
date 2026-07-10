# Wire protocol (v4)

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

Two wire-size measures keep the JSON hot path cheap (neither changes the
envelope, so no protocol bump):

- **Pose quantization** (`qPos`/`qAng`, `lib/net/codec.ts`): every replicated
  position and velocity rounds to 2 decimals (1 cm) and every angle to 3
  before serialization — well inside all movement clamps and deadbands.
  Applied at the serialization sites only; server-side shadows keep full
  precision.
- **permessage-deflate**: the server offers it (`server/index.ts`), browsers
  negotiate automatically. Note `/rooms`' `kbOutPerSec` counts
  **pre-compression** bytes, so it reflects quantization but not deflate;
  check DevTools (`Sec-WebSocket-Extensions`) or Fly egress for the latter.

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
  commands (pause/debug/camera) never travel. Budget: 60/s (attacks
  additionally 12/s — see the rewind note below).
- `d` on `pose` and `cmd` (v4, required) — the dimension the sender believes
  it is in. The **travel race guard**: frames in flight when the server
  swapped the sender's dimension carry the old stamp and are silently dropped
  (no `forcePose` fight, no raycast into the wrong world).
- `view` on `cmd` (v3, optional) — the sender's render-time view of the world:
  ms on the server tick timeline (`tick × 50`), i.e. the instant the
  interpolated mobs on their screen were sampled at. Attacks carry it once the
  clock is synced; the server uses it for **melee lag compensation** — target
  selection rewinds to the stamped tick (clamped to ≤`MELEE_REWIND_MAX_MS`,
  900 ms), while damage/knockback/kill-credit act on the live mob. Anything
  degenerate (unstamped, future, too stale, mob spawned since) degrades to
  live selection.
- `chat` (≤256 chars, 3/s), `ping`, `resync`.
- `kick { targetId }` — **owner-only**: eject a player. The server re-checks
  the sender's ticket `role` (same gate as the owner-wide `setDifficulty`/
  `setGameMode`), so a forged kick from a member is dropped; self-kick is a
  no-op. The `welcome` carries the recipient's own `role`, so the client shows
  the control only to the owner.

**Server → client**

- `tick { n, ev, pp, mp, vp?, prj?, day?, self? }` @20 Hz — world events since
  last tick (block edits ride these; each event is stamped with the acting
  `playerId` where one exists — clients use the stamp to tell their own
  echoes from other players' actions), other players' poses, deadbanded mob
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

**Dimensions (v4).** A room simulates one engine **per active dimension**
(overworld always; the nether lazily), and every tick channel is scoped to
the recipient's dimension: `blocks`/`ev`/`pp`/`mp`/`vp`/`prj` and
`mobsKeyframe` describe only the world the recipient is in (a cross-dimension
keyframe would mass-prune the replica's mobs, since keyframes delete by
absence). `chat`, `playerJoined`/`playerLeft`, `pong`, and `day` stay global.
Where each player is rides the roster (`RosterEntry.dim`), the recipient's
own dimension rides `welcome.dimension`, and every `worldSync` is stamped
with the dimension it describes (a stale resync racing a travel swap is
ignored). **Travel** is server-initiated: portal dwell runs in the server
engine, and on travel the server moves the player between its dimension
engines, then sends the traveler `dim { dimension, tick, dayClock }` followed
immediately by a fresh gzipped `worldSync` for the target — the client
rebuilds its replica engine and renderer in place, **without dropping the
socket** (the online analog of single-player's save-and-remount). Everyone
else gets `playerDim { id, dimension }` (roster tag, toast, and replica
prune/adopt of that player's avatar).

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

## Version bump & rollout

`PROTOCOL_VERSION` is compiled into both sides, and a mismatch is a **fatal**
close (`4001`, or `4000` via the ticket's `pv`), so a bump must ship to the
web app and the game server together:

1. Land the bump on `main` as part of one commit range — the gated CI
   pipeline deploys Vercel and Fly **from the same SHA** (see
   [deploy.md](deploy.md#continuous-deployment-gated-on-ci)); never deploy a
   protocol bump to one side by hand.
2. The Fly rollout SIGTERM-drains rooms (persist + close `4005`); clients
   walk the reconnect ladder.
3. **The mismatch window is inherent and bounded**: a browser still running
   the old bundle mints a ticket stamped with the old `pv` and is refused
   (`4000`/`4001`, no retry) until the page reloads and picks up the new
   bundle. That refusal is the design — a stale client must never talk a
   stale dialect to a new server. The disconnect modal's guidance ("reload
   the page") is the recovery.
4. Verify `/health`, then a two-browser smoke join.
5. Add the version's delta to this page (see the v4 section above for the
   precedent).

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
thing is each avatar's own movement (clamped, never trusted blindly).
Client-side prediction doesn't change this: a predicted block edit is a
local _presentation_ of the cmd that already traveled — the server's block
journal confirms, overrides, or (by timeout) the client reverts. Nothing a
client predicts changes what the server accepts. The
claimed eye pose on `cmd` is the hybrid model's soft spot — acceptable for
invite-only co-op. The v3 `view` stamp is bounded the same way a claimed pose
is clamped: the server rewinds melee **selection only**, never more than
`MELEE_REWIND_MAX_MS` (900 ms) into its own recorded history, treats every
malformed or out-of-window stamp as "judge it live", and caps attacks at 12/s
so a scripted client can't sweep a mob's whole position trail with varied
stamps. A dishonest stamp can therefore claim at most what an honestly-laggy
client would see anyway.
