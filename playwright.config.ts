import { defineConfig, devices } from "@playwright/test";

/** Shared browser setup for every project (see the projects comment below). */
const CHROMIUM = {
  ...devices["Desktop Chrome"],
  channel: "chromium",
  launchOptions: {
    args: ["--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding"]
  }
};

/**
 * E2E smoke tests run against the production build (next start) — the dev
 * server's React StrictMode double-mounts the game engine and would make
 * runs slower and noisier.
 *
 * Files are named *.e2e.ts (NOT *.test.ts / *.spec.ts) so `bun test` does not
 * try to execute them with its own runner.
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  // Two workers, file-level parallelism only (fullyParallel stays false): a
  // parallel-safety audit cleared every spec file for concurrent execution —
  // distinct signup-email prefixes per file, account-scoped /api/worlds, only
  // two room-consuming files against the game server's room cap, per-context
  // storage/service worker, no cross-file ordering. New spec files must keep
  // those invariants (see docs/testing.md).
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // No retries, on CI too: fail is fail, success is success. Retries were a
  // stopgap walked 3→2 as the two-browser specs were made deterministic; a
  // retry-only pass masks a flake as green. Every remaining flake must be fixed
  // at the root (the specs' own deflake history — throttling args, chained
  // projects, pose-settle gates, an actual engine bug in 4b4d58d — is that
  // policy applied). A rare genuine runner one-off is a re-run, not a retry.
  retries: 0,
  workers: 2,
  // The list reporter runs on CI too: the github reporter records no per-spec
  // durations, which makes slow-suite diagnosis needlessly blind.
  reporter: process.env.CI ? [["github"], ["list"], ["html", { open: "never" }]] : "list",
  timeout: 60000,
  use: {
    baseURL: "http://localhost:3000",
    // No trace. With retries: 0 there is no retry for "on-first-retry" to fire
    // on, and "retain-on-failure" would record continuously for EVERY test
    // (discarding on pass) — the CPU tax that, on this software-GL runner,
    // starved the rAF-driven light specs (touch, mining) into 60 s timeouts.
    // Failures still get Playwright's auto error-context page snapshot at no
    // continuous cost; enable a trace ad hoc (locally, or a throwaway CI edit)
    // when one is genuinely needed.
    trace: "off"
  },
  // channel "chromium" runs the full browser in new-headless mode: the default
  // headless shell rejects requestPointerLock (WrongDocumentError).
  //
  // The no-throttling args are load-bearing for the two-browser multiplayer
  // specs: they assert on a "witness" page's replica while the other page
  // holds focus (bringToFront), and Chromium throttles rAF in backgrounded/
  // occluded pages — a throttled witness stops applying server ticks, so
  // confirmations that pass in seconds locally starve on the CI runner.
  //
  // Three CHAINED projects so the two heavy two-browser specs never overlap —
  // each runs two live software-GL game pages, and four at once starve the
  // rAF-driven client streams (mining, poses, predictions) into flaking even
  // on a fast machine. The light majority still gets both workers; each heavy
  // spec then runs on an otherwise idle machine. To run one heavy spec alone
  // without its dependency chain: `bunx playwright test <file> --no-deps`.
  projects: [
    {
      name: "light",
      testIgnore: ["**/multiplayer.e2e.ts", "**/nether-online.e2e.ts"],
      use: CHROMIUM
    },
    {
      name: "heavy-multiplayer",
      testMatch: "**/multiplayer.e2e.ts",
      dependencies: ["light"],
      use: CHROMIUM
    },
    {
      name: "heavy-nether",
      testMatch: "**/nether-online.e2e.ts",
      dependencies: ["heavy-multiplayer"],
      use: CHROMIUM
    }
  ],
  webServer: [
    {
      // The web app with a full online stack and ZERO external services: an
      // ephemeral in-process Postgres (pglite://) backs accounts/worlds, and
      // the game server below is where its join tickets point.
      command: "bun run build && bun run start",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 180000,
      env: {
        DATABASE_URL: "pglite://memory",
        BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret",
        BETTER_AUTH_URL: "http://localhost:3000",
        GAME_TICKET_SECRET: "e2e-ticket-secret",
        NEXT_PUBLIC_GAME_SERVER_URL: "ws://localhost:18080"
      }
    },
    {
      // The game server, database-free (rooms persist in memory for the run).
      command: "bun server/index.ts",
      url: "http://localhost:18080/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60000,
      env: {
        PORT: "18080",
        PERSISTENCE: "memory",
        GAME_TICKET_SECRET: "e2e-ticket-secret",
        // Headroom over the default 6: with two workers, both room-consuming
        // spec files can hold a live room at once, and an emptied room lingers
        // up to the 5-minute idle-eviction window before it frees its slot.
        MAX_ROOMS: "8"
      }
    }
  ]
});
