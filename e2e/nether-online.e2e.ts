import { expect, test, type Page } from "@playwright/test";
import { createOnlineProfile, flyTo, poseSettled, signUp, TWO_BROWSER_VIEWPORT, waitForOnlineGame, walkTo, watchErrors } from "./onlineHelpers";

/**
 * Nether travel in an ONLINE world, end-to-end through the real stack: the
 * host builds and ignites a portal with real networked placeBlock commands
 * (every obsidian cell is confirmed by the server's journal echo), dwells,
 * and the server hands them to a lazily-born nether shard — the client swaps
 * its replica and renderer around the SAME live socket. The friend watches
 * the roster tag flip, follows through, both meet in the nether, and the
 * host rides the arrival portal home. Creative keeps the build free and
 * hostiles passive; the terrain is REAL (the memory-persistence game server
 * auto-creates default-type worlds whatever the create form says), so the
 * build anchors on a scanned level site rather than assumed-flat ground.
 */

/** Aims the replica player's eye ray at a world point (yaw/pitch convention from lookDirection). */
async function aimAt(page: Page, target: { x: number; y: number; z: number }): Promise<void> {
  await page.evaluate((t) => {
    const s = window.__monecraft!.engine.state;
    const eye = { x: s.player.position.x, y: s.player.position.y + 1.62, z: s.player.position.z };
    const dx = t.x - eye.x;
    const dy = t.y - eye.y;
    const dz = t.z - eye.z;
    const len = Math.hypot(dx, dy, dz);
    s.player.pitch = Math.asin(dy / len);
    s.player.yaw = Math.atan2(-dx, -dz);
  }, target);
}

/**
 * Places the selected block at a cell through the REAL wire path (aim → the
 * routed placeBlock cmd → server raycast → journal broadcast) and confirms it
 * on the OTHER player's replica — the placer's own world can briefly show an
 * optimistic prediction the server rejected, but only a server-confirmed edit
 * ever reaches the witness. Aim candidates cover the two support geometries:
 * onto the top face of the block below, or out of a horizontal neighbor's
 * side face. Each dispatch is gated on poseSettled (see above), and the whole
 * candidate list gets three rounds before giving up.
 */
async function placeAt(
  placer: Page,
  witness: Page,
  cell: { x: number; y: number; z: number },
  blockId: number,
  aims: Array<{ x: number; y: number; z: number }>
): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    for (const aim of aims) {
      await aimAt(placer, aim);
      try {
        await poseSettled(placer, witness);
      } catch {
        /* stream is crawling — the dispatch below still gets its chance */
      }
      await placer.evaluate(() => window.__monecraft!.net!.dispatch({ type: "placeBlock" }));
      // Fast path: the witness's replica saw the journal broadcast.
      try {
        await expect.poll(() => witness.evaluate((c) => window.__monecraft!.engine.state.world.get(c.x, c.y, c.z), cell), { timeout: 6000 }).toBe(blockId);
        return;
      } catch {
        /* the ray clipped a different face — or the witness is sluggish */
      }
      // Fallback: the placer's own view is server-confirmed once the block
      // outlives the prediction window (PREDICTION_TIMEOUT_MAX_MS) — an
      // unconfirmed optimistic edit reverts by then, so a survivor is truth
      // even when the witness page is being starved by the runner. Ignition's
      // two-page portal poll still guarantees end-to-end replication.
      const readCell = () => placer.evaluate((c) => window.__monecraft!.engine.state.world.get(c.x, c.y, c.z), cell);
      if ((await readCell()) === blockId) {
        await placer.waitForTimeout(5500);
        if ((await readCell()) === blockId) return;
      }
    }
  }
  const debug = await placer.evaluate((c) => {
    const s = window.__monecraft!.engine.state;
    const p = s.player;
    return {
      pose: { x: p.position.x, y: p.position.y, z: p.position.z, yaw: p.yaw, pitch: p.pitch },
      placerSees: s.world.get(c.x, c.y, c.z),
      held: p.inventory[p.selectedSlot]?.id ?? null,
      net: window.__monecraft!.net?.status()
    };
  }, cell);
  throw new Error(`could not place block ${blockId} at ${JSON.stringify(cell)}; placer=${JSON.stringify(debug)}`);
}

/** Polls the (possibly mid-remount) game handle for the current dimension. */
const dimensionOf = (page: Page) => page.evaluate(() => window.__monecraft?.engine?.state?.dimension ?? "swapping");

/**
 * Puts a creative-palette item IN HAND: give → swap into a hotbar slot →
 * select. creativeGiveItem fills the lowest empty slot, which on a fresh
 * player is BEYOND the hotbar (the starter kit fills slots 0–8), and
 * selectSlot refuses non-hotbar indices — so the swap is load-bearing. Every
 * step round-trips the server (the SelfDelta echoes confirm).
 */
async function holdItem(page: Page, itemId: string, hotbarIndex: number): Promise<void> {
  // creativeGiveItem is not a LOCAL_COMMAND and has no optimistic path, so the
  // item appears only after a full cmd → server → SelfDelta → client round-trip.
  // On a build-slammed shared runner that echo can lag well past the 10 s a
  // single poll once allowed (the rest of the suite budgets 30–45 s for such
  // hops). Re-dispatch across three ~10 s rounds — the way placeAt retries — so
  // one slow or dropped echo self-heals instead of failing the run. A duplicate
  // give (if the first was merely slow) is harmless: it fills another slot and
  // findIndex still returns the first.
  const slotOf = () => page.evaluate((id) => window.__monecraft!.engine.state.player.inventory.findIndex((slot) => slot?.id === id), itemId);
  let gave = false;
  for (let round = 0; round < 3 && !gave; round += 1) {
    await page.evaluate((id) => window.__monecraft!.net!.dispatch({ type: "creativeGiveItem", itemId: id }), itemId);
    try {
      await expect.poll(slotOf, { timeout: 10000 }).toBeGreaterThanOrEqual(0);
      gave = true;
    } catch {
      if (round === 2) throw new Error(`creativeGiveItem "${itemId}" never echoed after 3 dispatches`);
    }
  }
  await page.evaluate(
    ({ id, to }) => {
      const s = window.__monecraft!.engine.state;
      const from = s.player.inventory.findIndex((slot) => slot?.id === id);
      if (from !== to) window.__monecraft!.net!.dispatch({ type: "swapSlots", from, to });
      window.__monecraft!.net!.dispatch({ type: "selectSlot", index: to });
    },
    { id: itemId, to: hotbarIndex }
  );
  // 30 s like the suite's other network-hop polls: the swap + select is another
  // server round-trip, and this fires right after the portal build has hammered
  // the shared server.
  await expect
    .poll(() => page.evaluate((to) => window.__monecraft!.engine.state.player.inventory[to]?.id ?? null, hotbarIndex), { timeout: 30000 })
    .toBe(itemId);
}

test("two players cross a nether portal in an online world and come back", async ({ browser }) => {
  // Two production builds, a ws handshake each, ~15 confirmed server-side
  // block placements, and TWO full nether worldgens (server shard + each
  // client replica) — the most machinery any e2e here drives.
  test.setTimeout(480000);
  const errors: string[] = [];
  const runTag = Date.now().toString(36);

  // ── host: account → online profile → SUPERFLAT CREATIVE world ─────────────
  const hostContext = await browser.newContext({ viewport: TWO_BROWSER_VIEWPORT });
  const host = await hostContext.newPage();
  watchErrors(host, errors);
  await host.goto("/");
  await signUp(host, "Porta", `portal-host-${runTag}@example.com`);
  await createOnlineProfile(host, "Porta");
  await host.getByTestId("new-online-world").click();
  await host.getByLabel("World name").fill("Nether Co-op");
  await host.getByLabel("World seed").fill("4242");
  await host.getByRole("button", { name: "Superflat world type" }).click();
  await host.getByRole("button", { name: "Creative mode" }).click();
  await host.getByRole("button", { name: "Create World" }).click();
  await waitForOnlineGame(host);

  // ── friend joins via invite ────────────────────────────────────────────────
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
  const friendContext = await browser.newContext({ viewport: TWO_BROWSER_VIEWPORT });
  const friend = await friendContext.newPage();
  watchErrors(friend, errors);
  await friend.goto(`/join/${inviteToken}`);
  await signUp(friend, "Followa", `portal-friend-${runTag}@example.com`);
  await expect(friend.getByText(/You've joined/)).toBeVisible({ timeout: 15000 });
  await friend.getByRole("link", { name: "Open the game" }).click();
  await createOnlineProfile(friend, "Followa");
  await friend.getByTestId(`online-world-${worldId}`).click();
  await waitForOnlineGame(friend);
  for (const page of [host, friend]) {
    await page.waitForFunction(() => window.__monecraft!.engine.state.players.size === 2, undefined, { timeout: 15000 });
  }

  // ── the host builds a 2×3 portal frame with real placeBlock cmds ──────────
  await host.bringToFront(); // its engine drives the build; don't let rAF throttle it
  await host.evaluate(() => {
    window.__monecraft!.input.forcePointerLock(true);
  });
  await holdItem(host, "obsidian", 0);
  // toggleFlight is a networked command (the server tracks flight for its pose
  // clamps) — but the REPLICA's own physics must stop applying gravity too, or
  // every scripted hop below fights a fall. isFlying is transient local state.
  await host.evaluate(() => {
    window.__monecraft!.net!.dispatch({ type: "toggleFlight" });
    window.__monecraft!.engine.state.player.isFlying = true;
  });

  // Find a level, dry 4×4 patch near spawn for the build site (the e2e game
  // server runs memory persistence, which auto-creates DEFAULT-type worlds
  // whatever the create form said — so the terrain is real and the frame
  // geometry must anchor on a genuinely flat spot).
  const frame = await host.evaluate(() => {
    const s = window.__monecraft!.engine.state;
    const cx = Math.floor(s.player.position.x);
    const cz = Math.floor(s.player.position.z);
    // A build site: the four FRAME columns share one exact ground height and
    // are clear above (the geometry anchors on them); the approach columns
    // between frame and stand may be lower but never higher (rays pass over),
    // and the two hover columns are clear up to the descent height.
    const siteAt = (px: number, pz: number): number | null => {
      const zp = pz - 3;
      const g = s.world.highestSolidY(px, zp);
      if (g < 4 || g > s.world.sizeY - 12) return null;
      for (let x = px - 1; x <= px + 2; x += 1) {
        if (s.world.highestSolidY(x, zp) !== g) return null;
        for (let dy = 1; dy <= 6; dy += 1) if (s.world.get(x, g + dy, zp) !== 0) return null;
        for (let z = zp + 1; z <= pz; z += 1) {
          if (s.world.highestSolidY(x, z) > g) return null;
          for (let dy = 1; dy <= 6; dy += 1) if (s.world.get(x, g + dy, z) !== 0) return null;
        }
      }
      for (const sx of [px, px + 1]) for (let dy = 7; dy <= 8; dy += 1) if (s.world.get(sx, g + dy, pz) !== 0) return null;
      return g;
    };
    for (let r = 0; r <= 60; r += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        for (const dz of dx === -r || dx === r ? Array.from({ length: 2 * r + 1 }, (_, i) => i - r) : [-r, r]) {
          const px = Math.min(Math.max(cx + dx, 4), s.world.sizeX - 6);
          const pz = Math.min(Math.max(cz + dz, 6), s.world.sizeZ - 4);
          const g = siteAt(px, pz);
          if (g !== null) return { px, pz, zp: pz - 3, g };
        }
      }
    }
    throw new Error("no buildable portal site within 60 blocks of spawn");
  });
  const { px, pz, zp, g } = frame;
  const stand = { x: px + 0.5, z: pz + 0.5 }; // never moves horizontally during the build

  // Route to the site OVER the terrain: straight up at the current spot, a
  // high traverse, then the build loop descends inside the patch's clear box.
  const liftAndTraverse = async (page: Page, to: { x: number; z: number }) => {
    const at = await page.evaluate(() => {
      const p = window.__monecraft!.engine.state.player.position;
      return { x: p.x, y: p.y, z: p.z };
    });
    const high = Math.max(at.y, g + 2) + 14;
    await flyTo(page, { x: at.x, y: high, z: at.z });
    await flyTo(page, { x: to.x, y: high, z: to.z });
  };
  await liftAndTraverse(host, stand);
  /** Aim candidates for a cell supported from BELOW: two depths inside the support's top. */
  const topAims = (x: number, y: number, z: number) => [
    { x: x + 0.5, y: y - 0.05, z: z + 0.5 },
    { x: x + 0.5, y: y - 0.2, z: z + 0.5 }
  ];

  // Bottom bar (on the ground), then the side columns row by row — the player
  // flies level with each row so every aim hits the support's TOP face at the
  // same comfortable angle.
  for (let row = 0; row <= 4; row += 1) {
    const y = g + 1 + row;
    await flyTo(host, { x: stand.x, y, z: stand.z });
    const columns = row === 0 || row === 4 ? [-1, 0, 1, 2] : [-1, 2]; // bars are full-width; sides are the two columns
    for (const i of columns) {
      // The top bar's middle cells float over the interior — no support below;
      // they're placed sideways off the corner blocks right after this loop.
      if (row === 4 && (i === 0 || i === 1)) continue;
      await placeAt(host, friend, { x: px + i, y, z: zp }, 90, topAims(px + i, y, zp));
    }
  }
  // Top-bar middles, sideways off the corners: hover with the eye BETWEEN the
  // bar's bottom and top planes so the ray enters the corner's INNER side
  // face — and stand ~1.5 blocks toward the support so the ray's x-crossing
  // happens inside the frame row (crossing order decides the placed cell).
  await flyTo(host, { x: px + 1.5, y: g + 4.4, z: stand.z });
  await placeAt(host, friend, { x: px, y: g + 5, z: zp }, 90, [{ x: px - 0.1, y: g + 5.5, z: zp + 0.5 }]);
  await flyTo(host, { x: px + 0.5, y: g + 4.4, z: stand.z });
  await placeAt(host, friend, { x: px + 1, y: g + 5, z: zp }, 90, [{ x: px + 2.1, y: g + 5.5, z: zp + 0.5 }]);

  // ── ignition: flint & steel on the frame; BOTH replicas see the surface ───
  await flyTo(host, { x: stand.x, y: g + 1, z: stand.z });
  await holdItem(host, "flint_and_steel", 1);
  // Aim at the bottom bar's TOP face under an interior cell: the raycast's
  // previous cell is the interior candidate ignition validates.
  await aimAt(host, { x: px + 0.5, y: g + 1.95, z: zp + 0.5 });
  try {
    await poseSettled(host, friend); // the server must ignite from THIS aim, not a stale one
  } catch {
    /* dispatch anyway — the 30 s portal poll below is the real arbiter */
  }
  await host.evaluate(() => window.__monecraft!.net!.dispatch({ type: "placeBlock" }));
  for (const page of [host, friend]) {
    await expect.poll(() => page.evaluate((c) => window.__monecraft!.engine.state.world.get(c.px, c.g + 2, c.zp), { px, g, zp }), { timeout: 30000 }).toBe(91); // NetherPortal replicated through the ordinary journal
  }

  // ── the host walks in, dwells 3 s, and the server hands them to the nether ─
  await flyTo(host, { x: px + 0.5, y: g + 2.2, z: zp + 0.5 });
  await expect.poll(() => dimensionOf(host), { timeout: 60000 }).toBe("nether");
  await host.waitForFunction(() => window.__monecraft!.net?.status() === "online", undefined, { timeout: 30000 });
  await host.waitForFunction(() => window.__monecraft!.renderer.renderedTriangles() > 0, undefined, { timeout: 30000 });

  // The friend saw the split: roster tag flips, the host's avatar left this world.
  await expect
    .poll(() => friend.evaluate(() => window.__monecraft!.net!.roster().find((m) => m.id !== window.__monecraft!.net!.playerId)?.dimension), {
      timeout: 30000
    })
    .toBe("nether");
  await expect.poll(() => friend.evaluate(() => window.__monecraft!.engine.state.players.size), { timeout: 30000 }).toBe(1);

  // ── the friend follows through the same portal ─────────────────────────────
  await friend.bringToFront();
  await friend.evaluate(() => {
    window.__monecraft!.input.forcePointerLock(true);
    window.__monecraft!.net!.dispatch({ type: "toggleFlight" });
    window.__monecraft!.engine.state.player.isFlying = true;
  });
  await liftAndTraverse(friend, stand);
  await flyTo(friend, { x: stand.x, y: g + 2.2, z: stand.z }); // descend in the clear box
  await flyTo(friend, { x: px + 0.5, y: g + 2.2, z: zp + 0.5 }); // in through the south opening
  await expect.poll(() => dimensionOf(friend), { timeout: 60000 }).toBe("nether");
  await friend.waitForFunction(() => window.__monecraft!.net?.status() === "online", undefined, { timeout: 30000 });
  await friend.waitForFunction(() => window.__monecraft!.renderer.renderedTriangles() > 0, undefined, { timeout: 30000 });

  // Reunited: both replicas hold both players in the nether.
  for (const page of [host, friend]) {
    await expect.poll(() => page.evaluate(() => window.__monecraft!.engine.state.players.size), { timeout: 30000 }).toBe(2);
  }

  // ── the host rides the arrival portal home ─────────────────────────────────
  // Arrival latched the dwell: WALK out (sub-clamp steps — the traveler isn't
  // flying anymore, and a teleport-sized hop would be refused server-side, so
  // the server would never see them leave and the latch would never clear),
  // then walk back in. One pad cell south is open by the arrival build's
  // construction.
  await host.bringToFront();
  const arrival = await host.evaluate(() => {
    const s = window.__monecraft!.engine.state;
    return { x: Math.floor(s.player.position.x), y: Math.floor(s.player.position.y), z: Math.floor(s.player.position.z) };
  });
  await walkTo(host, { x: arrival.x + 0.5, y: arrival.y, z: arrival.z + 1.5 });
  await host.waitForTimeout(600); // a few server ticks outside the surface clears the latch
  await walkTo(host, { x: arrival.x + 0.5, y: arrival.y, z: arrival.z + 0.5 });
  await expect.poll(() => dimensionOf(host), { timeout: 60000 }).toBe("overworld");
  await host.waitForFunction(() => window.__monecraft!.renderer.renderedTriangles() > 0, undefined, { timeout: 30000 });

  // Split again, mirrored: the friend (still in the nether) sees the host leave.
  await expect.poll(() => friend.evaluate(() => window.__monecraft!.engine.state.players.size), { timeout: 30000 }).toBe(1);
  await expect
    .poll(() => host.evaluate(() => window.__monecraft!.net!.roster().find((m) => m.id !== window.__monecraft!.net!.playerId)?.dimension), {
      timeout: 30000
    })
    .toBe("nether");

  expect(errors, "no console/page errors during the test").toEqual([]);
  await hostContext.close();
  await friendContext.close();
});
