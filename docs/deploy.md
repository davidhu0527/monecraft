# Deploying online multiplayer

A first-time deploy runbook for the online stack. **Single-player needs none of
this** — it runs entirely in the browser with localStorage and never touches the
network. Only online co-op (accounts, cloud saves, shared worlds) needs a server;
this page is how to stand that up.

For _how the stack fits together_ see [online.md](online.md); for _operating_ a
running deployment (kick, revoke, replay, redeploys, capacity) see the
[ops runbook](online.md#runbook).

## The shape of it

Three managed pieces, sharing a database and one secret:

```
        Vercel (Next app + better-auth + /api)  ─┐
Browser ┤                                         ├─ Neon Postgres (accounts, worlds, saves)
        └ Fly.io (Bun game server, WebSocket) ───┘
                    ▲
        share the SAME DATABASE_URL and a byte-identical GAME_TICKET_SECRET
```

- **Vercel** hosts the Next.js app: menus, better-auth, and the `/api` routes
  (worlds, invites, cloud saves, join tickets).
- **Neon** (or any Postgres) holds accounts, world rows, memberships, invites,
  and gzipped save blobs.
- **Fly.io** runs the authoritative Bun game server (`server/`) — the long-lived
  WebSocket world rooms. It's on Fly and **not** Vercel because serverless
  functions can't hold persistent WebSockets; that split is deliberate.

The only runtime link between Vercel and Fly is the **join ticket**: the web API
mints a 60-second HS256 token, the game server verifies it with the shared
`GAME_TICKET_SECRET`. They never call each other directly.

## Prerequisites

- Accounts on [Vercel](https://vercel.com), [Neon](https://neon.tech) (or another
  Postgres provider), and [Fly.io](https://fly.io).
- The [Fly CLI](https://fly.io/docs/flyctl/install/) (`fly`) and optionally the
  [Vercel CLI](https://vercel.com/docs/cli) (`vercel`).
- `bun` locally (to run the one migration).

## Secrets to generate up front

Generate these once and keep them handy — several are shared:

```bash
openssl rand -base64 32   # BETTER_AUTH_SECRET (web only)
openssl rand -base64 32   # GAME_TICKET_SECRET (web AND game server — must match)
openssl rand -base64 24   # ADMIN_TOKEN (game server only; guards /rooms* admin endpoints)
```

> **The #1 misconfiguration:** if `GAME_TICKET_SECRET` differs between Vercel and
> Fly, _every_ join fails with WebSocket close code **4000** (bad ticket). Set the
> exact same value in both.

## Step 1 — Database (Neon)

1. Create a Neon project and copy its pooled connection string (it looks like
   `postgres://user:pass@…neon.tech/db?sslmode=require`). This is `DATABASE_URL`.
2. Apply the schema (runs the committed `db/migrations/0000_online-foundation.sql`):

   ```bash
   DATABASE_URL='postgres://…neon.tech/…?sslmode=require' bun run db:migrate
   ```

   Migrations are generated from `db/schema.ts` and committed under
   `db/migrations/`; `bun run db:migrate` (drizzle-kit) is the only step that
   needs a live database. Re-run it after any future schema change lands.

## Step 2 — Game server (Fly.io)

Run from the **repo root**. The commands are also in `server/fly.toml`'s header.

```bash
fly launch --config server/fly.toml --dockerfile server/Dockerfile --no-deploy
fly secrets set \
  DATABASE_URL='postgres://…neon.tech/…?sslmode=require' \
  GAME_TICKET_SECRET='…the shared secret…' \
  ADMIN_TOKEN='…admin token…' \
  --config server/fly.toml
fly deploy --config server/fly.toml --dockerfile server/Dockerfile
fly scale count 1 --config server/fly.toml
```

The `fly scale count 1` is **not optional**: `fly launch` provisions a
two-machine HA pair by default, but rooms live in one process's memory
(`server/roomRegistry.ts` — no cross-instance coordination), so the app must run
**exactly one machine**. With two, Fly's edge load-balances each WebSocket
independently and players in the same world get split across two independent
copies of the room — everyone connects "successfully" and everyone is alone
(see [Troubleshooting](#troubleshooting)). Confirm with
`fly machine list --config server/fly.toml` → exactly one machine.

`server/fly.toml` already pins the rest of the important bits: a single region
(set `primary_region` to one near your players — it can't pin the machine
_count_, which is runtime state, hence the explicit scale step), **always
on** (`min_machines_running = 1`, `auto_stop_machines = "off"` — a room must keep
ticking while players are in it), a `/health` check, `PERSISTENCE = "postgres"`,
`MAX_ROOMS = 3`, and a 512 MB VM — rooms are ~74 MB each, so memory and
`MAX_ROOMS` scale **together** (6 rooms needs ~1 GB; resize with
`fly scale memory`, then raise the env). SIGTERM on a redeploy
drains every room to Postgres first, so a deploy loses at most the last 60 s
(the dirty-persist interval), crash-safe.

The app name in `fly.toml` is `monecraft-server`, so its URL is
`https://monecraft-server.fly.dev` — the browser connects over **`wss://`**
(`force_https` is on). Rename the app if you like, but then update the web app's
`NEXT_PUBLIC_GAME_SERVER_URL` to match.

Confirm it's up:

```bash
curl https://monecraft-server.fly.dev/health   # → {"ok":true,"rooms":0}
```

## Step 3 — Web app (Vercel)

Import the repo in the Vercel dashboard (or `vercel --prod` from the repo root),
then set these environment variables (see `.env.example` for the full list):

| Variable                      | Value                                                   |
| ----------------------------- | ------------------------------------------------------- |
| `DATABASE_URL`                | the **same** Neon string as the game server             |
| `BETTER_AUTH_SECRET`          | your `openssl rand` output                              |
| `BETTER_AUTH_URL`             | the deployed origin, e.g. `https://mc.ainaive.com`      |
| `GAME_TICKET_SECRET`          | the **same** shared secret as the game server           |
| `NEXT_PUBLIC_GAME_SERVER_URL` | `wss://monecraft-server.fly.dev` (note **wss**, not ws) |

`next build` won't _fail_ on a missing var (the auth mount and DB connection are
both lazy — a missing server-side var surfaces at runtime instead). But
`NEXT_PUBLIC_GAME_SERVER_URL` is the exception: it's **inlined into the client
bundle at build time**, so it must be set in the Vercel project **before** the
build runs, or online play ships pointing at nothing (single-player still works).
Set all five in Vercel before the first deploy, then double-check them.

> **Ordering / chicken-and-egg:** `BETTER_AUTH_URL` is your Vercel origin and
> `NEXT_PUBLIC_GAME_SERVER_URL` is your Fly origin, so each side wants the other's
> URL. Both hostnames are predictable (`<project>.vercel.app`,
> `<app>.fly.dev`), so set them up front. If you use a custom domain, set the env
> var to the final URL and redeploy the web app once DNS is live. `NEXT_PUBLIC_*`
> vars are inlined at build time — changing one needs a **redeploy**, not just an
> env edit.

### Custom domain

The production app runs at **`mc.ainaive.com`**. To point a custom domain at the
Vercel project:

1. **Vercel → Settings → Domains** → add `mc.ainaive.com` and mark it the
   **primary / production** domain.
2. **DNS** at the domain's provider: add a `CNAME` record `mc` →
   `cname.vercel-dns.com` (use the exact target the dashboard shows). Vercel
   auto-issues the TLS certificate once the record resolves.
3. **Redirect the old domain**: set the previous `<project>.vercel.app` domain to
   **Redirect to** `mc.ainaive.com` (308, path-preserving) so a single canonical
   origin matches `BETTER_AUTH_URL` and already-shared `.../join/<token>` invite
   links keep working.
4. Set **Production** `BETTER_AUTH_URL` to `https://mc.ainaive.com` and **redeploy**
   (it's read at runtime, but a redeploy is the clean path — see the note above).
   Sign-in hangs if this doesn't match the serving origin.

`NEXT_PUBLIC_GAME_SERVER_URL` is **unchanged** by a web-domain switch — it points at
the Fly game server (`wss://…fly.dev`), which does no Origin/CORS check (admission is
the signed join ticket), so nothing on the server side needs updating. Invite links,
the auth client, and the service-worker cache scope all derive their origin from the
browser at runtime, so they follow the new domain automatically.

## Verify the whole thing

1. `curl https://<fly-app>.fly.dev/health` → `{"ok":true,…}`.
2. Open the deployed web app. It should look and play exactly like single-player
   (offline-first: no account, no network until you go online).
3. Click **Sign in** on the welcome screen, register an account ("I need an account"), and
   confirm it reads "Signed in as …" and opens the account home — that proves
   Vercel ↔ Neon ↔ better-auth work.
4. Create an online profile, a **New Online World**, then **Copy invite**. Open
   the link in a second browser (or a private window), register there, and play
   the world from its card ("Joined"). Both players seeing each other proves the
   join ticket + Fly game server work.

If step 3 fails, it's the web/DB side (auth or `DATABASE_URL`). If step 4 connects
as far as "Joining…" then errors, it's almost always the ticket secret or the
game-server URL — see below.

## Updating a running deployment

- **Web app:** push to the branch Vercel tracks (or `vercel --prod`). Changing a
  `NEXT_PUBLIC_*` value requires a redeploy, not just an env edit.
- **Game server:** `bun run deploy:server` (from the repo root — it wraps
  `fly deploy --config server/fly.toml --dockerfile server/Dockerfile`).
  Rooms drain to Postgres on the rollout; connected clients reconnect on their
  back-off ladder and re-sync (they'll see a brief "Reconnecting…" badge).
  **Never run a bare `fly deploy`**: there is no Dockerfile at the repo root, so
  flyctl's framework scanner generates a Next.js web-app image (`bun run start`,
  port 3000) and ships _that_ to the game-server app — it crash-loops with
  exit 127 (`next` needs `node`, absent from the `oven/bun` base) and takes
  online play down until a correct redeploy.
- **Schema change:** land the new migration, then run `bun run db:migrate`
  against production **before** deploying the code that depends on it —
  **unless the migration removes something the old code reads** (a dropped
  column, like `0003`'s `is_anonymous`): then deploy the new code first and
  migrate second, since the old build would error on the missing column while
  the new build just ignores it until the migration lands.

## Troubleshooting

| Symptom                                                                   | Cause                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Join fails, close code **4000**                                           | `GAME_TICKET_SECRET` differs between Vercel and Fly — the #1 issue.                                                                                                                           |
| "could not get a join ticket"                                             | `NEXT_PUBLIC_GAME_SERVER_URL` unset, or the world isn't a `mp` world.                                                                                                                         |
| Connects then instantly drops                                             | Wrong scheme — must be **`wss://`** (not `ws://`) against an https Fly app.                                                                                                                   |
| 500s on any `/api/worlds*`                                                | `DATABASE_URL` wrong, or the migration wasn't applied (Step 1).                                                                                                                               |
| Sign-in hangs                                                             | `BETTER_AUTH_URL` doesn't match the actual origin, or `BETTER_AUTH_SECRET` unset.                                                                                                             |
| Game server won't boot                                                    | Missing `GAME_TICKET_SECRET` (it exits on start) or an unreachable `DATABASE_URL`.                                                                                                            |
| Players in the same world can't see each other — each shows "Players (1)" | More than one Fly machine (rooms are per-process; each machine hosts its own copy). Check `fly machine list --config server/fly.toml`; fix with `fly scale count 1 --config server/fly.toml`. |

Admin diagnostics on the game server (all behind `Authorization: Bearer $ADMIN_TOKEN`):
`GET /rooms` (players, tick p95, bandwidth), `GET /rooms/:id/log` (replay dump).
See the [ops runbook](online.md#runbook) for using them.

## Other hosts

The game server is a plain Docker container that speaks HTTP `/health` and reads
env vars, so it's portable — **Railway**, **Render**, **Fly**, or any VPS that
runs a long-lived container with WebSocket ingress works. Swap `server/fly.toml`
for that platform's config; keep the container always-on (a room must keep ticking),
run **exactly one instance** (rooms are in-process — replicas or autoscaling split
players in the same world into separate room copies), and give it the same
`DATABASE_URL` + `GAME_TICKET_SECRET`. Cloudflare Durable
Objects were ruled out (128 MB memory cap vs ~74 MB rooms, workerd runtime).

For local development of the full stack (no cloud, no Docker), see
[online.md](online.md#environment--local-development).
