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
  webServer: {
    command: "bun run build && bun run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180000
  }
});
