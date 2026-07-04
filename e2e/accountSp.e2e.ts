import { expect, test, type Page } from "@playwright/test";

/**
 * Account-mode singleplayer, across devices: register an account, create a
 * singleplayer world under an online profile, prove it runs WITHOUT the game
 * server (no net session), edit and quit (the save pushes to the account
 * blob), then sign in from a completely fresh browser context — the "other
 * computer" — and continue the same world with the edit intact.
 *
 * Runs against the pglite webServer stack; the Bun game server is up but must
 * never be touched by this journey.
 */

function watchErrors(page: Page, sink: string[]): void {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text().includes("Failed to load resource")) {
      const url = message.location().url;
      if (url.endsWith("/favicon.ico")) return;
      // Opening a freshly created singleplayer world probes the cloud blob
      // before the first push exists; the route's 404 ("no-save") is the
      // by-design answer, but the browser still logs the failed fetch.
      if (/\/api\/worlds\/[^/]+\/save$/.test(url)) return;
    }
    sink.push(`${message.text()} (${message.location().url})`);
  });
  page.on("pageerror", (error) => sink.push(String(error)));
}

/** Booted and drawing (single-player: no `net`). */
async function waitForGame(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__monecraft !== undefined, undefined, { timeout: 30000 });
  await page.waitForFunction(() => window.__monecraft!.renderer.renderedTriangles() > 0, undefined, { timeout: 30000 });
}

test("an account singleplayer world plays offline-style and follows the account to a fresh device", async ({ browser }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  // Unique per attempt: the pglite webServer keeps its data across retries
  // within one run, and a re-registered email fails with "already exists".
  const email = `roamer-${Date.now().toString(36)}@example.com`;
  const password = "hunter2hunter2";

  // ── device A: register → profile → singleplayer world ────────────────────
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  try {
    const a = await contextA.newPage();
    watchErrors(a, errors);
    await a.goto("/");

    await a.getByRole("button", { name: "Sign in", exact: true }).click();
    await a.getByRole("button", { name: "I need an account" }).click();
    await a.getByLabel("Email").fill(email);
    await a.getByLabel("Display name").fill("Roamer");
    await a.getByLabel("Password").fill(password);
    await a.getByRole("button", { name: "Create account" }).click();

    await expect(a.getByText("Online Profiles")).toBeVisible({ timeout: 15000 });
    await a.getByTestId("new-online-profile").click();
    await a.getByLabel("Profile name").fill("Solo");
    await a.getByRole("button", { name: "Create", exact: true }).click();

    await a.getByTestId("new-sp-world").click();
    await a.getByLabel("World name").fill("Cloud Base");
    await a.getByLabel("World seed").fill("7777");
    await a.getByRole("button", { name: "Create World" }).click();
    await waitForGame(a);

    // The whole point: a singleplayer world never opens a game-server session.
    expect(await a.evaluate(() => window.__monecraft!.net == null)).toBe(true);

    // A distinctive edit: a Stone block placed in mid-air (nothing generates
    // there, so finding it later can only come from the synced save).
    const marker = await a.evaluate(() => {
      const state = window.__monecraft!.engine.state;
      const x = Math.floor(state.player.position.x);
      const z = Math.floor(state.player.position.z);
      const y = Math.floor(state.player.position.y) + 3;
      const before = state.world.get(x, y, z);
      state.blockChanges.set(x, y, z, 3); // 3 = Stone
      return { x, y, z, before };
    });
    expect(marker.before).toBe(0);

    // Save & Quit unmounts the game; the unmount sync pushes the blob up.
    await a.keyboard.press("Escape");
    await a.getByRole("button", { name: "Save & Quit to Worlds" }).click();
    await expect(a.getByText("Cloud Base")).toBeVisible({ timeout: 15000 });

    // Don't leave device A until the push actually landed server-side.
    const worldId = await a.evaluate(async () => {
      const response = await fetch("/api/worlds");
      const { worlds } = (await response.json()) as { worlds: Array<{ id: string; kind: string }> };
      return worlds.find((world) => world.kind === "sp-cloud")!.id;
    });
    await expect.poll(async () => a.evaluate(async (id) => (await fetch(`/api/worlds/${id}/save`)).status, worldId), { timeout: 15000 }).toBe(200);

    // ── device B: fresh context, same account — the world follows ──────────
    const b = await contextB.newPage();
    watchErrors(b, errors);
    await b.goto("/");

    await b.getByRole("button", { name: "Sign in", exact: true }).click();
    await b.getByLabel("Email").fill(email);
    await b.getByLabel("Password").fill(password);
    await b.getByRole("button", { name: "Sign in" }).click(); // the form's submit

    // The profile itself synced too — enter it and the world is waiting.
    await expect(b.getByText("Online Profiles")).toBeVisible({ timeout: 15000 });
    await b.getByRole("button", { name: "Solo" }).click();
    const card = b.getByTestId(`cloud-sp-${worldId}`);
    await expect(card).toContainText("Singleplayer · synced");
    await card.click();
    await waitForGame(b);

    expect(await b.evaluate(() => window.__monecraft!.net == null)).toBe(true);
    const after = await b.evaluate((m) => window.__monecraft!.engine.state.world.get(m.x, m.y, m.z), marker);
    expect(after, "the Stone marker placed on device A survived to device B").toBe(3);

    expect(errors, "no console/page errors during the test").toEqual([]);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
