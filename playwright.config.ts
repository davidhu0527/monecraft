import { defineConfig, devices } from "@playwright/test";

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
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 60000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure"
  },
  // channel "chromium" runs the full browser in new-headless mode: the default
  // headless shell rejects requestPointerLock (WrongDocumentError).
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chromium" } }],
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
        GAME_TICKET_SECRET: "e2e-ticket-secret"
      }
    }
  ]
});
