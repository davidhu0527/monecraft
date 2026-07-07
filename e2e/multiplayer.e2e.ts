import { expect, test, type Page } from "@playwright/test";

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

/**
 * Opens the engine input gate with the STABLE forced flag (never REAL pointer
 * lock) and aims straight down, ready for a held `mouse.down()` dig. Real lock
 * is flaky under automation — new-headless can win it then drop it mid-hold,
 * and the resulting pointerlockchange resets `pointerLocked`, so a long-held
 * dig quietly stops (it shows up as the block never breaking, "Double-click to
 * play" back). The forced flag never fires pointerlockchange, so the dig stays
 * engaged across the poll. Mirrors what helpers.acquirePointerLock falls back
 * to, minus the flaky real-lock attempt.
 */
async function forceDigStraightDown(page: Page): Promise<void> {
  await page.locator(".game-canvas-wrap canvas").hover();
  // Wait until the player has actually landed. A just-spawned player is still
  // settling, and aiming straight down while airborne can overshoot the terrain
  // (the down-ray finds no block in reach), so the held dig never engages mining
  // — the deepest of this test's old flakes (the block-edit poll timing out at
  // 0). Grounded, the block underfoot is always a valid target.
  await page.waitForFunction(() => window.__monecraft!.engine.state.player.onGround === true, undefined, { timeout: 20000 });
  await page.evaluate(() => {
    window.__monecraft!.input.forcePointerLock(true);
    window.__monecraft!.engine.state.player.pitch = -Math.PI / 2 + 0.02;
  });
}

test("two accounts share an online world via an invite link", async ({ browser }) => {
  // Two production builds of the game plus a WebSocket handshake each; CI
  // renders with software GL, so the whole journey gets a generous ceiling. A
  // slammed shared runner has overrun 240s here (the registration journey and
  // the edit-propagation polls both run long under load), so give it 5 min.
  test.setTimeout(300000);
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
  await forceDigStraightDown(host);
  await host.waitForTimeout(1000); // settle (slow CI renderers need the margin)
  await host.mouse.down();
  for (const page of [host, friend]) {
    // 45s: the friend's copy arrives over the wire, and a slammed runner (the
    // Bun game server shares the box) has lagged that hop past 30s.
    await expect.poll(() => page.evaluate(() => window.__monecraft!.engine.state.blockChanges.changes().length), { timeout: 45000 }).toBeGreaterThan(0);
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

  // ── the friend's own break under latency: local-first, and still propagates ──
  // 400±100 ms simulated one-way (~800 ms RTT): the friend digs; the block must
  // vanish from the friend's OWN world (its replica commits the break locally,
  // ahead of the server), AND the edit must still reach the host over the
  // lagged link. That the local commit rides the PREDICTION ledger (a pending
  // entry held until the server confirms) is pinned in NetworkSession.test.ts —
  // that ledger window is a sub-second internal transient, too narrow to
  // observe reliably from a cross-process e2e poll, so here we assert the
  // user-visible journey rather than the ledger's internals.
  //
  // Foreground the friend first: unlike RECEIVING the host's edit (network
  // callbacks fire while occluded), the friend's OWN break is engine-rAF-driven,
  // and the browser throttles rAF hard on a backgrounded page (the friend has
  // sat behind the host all along), so occluded its mining crawls and can miss
  // the 45s window. Foregrounded, its engine steps at full rate. (bringToFront
  // alone once looked like it broke digging — that was the airborne-aim miss the
  // onGround wait in forceDigStraightDown now covers, not bringToFront itself.)
  await friend.bringToFront();
  await friend.evaluate(() => {
    window.__monecraft!.net!.setSimulatedLatency(400, 100);
  });
  const friendEdits = await friend.evaluate(() => window.__monecraft!.engine.state.blockChanges.changes().length);
  await forceDigStraightDown(friend);
  await friend.waitForTimeout(1000); // settle (slow CI renderers need the margin — same as the host break)
  await friend.mouse.down();
  // The break commits on the FRIEND's own screen despite the lag — its journal
  // grows before a server round trip could have returned the edit.
  await expect
    .poll(() => friend.evaluate(() => window.__monecraft!.engine.state.blockChanges.changes().length), { timeout: 45000 })
    .toBeGreaterThan(friendEdits);
  await friend.mouse.up();
  // …and still crosses the deliberately lagged link to the host.
  await expect.poll(() => host.evaluate(() => window.__monecraft!.engine.state.blockChanges.changes().length), { timeout: 45000 }).toBeGreaterThan(friendEdits);
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
