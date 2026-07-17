# Online: accounts, cloud saves, multiplayer

How the online stack fits together, and how to run it. The offline
single-player game needs **none** of this: without an online action, the
client never makes an auth request (the `minecraft_online_v1` localStorage
flag gates even the session check).

## The pieces

```
Browser ──(cookies)── Next.js app          ── Neon/Postgres
   │                   /api/auth/*   better-auth (accounts)
   │                   /api/worlds…  world CRUD, invites, cloud saves
   │                   /api/worlds/:id/ticket   mints 60s HS256 join ticket
   │
   └──(ws + ticket)── Game server (Bun, Fly.io)  ── same Postgres
                       one authoritative GameEngine room per world (phase 4)
```

The web app and the game server never talk to each other at runtime: the
join ticket (`lib/net/tickets.ts`, signed with the shared
`GAME_TICKET_SECRET`) is the only trust link, and both read the same
Postgres.

## Identity: Local Players and accounts

- **Online play is accounts-only** (email/password via better-auth). There is
  no anonymous-guest layer: an invite link, cloud sync, or hosting all start
  with sign-in/register. Logged-out **Local Players** keep any number of
  browser-local profiles and worlds and make **zero** server calls.
- **The logged-out root is a welcome gate**
  (`components/menu/WelcomeScreen.tsx`): exactly two doors — **Sign in**
  (opens the dedicated `AuthScreen`, whose email/password form registers via
  its "I need an account" toggle; the form itself is the shared
  `AccountForm`) and **Play locally** (the browser-local `ProfileSelect`,
  with no account UI on it and a Back to the gate). The gate shows on every
  logged-out launch; a signed-in reload skips it — the shell holds a neutral
  frame until the session probe answers, then lands on the account home.
- When signed in, the menu opens into an **account home**
  (`components/menu/AccountProfileSelect.tsx`) listing that account's
  server-side profiles (create/rename/delete, capped at `MAX_ONLINE_PROFILES`,
  synced across devices); picking one shows its worlds (`OnlineWorldSelect`)
  in two sections: **Online Worlds** (server-hosted mp rooms; the join ticket
  carries the profile's name/skin) and **Singleplayer** (`sp-cloud` worlds —
  full client-side engine, **no game server**, saves synced to the account so
  any signed-in device continues them). Owned worlds of both kinds share the
  `MAX_WORLDS_PER_PROFILE` cap. Worlds joined by invite are account-level
  memberships, so they appear under **every** profile with a "Joined" tag;
  so do singleplayer saves uploaded from the local menus (`profileId` null —
  account-level).
- Local worlds are **hidden but preserved** while signed in — never deleted,
  never auto-uploaded. The account home's quiet **"Local worlds on this
  browser"** footer link opens the local menus without signing out (that's
  also where cloud-save sync lives); "Back to account" returns. Signing out
  lands on the welcome gate.
- Sessions are better-auth cookies; the game server never sees them.
- The compact Account panel (`components/menu/AccountPanel.tsx` — logged out
  it offers **Sign in** and **Create account** side by side, expanding into
  the shared `AccountForm`) now serves **only** the `/join/<token>` invite
  landing page; the main menu routes through the welcome gate instead.

## Worlds, invites, cloud saves

`lib/online/worldsService.ts` owns the rules (membership-gated reads that
present as `not-found` so ids can't be probed; owner-gated rename/delete/
invite; idempotent invite acceptance with expiry/max-uses). The `app/api`
routes are thin HTTP adapters over it.

Single-player cloud saves are gzipped `SaveData` blobs (`lib/game/
cloudSaves.ts` — block diffs compress extremely well) with last-write-wins
concurrency: each device sends the `saveRevision` it last saw
(`x-base-revision`); a mismatch is **409** and the pushing client stops
syncing and warns (rather than clobber the other device), then adopts the
newer save on the next open.

**Two clocks, deliberately.** `worlds.updatedAt` is metadata mtime — "last
touched", what the world list orders by. `worlds.saveRevision` counts **blob
writes and nothing else**: it is the sync cursor devices compare (stored per
world under `minecraft_cloud_stamps_v2`) and the CAS token their uploads race
on, incremented SQL-side by both writers (`putSaveBlob` and the game server's
`storeWorld`) so concurrent writes can't settle on a value read earlier.
Revision `0` means never saved, which is what makes "first upload" checkable
without trusting the client. They must stay separate: while `updatedAt` served
as both, **renaming a world moved every other device's cursor** and 409'd its
next push over a save that hadn't changed — and since a 409 latches
`cloudConflictRef`, that silently disabled sync for the rest of the session.
Because revisions are ordered, the open-time reconcile asks whether the remote
is strictly _ahead_ of the cursor rather than merely different, so a remote
that's behind (a restored backup) leaves newer local progress alone.

⚠️ **The web app and the game server both write `save_revision`**, so they ship
from the same SHA — see [deploy.md](deploy.md#updating-a-running-deployment).

**Uploads are queued, not fired.** Six call sites push a cloud-linked world
(autosave, the three unload listeners, hardcore game-over, unmount, manual
save) and several fire together — backgrounding a phone raises both
`visibilitychange` and `pagehide`. So pushes go through a latest-wins queue
(`lib/game/cloudPushQueue.ts`): one upload in flight, the newest snapshot
queued behind it, superseded snapshots dropped. Unqueued, they raced with the
same base revision and the loser's 409 latched sync off — a device switching
off its own sync by conflicting with itself. The snapshot is serialized when a
push is _requested_, not when it runs, so the unload flush uploads the state as
of the unload. The reconcile's `commitCursor()` is likewise the caller's to
call **after** the local write commits: the cursor claims this device HOLDS
that save, so advancing it past a failed write would make every later open
read the remote as "not ahead" and refuse to adopt it.

**Save upload is `sp-cloud`-only.** Both kinds keep their blob in the same
`worlds.saveBlob` column, but they do not share its ownership: an `sp-cloud`
blob **is** the client's upload, while an `mp` blob is the game server's
authoritative persistence (`server/persistence.ts`), which a room reloads as
world state on its next boot. So `putSaveBlob` gates on `kind` — otherwise
membership alone would let an invited player hand the room whatever world they
liked, bypassing the server authority [protocol.md](protocol.md#trust-model)
reserves ("clients cannot invent items or edits"). Nothing legitimate uploads an
`mp` world: `useMinecraftGame`'s push returns early when online, and mp worlds
carry no `cloudId`. `mintTicket` makes the mirror-image check (`mp` only), so
the two save paths stay disjoint. Reads stay membership-gated for both — a
member can already see the world by playing it.

Stored blobs are inflated through a bounded gunzip
(`MAX_DECOMPRESSED_SAVE_BYTES`, `server/persistence.ts`): gzip ratios run
~1000:1 on hostile input, so an unbounded inflate would turn a few MiB of
stored bytes into GiB of heap on the 512 MB VM. With the kind gate above, a
room should only ever read blobs the server itself wrote, so this is depth
rather than a live vector — but it is the seam where stored bytes become engine
state, and it shouldn't trust the row on the far side.

**How it flows through the menu** (all opt-in per world):

- **Create in account mode** — the profile world screen's **New Singleplayer
  World** makes an `sp-cloud` row owned by the profile and opens it directly:
  the engine runs client-side against a device save cache keyed
  `cloud:<world id>` (a fabricated `WorldMeta` with `cloudId` set, so the same
  reconcile/push machinery below applies — no local-manifest entry needed).
- **Upload** — a local world's card gets an "Upload to cloud" action while
  signed in: it creates an `sp-cloud` world row (account-level, no profile),
  links it via `WorldMeta.cloudId` (a local-manifest field, not part of the
  save format), and pushes the current save. The card then reads "☁ Synced".
- **On another device** — your `sp-cloud` saves you haven't downloaded yet
  appear under **Cloud Saves**; **Download** materializes a local world (linked
  by `cloudId`) and opens it, pulling the blob in.
- **Open** — a cloud-linked world reconciles first (`pullCloudSaveIfNewer`):
  the remote is adopted only when it advanced past this device's sync cursor,
  so a world you played offline keeps its newer local progress instead of being
  overwritten by an older cloud copy. Reuses GameShell's "Opening…" gate.
- **Save** — `useMinecraftGame` mirrors each local autosave/quit up to the
  cloud when the world is `cloudId`-linked and the player is signed in
  (fire-and-forget so the fetch survives the unmount).

## Playing online (client)

The account's per-profile world list (`OnlineWorldSelect`) shows owned and
joined online worlds plus the profile's singleplayer ones, creates new worlds
of either kind (same form as local worlds — the row lives in Postgres; the
game server hosts only the mp kind), and mints invite links (`/join/<token>`
— the landing page previews the world's name, asks the visitor to sign in or
register if they aren't, then accepts the membership; the world appears in
their account's world list). Playing an **online** one runs
`GameShell.playOnline`: `POST /api/worlds/:id/ticket` →
`connectNetworkSession(gameServerUrl, ticket)` → mount the game on the
session's replica engine. (A **singleplayer** world instead runs
`GameShell.playCloud` — the cloud-save reconcile above and a full local
engine, no ticket, no socket.) The connection lifecycle (chat, ping badge,
disconnect modal, leave) lives in the session + three HUD components
(`ChatPanel`, `ConnectionStatus`, `RosterPanel`); the architecture of the
replica/routing/interpolation stack is in
[architecture.md](architecture.md#multiplayer-client-libnet).

**Owner controls.** The `welcome` carries the recipient's `role` (from the
join ticket), exposed as `session.role`. `RosterPanel` lists everyone in the
world (top-right HUD) and, for the **owner** only, shows a Kick button per
other player — it sends a `kick` message that the server re-checks against the
sender's ticket role (a member's kick is dropped), reusing the same in-process
`Room.kick` as the admin endpoint. It renders above the pause overlay, so the
owner frees the cursor (Escape) and ejects a griefer without leaving. No
web→game admin bridge: the protocol path keeps the game server independent of
the web app (its only trust input is the signed ticket) — though the server
itself is stateful: live rooms exist only in its process memory (see
[Game server operations](#game-server-operations)).

Boarding works online (protocol v2): a mounted rider's position is
server-owned and streamed on the `SelfDelta` (`mountedVehicleId` + `x/y/z`),
so the replica stops predicting its own motion while mounted rather than
rubber-banding against the boat. Vehicles and in-flight arrows replicate on
their own tick channels (`vp`/`prj`), mirroring the mob-pose skeleton.

**The Nether works online (protocol v4).** A room simulates an engine per
active dimension ("shards"): the overworld always; the nether boots lazily on
the first portal travel (or a join whose save slice says nether) and is
persisted + dropped after `NETHER_SHARD_LINGER_MS` (default 60 s) once empty —
so the second engine's ~40 MB is the price of an _occupied_ nether, not a
visited-once one. Ignition is an ordinary networked `placeBlock`; dwell runs
server-side, and travel hands the player between shards, sending the traveler
`dim` + a fresh worldSync while everyone else gets `playerDim` (the roster's
"· Nether" tag, and a toast). The client rebuilds its replica and renderer
around the SAME live socket — no reconnect. Every tick channel is scoped to
the recipient's dimension; chat and the roster stay global. Mobs (pets
included) and vehicles are dimension state and stay behind; a mounted player
can't dwell; sleep skips the night when every **overworld** player is in bed.
Full wire details: [protocol.md](protocol.md), engine/room architecture:
[architecture.md](architecture.md#dimensions-swap-on-travel).

Progression is per-player: each player earns their own advancements/stats
(the engine attributes an emitted event to whoever's step/dispatch is running,
so a co-op room scores every player independently) and gets credit for their
own kills — melee, arrow, spear, or a pet's bite, tracked on the mob as
`lastHitByPlayer` so even a delayed sweep death (burn, explosion) credits the
right player. The `SelfDelta` syncs each client's advancement set and
event-driven stats (the two continuous display stats — play time, distance —
accrue client-side). Advancement toasts are tagged with the earning player, so
you only see your own. Pets follow **their owner**, not the nearest player.

## Environment & local development

See `.env.example` for every variable (web: `DATABASE_URL`,
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GAME_TICKET_SECRET`,
`NEXT_PUBLIC_GAME_SERVER_URL`; game server adds `PORT`, `PERSISTENCE`,
`ADMIN_TOKEN`).

```bash
docker compose up -d          # local Postgres (dev only — tests use PGlite)
bun run db:migrate            # apply db/migrations once
bun run dev                   # web app with accounts + API
bun run server                # game server (ws://localhost:8080)
```

Full co-op on localhost: run all three, open two browser windows (one
normal, one private — each registers its own account), create an online
world in the first, and paste its invite link into the second.

**No Docker at all**: `DATABASE_URL=pglite://memory` runs the web app on an
ephemeral in-process Postgres (`db/index.ts` applies the schema from
`db/ddl.ts` at boot; data lives as long as the process). Outside production
an **unset** `DATABASE_URL` falls back to exactly that (with a one-time
console notice), so a bare `bun run dev` boots the whole web/auth/cloud-save
stack with zero env config — better-auth accepts its built-in dev secret, so
`BETTER_AUTH_*` may stay unset too. Pair it with the game server's
`PERSISTENCE=memory` and the whole online stack is two commands with zero
services — exactly how the Playwright multiplayer suite boots it
(`playwright.config.ts`).

Schema lives in `db/schema.ts` (drizzle); migrations are generated with
`bunx drizzle-kit generate` and committed under `db/migrations/`. The PGlite
fixture (`db/testDb.ts`) applies the same DDL in-memory so `bun test` needs
no daemon; the auth integration test (`lib/auth/auth.test.ts`) runs the real
better-auth wiring against it, which keeps the fixture DDL, the schema
module, and the adapter honest against each other.

## Production

**[deploy.md](deploy.md) is the step-by-step first-time deploy runbook** (Neon
schema → Fly game server → Vercel web app, with a verify checklist and
troubleshooting). In short:

- **Vercel**: set the web env vars; point `DATABASE_URL` at Neon. The auth
  mount builds lazily, so `next build` needs no env.
- **Fly.io** (game server): shares `DATABASE_URL` and `GAME_TICKET_SECRET`
  with the web app (a mismatch on the latter = every join fails with close
  code 4000).

## Game server operations

`server/index.ts` (Bun, no build step — `bun server/index.ts`). One process
hosts up to `MAX_ROOMS` worlds; each room is an authoritative `GameEngine`
on the drift-corrected 20 Hz ticker. Rooms load from Postgres on first join,
persist every 60 s **while occupied** (and when an empty room still owes a
write), on last-leave, and on SIGTERM (deploys drain, ≤60 s loss crash-safe);
five idle minutes evicts a room from memory. See [protocol.md](protocol.md)
for the wire format.

Presence is the persist trigger, not the dirty flag. The flag is set by five
things — travel, nether-shard evict, join, leave, block-edit events — while a
live session also moves inventory, health, hunger, effects, XP, statistics,
advancements, mobs, containers and position, marking none of them; gating the
interval on it meant a crash could roll back a long session that happened to
involve no block edit. So the flag now only answers "does an EMPTY room still
owe a write". Stores **coalesce** — one in flight, at most one follow-up queued
— because composing and gzipping a world is expensive and `storeWorld` has no
version guard, so overlapping writes race and the older can land last. The flag
clears against the snapshot actually composed (a mutation mid-write stays
dirty), and a failed write re-marks the room rather than dropping the state.

**Single instance, by design.** Rooms live in the process's memory
(`server/roomRegistry.ts`) with no cross-instance coordination — Postgres holds
world _saves_, not live rooms. Run **exactly one** game-server instance:
behind a load balancer, a second instance loads its own independent copy of a
world on first join, silently splitting that world's players across copies
(each connects fine and sees "Players (1)"). On Fly that means
`fly scale count 1` — `fly launch` defaults to a two-machine HA pair, and
`min_machines_running = 1` is a floor, not a cap (see
[deploy.md](deploy.md#step-2--game-server-flyio)). Scaling _up_ means a bigger
machine or real room affinity (route by world id), not replicas.

All admin endpoints require `Authorization: Bearer $ADMIN_TOKEN` (absent
`ADMIN_TOKEN` = always 403):

- `GET /health` — liveness (Fly checks hit this); unauthenticated.
- `GET /rooms` — per-room diagnostics: players, tick, `slowestTickMs`
  (against the 50 ms budget), and `kbOutPerSec` (downstream bandwidth). Watch
  these to set `MAX_ROOMS`.
- `GET /rooms/:id/log` — the room's rolling replay log (recent commands with
  their claimed eye pose + per-second pose anchors, `COMMAND_LOG_SIZE`
  entries). Feed a dump to `bun scripts/replay.ts dump.json` to reconstruct
  the command-driven state offline (edits/inventory/movement — mobs aren't
  reproduced; the live RNG is unseeded).
- `POST /rooms/:id/kick/:playerId` — eject a player (fatal `4003`, no retry).

`PERSISTENCE=memory` runs with no database — local iteration, the Playwright
multiplayer spec, and the two CLI clients: `bun scripts/netProbe.ts` (one
client, joins/walks/tallies) and `bun scripts/loadSim.ts <url> <world> <N>
<seconds>` (N synthetic clients → server tick p95 + bandwidth, for capacity
tuning). Both mint their own ticket, so `GAME_TICKET_SECRET` must match; give
`loadSim` `ADMIN_TOKEN` too for the server-side stats.

### Runbook

- **A player is stuck / griefing.** The world owner revokes shared invite
  links from the menu ("Revoke links" on the world card — kills every
  outstanding link at once; existing members keep access). To force a live
  player out, `POST /rooms/:id/kick/:playerId`.
- **A redeploy.** SIGTERM drains every room (persist + close with `4005`);
  clients reconnect on the ladder to the new instance and re-sync. Loss is
  bounded to the last 60 s (the persist interval) even on a hard crash.
- **"How did this happen?"** Pull `/rooms/:id/log`, then `bun scripts/replay.ts`
  to replay the command stream against a fresh engine and diff the outcome.
- **Latency feels bad.** From a browser console, `window.__monecraft.net`
  `.setSimulatedLatency(ms, jitterMs?)` injects delay (± jitter) to reproduce;
  set `NEXT_PUBLIC_NET_SIM_LATENCY_MS` / `NEXT_PUBLIC_NET_SIM_JITTER_MS` to
  bake it into a dev build. The F3 overlay shows live net stats.
- **Capacity.** Run `loadSim` at the target player count and watch
  `slowestTickMs`/`kbOutPerSec` in `/rooms`; keep p95 well under 50 ms and set
  `MAX_ROOMS` so peak memory fits the machine: ~40 MB per dimension engine
  (headless engines skip the renderer-only light cache), so a room is ~40 MB
  with an idle nether and ~80 MB while one is occupied (the empty-shard
  linger-evict returns the difference). Net constants
  (deadbands, keyframe/persist intervals, reconnect ladder) live in
  [tuning.md](tuning.md#multiplayer-networking).

Deploy: `server/Dockerfile` + `server/fly.toml` (see file comments). The
container is platform-neutral — anything that runs a long-lived container
with WebSocket ingress works.
