import { expect, test, type Page } from "@playwright/test";
import { acquirePointerLock } from "./helpers";

/**
 * The full co-op journey against the real online stack: the Next app backed
 * by an in-process Postgres (DATABASE_URL=pglite://memory) plus the Bun game
 * server, both from playwright.config's webServer list — no Docker, no cloud.
 * Two isolated browser contexts play two guests: the host creates an online
 * world through the menus, the friend joins through the invite link, and the
 * pair must see each other, share block edits, and chat.
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

test("two guests share an online world via an invite link", async ({ browser }) => {
  // Two production builds of the game plus a WebSocket handshake each; CI
  // renders with software GL, so the whole journey gets a generous ceiling.
  test.setTimeout(240000);
  const errors: string[] = [];

  // ── the host: guest account → online world → in-game ─────────────────────
  const hostContext = await browser.newContext();
  const host = await hostContext.newPage();
  watchErrors(host, errors);
  // Seed a profile so the menu opens on the profile LIST (where the account
  // panel lives) instead of the first-run create form.
  await host.addInitScript(() => {
    if (!localStorage.getItem("minecraft_profiles_v1")) {
      localStorage.setItem(
        "minecraft_profiles_v1",
        JSON.stringify({ version: 1, profiles: [{ id: "host-profile", name: "Hosta", skinId: "default", createdAt: 1 }], activeProfileId: "host-profile" })
      );
    }
  });
  await host.goto("/");

  await host.getByRole("button", { name: "Play online as guest" }).click();
  await expect(host.getByText("Playing as guest")).toBeVisible({ timeout: 15000 });
  await host.getByTestId("profile-host-profile").click();

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

  // ── the friend: invite link → guest account → same world ─────────────────
  const friendContext = await browser.newContext();
  const friend = await friendContext.newPage();
  watchErrors(friend, errors);
  await friend.goto(`/join/${inviteToken}`);
  await expect(friend.getByText(/You've joined/)).toBeVisible({ timeout: 15000 });
  await friend.getByRole("link", { name: "Open the game" }).click();

  // First run in this fresh context: create the friend's local profile; the
  // invited world is already waiting in the Online Worlds section. The friend
  // is already a guest (the invite link signed them in), so the first-run screen
  // also shows the account panel — `exact` avoids matching its
  // "Keep my worlds — create account" button.
  await friend.getByLabel("Profile name").fill("Friend");
  await friend.getByRole("button", { name: "Create", exact: true }).click();
  await friend.getByTestId(`online-world-${worldId}`).click();
  await waitForOnlineGame(friend);

  // ── both replicas agree there are two players in the room ────────────────
  for (const page of [host, friend]) {
    await page.waitForFunction(() => window.__monecraft!.engine.state.players.size === 2, undefined, { timeout: 15000 });
  }

  // ── a block edit crosses the wire ─────────────────────────────────────────
  // The host digs straight down. The replica's own mining is cosmetic (it
  // never completes a break locally), so a journal entry appearing on BOTH
  // clients proves the server decided the break and broadcast it.
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
  await host.evaluate(() => window.__monecraft!.net!.sendChat("hello from the host"));
  await expect(friend.getByText("hello from the host")).toBeVisible({ timeout: 10000 });
  await friend.evaluate(() => window.__monecraft!.net!.sendChat("hi back"));
  await expect(host.getByText("hi back")).toBeVisible({ timeout: 10000 });

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

  // ── the owner kicks the friend, who drops to the disconnect modal (LAST: it
  // tears down the friend's session). net.kick is exactly what the RosterPanel
  // Kick button's onClick calls.
  const friendId = await host.evaluate(() => {
    const net = window.__monecraft!.net!;
    return net.roster().find((member) => member.id !== net.playerId)!.id;
  });
  await host.evaluate((id) => window.__monecraft!.net!.kick(id), friendId);
  await expect.poll(() => friend.evaluate(() => window.__monecraft!.net!.status()), { timeout: 15000 }).toBe("closed");
  await expect(friend.getByRole("alertdialog", { name: "Disconnected" })).toBeVisible({ timeout: 10000 });
  await expect.poll(() => host.evaluate(() => window.__monecraft!.engine.state.players.size), { timeout: 15000 }).toBe(1);

  expect(errors, "no console/page errors during the test").toEqual([]);
  await hostContext.close();
  await friendContext.close();
});
