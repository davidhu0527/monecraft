import { expect, test, type Page } from "@playwright/test";
import { acquirePointerLock } from "./helpers";

/**
 * The full co-op journey against the real online stack: the Next app backed
 * by an in-process Postgres (DATABASE_URL=pglite://memory) plus the Bun game
 * server, both from playwright.config's webServer list — no Docker, no cloud.
 * Two isolated browser contexts play two ACCOUNTS (online play is
 * accounts-only): the host registers, creates an online profile and world
 * through the account menus, the friend registers on the invite landing page,
 * and the pair must see each other, share block edits, and chat.
 */

/** Console/page errors collected like the smoke fixture does (favicon 404 is noise). */
function watchErrors(page: Page, sink: string[]): void {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text().includes("Failed to load resource") && message.location().url.endsWith("/favicon.ico")) return;
    sink.push(`${message.text()} (${message.location().url})`);
  });
  page.on("pageerror", (error) => sink.push(String(error)));
}

/** Booted, synced, and drawing: the bar every online entry must clear. */
async function waitForOnlineGame(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__monecraft !== undefined, undefined, { timeout: 30000 });
  await page.waitForFunction(() => window.__monecraft!.net?.status() === "online", undefined, { timeout: 30000 });
  await page.waitForFunction(() => window.__monecraft!.renderer.renderedTriangles() > 0, undefined, { timeout: 30000 });
}

/** Registers a fresh account: welcome gate's "Sign in" → auth screen → sign-up. */
async function signUp(page: Page, name: string, email: string): Promise<void> {
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "I need an account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Password").fill("hunter2hunter2");
  await page.getByRole("button", { name: "Create account" }).click();
}

/** From the account home, creates an online profile and enters its world list. */
async function createOnlineProfile(page: Page, name: string): Promise<void> {
  // Sign-up → session probe → account home spans two network hops.
  await expect(page.getByText("Online Profiles")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("new-online-profile").click();
  await page.getByLabel("Profile name").fill(name);
  // exact: "Create account" (form) and "Create World" share the substring.
  await page.getByRole("button", { name: "Create", exact: true }).click();
}

test("two accounts share an online world via an invite link", async ({ browser }) => {
  // Two production builds of the game plus a WebSocket handshake each; CI
  // renders with software GL, so the whole journey gets a generous ceiling.
  test.setTimeout(240000);
  const errors: string[] = [];
  // The pglite webServer keeps its data across retries within one run, so a
  // fixed email means every retry dies on "User already exists" — tag them.
  const runTag = Date.now().toString(36);

  // ── the host: register → online profile → online world → in-game ─────────
  const hostContext = await browser.newContext();
  const host = await hostContext.newPage();
  watchErrors(host, errors);
  await host.goto("/");

  // The welcome gate's "Sign in" leads straight to the auth screen, so
  // registration needs no local profile — a pure account never touches the
  // local menus.
  await signUp(host, "Hosta", `host-${runTag}@example.com`);
  await createOnlineProfile(host, "Hosta");

  // Creative, so the host's block breaks are instant on the server side.
  await host.getByTestId("new-online-world").click();
  await host.getByLabel("World name").fill("Co-op Test");
  await host.getByLabel("World seed").fill("4242");
  await host.getByRole("button", { name: "Creative mode" }).click();
  await host.getByRole("button", { name: "Create World" }).click();
  await waitForOnlineGame(host);

  // Mint the invite with the host's cookies (the menu's Copy button wraps the
  // same endpoint; the clipboard is out of reach in headless runs).
  const worldId = await host.evaluate(async () => {
    const response = await fetch("/api/worlds");
    const { worlds } = (await response.json()) as { worlds: Array<{ id: string }> };
    return worlds[0].id;
  });
  const inviteToken = await host.evaluate(async (id) => {
    const response = await fetch(`/api/worlds/${id}/invites`, { method: "POST" });
    const { token } = (await response.json()) as { token: string };
    return token;
  }, worldId);

  // ── the friend: invite link → register on the landing page → same world ──
  const friendContext = await browser.newContext();
  const friend = await friendContext.newPage();
  watchErrors(friend, errors);
  await friend.goto(`/join/${inviteToken}`);

  // The landing page previews the world before any sign-in, then embeds the
  // account panel; registering accepts the invite in place.
  await expect(friend.getByText("Co-op Test")).toBeVisible({ timeout: 15000 });
  await expect(friend.getByText(/sign in to join/)).toBeVisible();
  await signUp(friend, "Frienda", `friend-${runTag}@example.com`);
  await expect(friend.getByText(/You've joined/)).toBeVisible({ timeout: 15000 });
  await friend.getByRole("link", { name: "Open the game" }).click();

  // The landing page marked online-used, so the shell finds the fresh session
  // and opens the account home. The joined world surfaces under any profile
  // (membership is account-level), labelled as joined rather than owned.
  await createOnlineProfile(friend, "Friend");
  await expect(friend.getByTestId(`online-world-${worldId}`)).toContainText("Joined");
  await friend.getByTestId(`online-world-${worldId}`).click();
  await waitForOnlineGame(friend);

  // ── both replicas agree there are two players in the room ────────────────
  for (const page of [host, friend]) {
    await page.waitForFunction(() => window.__monecraft!.engine.state.players.size === 2, undefined, { timeout: 15000 });
  }

  // ── a block edit crosses the wire ─────────────────────────────────────────
  // The host digs straight down. The host's own journal entry may be its
  // PREDICTED break (replica mining commits locally now), so the proof that
  // the server decided and broadcast it is the FRIEND's journal changing.
  await acquirePointerLock(host);
  await host.waitForTimeout(1000); // settle (slow CI renderers need the margin)
  await host.evaluate(() => {
    window.__monecraft!.engine.state.player.pitch = -Math.PI / 2 + 0.02;
  });
  await host.mouse.down();
  for (const page of [host, friend]) {
    await expect.poll(() => page.evaluate(() => window.__monecraft!.engine.state.blockChanges.changes().length), { timeout: 30000 }).toBeGreaterThan(0);
  }
  await host.mouse.up();

  // ── chat round-trips, rendering in the other player's log ────────────────
  // 30s like the block-edit poll: a slammed CI runner has been seen lagging
  // the second page's connection by tens of seconds (10s flaked in CI).
  await host.evaluate(() => window.__monecraft!.net!.sendChat("hello from the host"));
  await expect(friend.getByText("hello from the host")).toBeVisible({ timeout: 30000 });
  await friend.evaluate(() => window.__monecraft!.net!.sendChat("hi back"));
  await expect(host.getByText("hi back")).toBeVisible({ timeout: 30000 });

  // ── the roster lists both players; only the owner (host) gets a Kick control ─
  for (const page of [host, friend]) {
    expect(await page.evaluate(() => window.__monecraft!.net!.roster().length)).toBe(2);
  }
  await expect(host.getByRole("button", { name: /^Kick / })).toBeVisible(); // owner sees it
  expect(await friend.getByRole("button", { name: /^Kick / }).count()).toBe(0); // a member does not

  // (Arrow replication — the `prj` channel — is covered by unit tests rather than
  // here: driving it end-to-end means creative-mode + inventory juggling + firing
  // into open sky to dodge the first-tick despawn, too fragile for a reliable e2e.
  // See server/room.test.ts (broadcast) and NetworkSession.test.ts (upsert).)

  // ── prediction under latency: a lagged client's own break is local-first ──
  // 400±100 ms simulated one-way (~800 ms RTT): the friend digs, the block
  // must vanish from the friend's OWN world via the prediction ledger, and the
  // edit must still reach the host through the lagged link. Wire-format
  // details are unit-tested; this is the journey.
  await friend.evaluate(() => {
    window.__monecraft!.net!.setSimulatedLatency(400, 100);
  });
  const friendEdits = await friend.evaluate(() => window.__monecraft!.engine.state.blockChanges.changes().length);
  await acquirePointerLock(friend);
  await friend.waitForTimeout(1000); // settle (slow CI renderers need the margin — same as the host break)
  await friend.evaluate(() => {
    window.__monecraft!.engine.state.player.pitch = -Math.PI / 2 + 0.02;
  });
  await friend.mouse.down();
  // Poll at a fixed 100 ms cadence until the break commits locally; every
  // sample also latches whether the ledger held a pending entry. The pending
  // window is ~700–1800 ms wide (the confirm needs a full simulated round
  // trip), so the latch cannot miss it. Two rejected designs flaked here on
  // 2026-07-05: an in-page rAF watcher (headless Chromium throttles rAF on
  // occluded pages — the friend page sits behind the host's) and a one-shot
  // ledger read after a default-interval poll (the poll's 1 s backoff can
  // outwait the confirm).
  const samples: string[] = [];
  let last: { broke: boolean; pendingSeen: boolean } = { broke: false, pendingSeen: false };
  for (let i = 0; i < 300; i += 1) {
    last = await friend.evaluate((before) => {
      const w = window as unknown as { __sawPending?: boolean };
      if ((window.__monecraft?.net?.netStats().pendingPredictions ?? 0) > 0) w.__sawPending = true;
      const st = window.__monecraft!.engine.state as unknown as {
        dayClock: number;
        player: { mining?: { targetKey: string; progress: number }; position: { y: number }; pitch: number };
      };
      return {
        broke: window.__monecraft!.engine.state.blockChanges.changes().length > before,
        pendingSeen: w.__sawPending === true,
        pending: window.__monecraft!.net!.netStats().pendingPredictions,
        edits: window.__monecraft!.engine.state.blockChanges.changes().length,
        mine: `${st.player.mining?.targetKey ?? "?"}@${(st.player.mining?.progress ?? 0).toFixed(2)}`,
        y: st.player.position.y.toFixed(2)
      };
    }, friendEdits);
    samples.push(`${i * 100}ms ${JSON.stringify(last)}`);
    if (last.broke && last.pendingSeen) break;
    await friend.waitForTimeout(100);
  }
  if (!(last.broke && last.pendingSeen)) console.log("LAGGED-BREAK SAMPLES:\n" + samples.join("\n"));
  expect(last, "the lagged break commits locally through the prediction ledger").toMatchObject({ broke: true, pendingSeen: true });
  await friend.mouse.up();
  await expect.poll(() => host.evaluate(() => window.__monecraft!.engine.state.blockChanges.changes().length), { timeout: 30000 }).toBeGreaterThan(friendEdits);
  await friend.evaluate(() => window.__monecraft!.net!.setSimulatedLatency(0));

  // ── the owner kicks the friend, who drops to the disconnect modal (LAST: it
  // tears down the friend's session). net.kick is exactly what the RosterPanel
  // Kick button's onClick calls.
  const friendId = await host.evaluate(() => {
    const net = window.__monecraft!.net!;
    return net.roster().find((member) => member.id !== net.playerId)!.id;
  });
  await host.evaluate((id) => window.__monecraft!.net!.kick(id), friendId);
  await expect.poll(() => friend.evaluate(() => window.__monecraft!.net!.status()), { timeout: 30000 }).toBe("closed");
  await expect(friend.getByRole("alertdialog", { name: "Disconnected" })).toBeVisible({ timeout: 10000 });
  await expect.poll(() => host.evaluate(() => window.__monecraft!.engine.state.players.size), { timeout: 30000 }).toBe(1);

  expect(errors, "no console/page errors during the test").toEqual([]);
  await hostContext.close();
  await friendContext.close();
});
