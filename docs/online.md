# Online: accounts, cloud saves, multiplayer

How the online stack fits together, and how to run it. The offline
single-player game needs **none** of this: without an online action, the
client never makes an auth request (the `minecraft_online_v1` localStorage
flag gates even the session check).

## The pieces

```
Browser ──(cookies)── Next.js app          ── Neon/Postgres
   │                   /api/auth/*   better-auth (guests + accounts)
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

## Identity: guests first

- "Play online as guest" (menu → Account panel) creates a real better-auth
  user with `isAnonymous` — no form, instant play. Guests own worlds and
  memberships like anyone else.
- Upgrading (sign-up, or sign-in to an existing account, while holding the
  guest session) triggers the anonymous plugin's `onLinkAccount` hook
  (`lib/auth/server.ts`): worlds, memberships, and invites re-parent onto the
  new account before the guest row is deleted. **This hook is the "guests
  keep their worlds" promise** — `lib/auth/auth.test.ts` proves it against
  the real better-auth flow on real SQL (PGlite), including the
  duplicate-membership collision case.
- Sessions are better-auth cookies; the game server never sees them.
- The Account panel renders on the profile-select screen **and on the
  first-run create-profile screen** (`components/menu/ProfileSelect.tsx`), so
  sign in / register is reachable before any local profile exists; a guest can
  **Sign out** back to the offline/login state.
- When signed in as a real account the menu opens into an **account home**
  (`components/menu/AccountProfileSelect.tsx`) listing that account's
  server-side profiles (create/rename/delete, capped at `MAX_ONLINE_PROFILES`);
  picking one shows its online worlds (`OnlineWorldSelect`, capped at
  `MAX_WORLDS_PER_PROFILE`), and the join ticket carries the profile's name/skin.
  Logged-out **Local Players** stay on the browser-local profile flow. (Guests
  still reach online play via the legacy path pending the guest-layer retirement.)

## Worlds, invites, cloud saves

`lib/online/worldsService.ts` owns the rules (membership-gated reads that
present as `not-found` so ids can't be probed; owner-gated rename/delete/
invite; idempotent invite acceptance with expiry/max-uses). The `app/api`
routes are thin HTTP adapters over it.

Single-player cloud saves are gzipped `SaveData` blobs (`lib/game/
cloudSaves.ts` — block diffs compress extremely well) with last-write-wins
concurrency: each device sends the `updatedAt` stamp it last saw
(`x-base-updated-at`); a mismatch is **409** and the pushing client stops
syncing and warns (rather than clobber the other device), then adopts the
newer save on the next open.

**How it flows through the menu** (all opt-in per world):

- **Upload** — a local world's card gets an "Upload to cloud" action once
  you've gone online: it creates an `sp-cloud` world row, links it via
  `WorldMeta.cloudId` (a local-manifest field, not part of the save format),
  and pushes the current save. The card then reads "☁ Synced".
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

The menu's **Online Worlds** section (`WorldSelect`) lists every world the
signed-in user may play, creates new ones (same form as local worlds — the
row lives in Postgres, the game server hosts it), and mints invite links
(`/join/<token>` — the landing page resolves the token, signs the visitor in
as a guest if needed, and accepts the membership). Playing one runs
`GameShell.playOnline`: ensure a session → `POST /api/worlds/:id/ticket` →
`connectNetworkSession(gameServerUrl, ticket)` → mount the game on the
session's replica engine. The connection lifecycle (chat, ping badge,
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
web→game admin bridge: the protocol path keeps the game server stateless.

Boarding works online (protocol v2): a mounted rider's position is
server-owned and streamed on the `SelfDelta` (`mountedVehicleId` + `x/y/z`),
so the replica stops predicting its own motion while mounted rather than
rubber-banding against the boat. Vehicles and in-flight arrows replicate on
their own tick channels (`vp`/`prj`), mirroring the mob-pose skeleton.

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
normal, one private — separate guest identities), create an online world in
the first, and paste its invite link into the second.

**No Docker at all**: `DATABASE_URL=pglite://memory` runs the web app on an
ephemeral in-process Postgres (`db/index.ts` applies the schema from
`db/ddl.ts` at boot; data lives as long as the process). Pair it with the
game server's `PERSISTENCE=memory` and the whole online stack is two
commands with zero services — exactly how the Playwright multiplayer suite
boots it (`playwright.config.ts`).

Schema lives in `db/schema.ts` (drizzle); migrations are generated with
`bunx drizzle-kit generate` and committed under `db/migrations/`. The PGlite
fixture (`db/testDb.ts`) applies the same DDL in-memory so `bun test` needs
no daemon; the auth integration test exercises every table, which keeps the
fixture DDL and the schema module honest against each other.

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
persist every 60 s (when dirty), on last-leave, and on SIGTERM (deploys
drain, ≤60 s loss crash-safe); five idle minutes evicts a room from memory.
See [protocol.md](protocol.md) for the wire format.

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
  bounded to the last 60 s (the dirty-persist interval) even on a hard crash.
- **"How did this happen?"** Pull `/rooms/:id/log`, then `bun scripts/replay.ts`
  to replay the command stream against a fresh engine and diff the outcome.
- **Latency feels bad.** From a browser console, `window.__monecraft.net`
  `.setSimulatedLatency(ms)` injects delay to reproduce; set
  `NEXT_PUBLIC_NET_SIM_LATENCY_MS` to bake it into a dev build.
- **Capacity.** Run `loadSim` at the target player count and watch
  `slowestTickMs`/`kbOutPerSec` in `/rooms`; keep p95 well under 50 ms and set
  `MAX_ROOMS` so peak memory (~74 MB/room) fits the machine. Net constants
  (deadbands, keyframe/persist intervals, reconnect ladder) live in
  [tuning.md](tuning.md#multiplayer-networking).

Deploy: `server/Dockerfile` + `server/fly.toml` (see file comments). The
container is platform-neutral — anything that runs a long-lived container
with WebSocket ingress works.
