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
```

`server/fly.toml` already pins the important bits: one region (`nrt`), **always
on** (`min_machines_running = 1`, `auto_stop_machines = "off"` — a room must keep
ticking while players are in it), a `/health` check, `PERSISTENCE = "postgres"`,
`MAX_ROOMS = 6`, and a 2 GB VM (rooms are ~74 MB each). SIGTERM on a redeploy
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

| Variable                      | Value                                                    |
| ----------------------------- | -------------------------------------------------------- |
| `DATABASE_URL`                | the **same** Neon string as the game server              |
| `BETTER_AUTH_SECRET`          | your `openssl rand` output                               |
| `BETTER_AUTH_URL`             | the deployed origin, e.g. `https://monecraft.vercel.app` |
| `GAME_TICKET_SECRET`          | the **same** shared secret as the game server            |
| `NEXT_PUBLIC_GAME_SERVER_URL` | `wss://monecraft-server.fly.dev` (note **wss**, not ws)  |

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

## Verify the whole thing

1. `curl https://<fly-app>.fly.dev/health` → `{"ok":true,…}`.
2. Open the deployed web app. It should look and play exactly like single-player
   (offline-first: no account, no network until you go online).
3. Click **Play online as guest** (profile screen → Account panel). It should say
   "Playing as guest" — that proves Vercel ↔ Neon ↔ better-auth work.
4. Create a **New Online World**, then **Copy invite**. Open the link in a second
   browser (or a private window), accept, and play the world from its card. Both
   players seeing each other proves the join ticket + Fly game server work.

If step 3 fails, it's the web/DB side (auth or `DATABASE_URL`). If step 4 connects
as far as "Joining…" then errors, it's almost always the ticket secret or the
game-server URL — see below.

## Updating a running deployment

- **Web app:** push to the branch Vercel tracks (or `vercel --prod`). Changing a
  `NEXT_PUBLIC_*` value requires a redeploy, not just an env edit.
- **Game server:** `fly deploy --config server/fly.toml --dockerfile server/Dockerfile`.
  Rooms drain to Postgres on the rollout; connected clients reconnect on their
  back-off ladder and re-sync (they'll see a brief "Reconnecting…" badge).
- **Schema change:** land the new migration, then run `bun run db:migrate`
  against production **before** deploying the code that depends on it.

## Troubleshooting

| Symptom                         | Cause                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| Join fails, close code **4000** | `GAME_TICKET_SECRET` differs between Vercel and Fly — the #1 issue.                |
| "could not get a join ticket"   | `NEXT_PUBLIC_GAME_SERVER_URL` unset, or the world isn't a `mp` world.              |
| Connects then instantly drops   | Wrong scheme — must be **`wss://`** (not `ws://`) against an https Fly app.        |
| 500s on any `/api/worlds*`      | `DATABASE_URL` wrong, or the migration wasn't applied (Step 1).                    |
| Guest sign-in hangs             | `BETTER_AUTH_URL` doesn't match the actual origin, or `BETTER_AUTH_SECRET` unset.  |
| Game server won't boot          | Missing `GAME_TICKET_SECRET` (it exits on start) or an unreachable `DATABASE_URL`. |

Admin diagnostics on the game server (all behind `Authorization: Bearer $ADMIN_TOKEN`):
`GET /rooms` (players, tick p95, bandwidth), `GET /rooms/:id/log` (replay dump).
See the [ops runbook](online.md#runbook) for using them.

## Other hosts

The game server is a plain Docker container that speaks HTTP `/health` and reads
env vars, so it's portable — **Railway**, **Render**, **Fly**, or any VPS that
runs a long-lived container with WebSocket ingress works. Swap `server/fly.toml`
for that platform's config; keep the container always-on (a room must keep ticking)
and give it the same `DATABASE_URL` + `GAME_TICKET_SECRET`. Cloudflare Durable
Objects were ruled out (128 MB memory cap vs ~74 MB rooms, workerd runtime).

For local development of the full stack (no cloud, no Docker), see
[online.md](online.md#environment--local-development).
