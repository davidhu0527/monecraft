import { expect, type Page } from "@playwright/test";

/**
 * Shared plumbing for the two-browser online journeys (multiplayer.e2e.ts,
 * nether-online.e2e.ts): the account/registration menu walk and the "booted,
 * synced, drawing" bar every online entry must clear. Extracted verbatim from
 * the co-op journey so both specs drive the identical real stack.
 */

/**
 * Context viewport for the two-browser journeys. They run TWO live software-GL
 * render loops at once on the CI runner (which has no GPU), and raster cost
 * scales with pixels — a reduced viewport vs the 1280×720 default cuts each
 * page's render CPU ~2.6×, which is what keeps the rAF-driven pose stream,
 * mining progress, and prediction reconciliation running at real time under
 * load. These specs assert on `window.__monecraft` engine state, never pixels.
 * 640×360 proved TOO small — the Create World menu flow breaks below the
 * short-viewport breakpoints — so 800×450 is the floor that still menus.
 */
export const TWO_BROWSER_VIEWPORT = { width: 800, height: 450 };

/** Console/page errors collected like the smoke fixture does (favicon 404 is noise). */
export function watchErrors(page: Page, sink: string[]): void {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text().includes("Failed to load resource") && message.location().url.endsWith("/favicon.ico")) return;
    sink.push(`${message.text()} (${message.location().url})`);
  });
  page.on("pageerror", (error) => sink.push(String(error)));
}

/** Booted, synced, and drawing: the bar every online entry must clear. */
export async function waitForOnlineGame(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__monecraft !== undefined, undefined, { timeout: 30000 });
  await page.waitForFunction(() => window.__monecraft!.net?.status() === "online", undefined, { timeout: 30000 });
  await page.waitForFunction(() => window.__monecraft!.renderer.renderedTriangles() > 0, undefined, { timeout: 30000 });
}

/** Registers a fresh account: welcome gate's "Sign in" → auth screen → sign-up. */
export async function signUp(page: Page, name: string, email: string): Promise<void> {
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "I need an account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Password").fill("hunter2hunter2");
  await page.getByRole("button", { name: "Create account" }).click();
}

/** From the account home, creates an online profile and enters its world list. */
export async function createOnlineProfile(page: Page, name: string): Promise<void> {
  // Sign-up → session probe → account home spans two network hops.
  await expect(page.getByText("Online Profiles")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("new-online-profile").click();
  await page.getByLabel("Profile name").fill(name);
  // exact: "Create account" (form) and "Create World" share the substring.
  await page.getByRole("button", { name: "Create", exact: true }).click();
}

/**
 * Waits until the WITNESS's replica shows the PLACER at the placer's own local
 * pose — proof the pose has round-tripped placer → server → witness, so the
 * server's next command raycast (a placeBlock, or the `mineHeld` stream) runs
 * from the very aim the script computed. A blind post-aim sleep is NOT enough on
 * a loaded CI runner: the 20 Hz pose stream can lag the scripted aim by whole
 * seconds, and the server then acts on a STALE look direction. Tolerances sit
 * well above the wire quantization (2 decimals position, 3 decimals angles); yaw
 * compares wrap-aware. The witness renders remotes 125–450 ms in the past, which
 * the poll simply rides out. Callers that also hold a stronger downstream gate
 * (a held dig, placeAt's retry rounds) wrap this in try/catch as a best-effort
 * accelerator; the timeout defaults to the historic 5 s.
 */
export async function poseSettled(placer: Page, witness: Page, timeout = 5000): Promise<void> {
  const want = await placer.evaluate(() => {
    const p = window.__monecraft!.engine.state.player;
    return { x: p.position.x, y: p.position.y, z: p.position.z, yaw: p.yaw, pitch: p.pitch };
  });
  await expect
    .poll(
      () =>
        witness.evaluate((w) => {
          const s = window.__monecraft!.engine.state;
          // With exactly two players, "the other one" is the placer — no id plumbing.
          const remote = [...s.players.values()].find((p) => p !== s.player);
          if (!remote) return Number.POSITIVE_INFINITY;
          const wrap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
          const posDrift = Math.hypot(remote.position.x - w.x, remote.position.y - w.y, remote.position.z - w.z);
          return posDrift + wrap(remote.yaw, w.yaw) + wrap(remote.pitch, w.pitch);
        }, want),
      { timeout }
    )
    .toBeLessThan(0.08);
}

/**
 * Moves the (flying) player in ≤1-block hops. The 20 Hz pose stream keeps
 * `elapsed` at one tick server-side, so each pose may move at most
 * ~FLY_SPEED×1.6×0.05+0.5 ≈ 1.3 blocks — a bigger hop is refused and
 * force-posed back, which is exactly the stall this helper must avoid.
 */
export async function flyTo(page: Page, target: { x: number; y: number; z: number }, stepSize = 1, ignoreY = false): Promise<void> {
  let lastDist = Infinity;
  let stalled = 0;
  for (let hop = 0; hop < 400; hop += 1) {
    const dist = await page.evaluate(
      ({ t, stepSize: size, ignoreY: flat }) => {
        const p = window.__monecraft!.engine.state.player;
        const dx = t.x - p.position.x;
        const dy = flat ? 0 : t.y - p.position.y;
        const dz = t.z - p.position.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < 0.3) return 0;
        const step = Math.min(size, d);
        p.position.set(p.position.x + (dx / d) * step, p.position.y + (dy / d) * step, p.position.z + (dz / d) * step);
        p.velocity.set(0, 0, 0);
        return d;
      },
      { t: target, stepSize, ignoreY }
    );
    if (dist === 0) return;
    // Collision stall (a canopy or ledge the site scan couldn't see): the
    // physics keeps pushing the hop back. Dodge up-and-sideways and re-run —
    // the straight line re-forms from the new spot.
    stalled = lastDist - dist < 0.05 ? stalled + 1 : 0;
    lastDist = dist;
    if (stalled >= 5) {
      stalled = 0;
      lastDist = Infinity;
      await page.evaluate((h) => {
        const p = window.__monecraft!.engine.state.player;
        p.position.set(p.position.x + (h % 2 === 0 ? 0.8 : -0.8), p.position.y + 1.5, p.position.z);
        p.velocity.set(0, 0, 0);
      }, hop);
    }
    await page.waitForTimeout(120); // let the pose stream carry the hop
  }
  const debug = await page.evaluate(() => {
    const s = window.__monecraft!.engine.state;
    const p = s.player;
    const cell = { x: Math.floor(p.position.x), y: Math.floor(p.position.y), z: Math.floor(p.position.z) };
    return {
      pos: { x: p.position.x, y: p.position.y, z: p.position.z },
      isFlying: p.isFlying,
      dimension: s.dimension,
      status: window.__monecraft!.net?.status(),
      blockAt: s.world.get(cell.x, cell.y, cell.z),
      blockBelow: s.world.get(cell.x, cell.y - 1, cell.z)
    };
  });
  throw new Error(`could not reach ${JSON.stringify(target)}; player=${JSON.stringify(debug)}`);
}

/**
 * Ground movement: sub-clamp steps (a NON-flying player's per-pose allowance
 * is under a block at the 20 Hz cadence) on the XZ plane only — gravity owns
 * y, and chasing a captured y that physics has since settled away from would
 * stall forever against the ground.
 */
export const walkTo = (page: Page, target: { x: number; y: number; z: number }) => flyTo(page, target, 0.8, true);

/**
 * Walks the player off its current column onto a nearby one whose top solid
 * block has clear air above — a guaranteed straight-down dig target. Both
 * players spawn at the SAME deterministic center-land point (findSpawnOnLand),
 * so once one digs a shaft the other can fall into it, over the aquifer the
 * shaft reached, where digging straight down finds only air and water. Call
 * this while the ground is still pristine (before the other player digs) and
 * before any simulated latency, so the walk syncs cleanly. `highestSolidY`
 * skips water/air, so the surface is always solid; in Creative the break is
 * instant regardless of tool, so any solid surface is diggable.
 */
export async function walkToDiggableGround(page: Page): Promise<void> {
  const site = await page.evaluate(() => {
    const s = window.__monecraft!.engine.state;
    const p = s.player;
    const sx = Math.round(p.position.x);
    const sz = Math.round(p.position.z);
    const clearSurface = (x: number, z: number) => {
      if (x < 2 || z < 2 || x >= s.world.sizeX - 2 || z >= s.world.sizeZ - 2) return null;
      const y = s.world.highestSolidY(x, z); // highest SOLID block — never water/air
      return s.world.get(x, y + 1, z) === 0 && s.world.get(x, y + 2, z) === 0 ? { x, y, z } : null;
    };
    for (let r = 4; r <= 24; r += 1) {
      for (const [dx, dz] of [
        [r, 0],
        [0, r],
        [-r, 0],
        [0, -r],
        [r, r],
        [-r, -r],
        [r, -r],
        [-r, r]
      ] as const) {
        const hit = clearSurface(sx + dx, sz + dz);
        if (hit) return hit;
      }
    }
    return null;
  });
  if (!site) throw new Error("no clear solid-surface column within 24 blocks to dig on");
  await walkTo(page, { x: site.x + 0.5, y: site.y + 1, z: site.z + 0.5 });
}
