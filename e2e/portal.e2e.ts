import { expect, test } from "./helpers";

/**
 * Portal travel smoke: build a lit frame around the player programmatically
 * (ignition itself is unit-tested — this exercises what only a browser can:
 * the dwell → travel save → shell remount → nether boot chain, and that the
 * new renderer draws). Block ids are raw numbers because BlockId is a const
 * enum: 90 = Obsidian, 91 = NetherPortal.
 */
test("standing in a portal swaps the world into the nether and back out", async ({ gamePage: page }) => {
  test.setTimeout(120000);

  // A lit 2×3 frame materializes around the player's feet, standing on its
  // own obsidian bottom bar (so nothing falls), player centered inside.
  await page.evaluate(() => {
    const { engine } = window.__monecraft!;
    const s = engine.state;
    const px = Math.floor(s.player.position.x);
    const py = Math.floor(s.player.position.y);
    const pz = Math.floor(s.player.position.z);
    const bc = s.blockChanges;
    for (let i = -1; i <= 2; i += 1) {
      bc.set(px + i, py - 1, pz, 90);
      bc.set(px + i, py + 3, pz, 90);
    }
    for (let j = 0; j < 3; j += 1) {
      bc.set(px - 1, py + j, pz, 90);
      bc.set(px + 2, py + j, pz, 90);
    }
    for (let i = 0; i < 2; i += 1) {
      for (let j = 0; j < 3; j += 1) bc.set(px + i, py + j, pz, 91);
    }
    s.worldMeshDirty = true;
    s.player.position.set(px + 0.5, py, pz + 0.5);
    s.player.velocity.set(0, 0, 0);
  });

  // Dwell fires travel; the shell writes the travel save and remounts. The
  // handle is briefly torn down mid-swap, so poll defensively.
  await expect.poll(async () => page.evaluate(() => window.__monecraft?.engine?.state?.dimension ?? "swapping"), { timeout: 60000 }).toBe("nether");
  await page.waitForFunction(() => window.__monecraft!.renderer.renderedTriangles() > 0, undefined, { timeout: 30000 });

  // The arrival landed the player inside a portal, latched. Step out, step
  // back in, and ride it home.
  await page.evaluate(() => {
    const { engine } = window.__monecraft!;
    const s = engine.state;
    // Find the arrival portal's lowest cell near the player and stand beside it.
    const px = Math.floor(s.player.position.x);
    const py = Math.floor(s.player.position.y);
    const pz = Math.floor(s.player.position.z);
    // Step out (two blocks south is pad by construction), let the latch clear…
    s.player.position.set(px + 0.5, py, pz + 1.5);
  });
  await page.waitForTimeout(300); // a few frames out of the surface clears the latch
  await page.evaluate(() => {
    const { engine } = window.__monecraft!;
    const s = engine.state;
    const px = Math.floor(s.player.position.x);
    const py = Math.floor(s.player.position.y);
    const pz = Math.floor(s.player.position.z);
    // …then step back into the portal cell just north.
    s.player.position.set(px + 0.5, py, pz - 0.5);
    s.player.velocity.set(0, 0, 0);
  });
  await expect.poll(async () => page.evaluate(() => window.__monecraft?.engine?.state?.dimension ?? "swapping"), { timeout: 60000 }).toBe("overworld");
  await page.waitForFunction(() => window.__monecraft!.renderer.renderedTriangles() > 0, undefined, { timeout: 30000 });
});
