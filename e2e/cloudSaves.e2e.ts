import { expect, test, type Page } from "@playwright/test";

/**
 * The single-player cloud-save round-trip through the WorldSelect menu, against
 * the real online stack (the Next app on DATABASE_URL=pglite://memory — no game
 * server needed; cloud saves are the /api/worlds blob API, not a WS session).
 *
 * A signed-in ACCOUNT steps through the "Play locally" door, uploads a local
 * world, then downloads it "on another device" — simulated in one context by
 * clearing this device's sync cursor. The proof is that a distinctive edit
 * made before the upload survives the push → delete → pull cycle.
 */

function watchErrors(page: Page, sink: string[]): void {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text().includes("Failed to load resource") && message.location().url.endsWith("/favicon.ico")) return;
    sink.push(`${message.text()} (${message.location().url})`);
  });
  page.on("pageerror", (error) => sink.push(String(error)));
}

/** Booted and drawing (single-player: no `net`). */
async function waitForGame(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__monecraft !== undefined, undefined, { timeout: 30000 });
  await page.waitForFunction(() => window.__monecraft!.renderer.renderedTriangles() > 0, undefined, { timeout: 30000 });
}

test("a single-player world uploads to the cloud and downloads onto a fresh device", async ({ browser }) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    watchErrors(page, errors);

    // Seed a profile for the local-worlds half of the journey (sign-in itself
    // starts at the welcome gate — no local profile needed for it).
    await page.addInitScript(() => {
      if (!localStorage.getItem("minecraft_profiles_v1")) {
        localStorage.setItem(
          "minecraft_profiles_v1",
          JSON.stringify({ version: 1, profiles: [{ id: "cloud-profile", name: "Cloudy", skinId: "default", createdAt: 1 }], activeProfileId: "cloud-profile" })
        );
      }
    });
    await page.goto("/");

    // ── register an account, then reach the local menus through the door ────
    // Unique per attempt: the pglite webServer keeps its data across retries
    // within one run, and a re-registered email fails with "already exists".
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "I need an account" }).click();
    await page.getByLabel("Email").fill(`cloudy-${Date.now().toString(36)}@example.com`);
    await page.getByLabel("Display name").fill("Cloudy");
    await page.getByLabel("Password").fill("hunter2hunter2");
    await page.getByRole("button", { name: "Create account" }).click();

    // Signing in flips the menu to the account home; cloud saves live with the
    // LOCAL worlds, one local-worlds footer link away.
    await expect(page.getByText("Online Profiles")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("play-locally").click();
    await page.getByTestId("profile-cloud-profile").click();

    await page.getByTestId("new-world").click();
    await page.getByLabel("World name").fill("Roamer");
    await page.getByLabel("World seed").fill("7777");
    await page.getByRole("button", { name: "Create World" }).click();
    await waitForGame(page);

    // ── a distinctive edit: a Stone block placed in mid-air (nothing generates
    // there, so finding it after a round-trip can only come from the save diff) ──
    const marker = await page.evaluate(() => {
      const state = window.__monecraft!.engine.state;
      const x = Math.floor(state.player.position.x);
      const z = Math.floor(state.player.position.z);
      const y = Math.floor(state.player.position.y) + 3;
      const before = state.world.get(x, y, z);
      state.blockChanges.set(x, y, z, 3); // 3 = Stone
      return { x, y, z, before };
    });
    expect(marker.before).toBe(0); // was air — nothing was generated up there

    // Save & Quit writes the local save (with the edit) and returns to the list.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Save & Quit to Worlds" }).click();
    await expect(page.getByText("Roamer")).toBeVisible({ timeout: 15000 });

    // ── upload to the cloud; the card flips to Synced ────────────────────────
    await page.getByRole("button", { name: "Upload to cloud" }).click();
    await expect(page.getByText(/Synced/)).toBeVisible({ timeout: 15000 });

    // ── delete the LOCAL copy; the cloud row survives and surfaces as downloadable ─
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(/This cannot be undone/)).toBeVisible();
    await page.locator(".menu-confirm").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(/Synced/)).toHaveCount(0); // the local (synced) world is gone

    // Simulate a fresh device: clear this device's sync cursors so the open-time
    // reconcile ADOPTS the cloud save (a cursor at-or-past the remote revision
    // would keep-local and not pull). Cursors are per-world keys now.
    await page.evaluate(() => {
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const key = localStorage.key(i);
        if (key?.startsWith("minecraft_cloud_rev_")) localStorage.removeItem(key);
      }
    });

    // ── download it and confirm the edit round-tripped through the cloud ─────
    const cloudId = await page.evaluate(async () => {
      const response = await fetch("/api/worlds");
      const { worlds } = (await response.json()) as { worlds: Array<{ id: string; kind: string }> };
      return worlds.find((world) => world.kind === "sp-cloud")!.id;
    });
    await page.getByTestId(`cloud-world-${cloudId}`).click();
    await waitForGame(page);

    const after = await page.evaluate((m) => window.__monecraft!.engine.state.world.get(m.x, m.y, m.z), marker);
    expect(after, "the Stone block placed before upload survived the cloud round-trip").toBe(3);

    expect(errors, "no console/page errors during the test").toEqual([]);
  } finally {
    await context.close(); // always close the manually-created context, even on a failed assertion
  }
});
