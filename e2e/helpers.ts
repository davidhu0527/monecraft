import { test as base, expect, type Page } from "@playwright/test";

/**
 * Shared E2E plumbing. Tests assert against the live simulation through the
 * window.__monecraft debug handle rather than pixels — see docs/testing.md.
 */

export const test = base.extend<{ gamePage: Page }>({
  // A page that has booted the game, with console errors treated as failures.
  // (The fixture continuation is named `runTest`, not Playwright's
  // conventional `use`, to avoid colliding with React's rules-of-hooks lint.)
  gamePage: async ({ page }, runTest) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      // The app ships no favicon; Chrome's automatic /favicon.ico 404 is noise.
      if (message.text().includes("Failed to load resource") && message.location().url.endsWith("/favicon.ico")) return;
      errors.push(`${message.text()} (${message.location().url})`);
    });
    page.on("pageerror", (error) => errors.push(String(error)));

    await page.goto("/");
    await page.waitForFunction(() => window.__monecraft !== undefined, undefined, { timeout: 30000 });
    // Wait for the first frames so the engine has stepped and the scene drew.
    await page.waitForFunction(() => window.__monecraft!.renderer.renderedTriangles() > 0, undefined, { timeout: 30000 });

    await runTest(page);

    expect(errors, "no console/page errors during the test").toEqual([]);
  }
});

export { expect };

/**
 * The game boots at dawn with aggro hostiles near the spawn; interactive
 * tests clear them and move to midday so knockback can't disrupt input.
 */
export async function calmDaytime(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__monecraft!.engine.state;
    state.mobs = state.mobs.filter((mob) => !mob.hostile);
    state.dayClock = 60;
  });
}

export async function playerPosition(page: Page): Promise<{ x: number; y: number; z: number }> {
  return page.evaluate(() => {
    const { position } = window.__monecraft!.engine.state.player;
    return { x: position.x, y: position.y, z: position.z };
  });
}

/**
 * Double-clicks the canvas to request pointer lock; if the browser refuses
 * (headless Chromium cannot engage pointer lock at all), forces the input
 * controller's lock flag so everything downstream — keys → engine, held mouse
 * → mining — is still exercised for real. The acquisition UX itself stays in
 * the manual gameplay pass.
 */
export async function acquirePointerLock(page: Page): Promise<void> {
  const canvas = page.locator(".game-canvas-wrap canvas");
  await canvas.dblclick();
  try {
    await page.waitForFunction(() => document.pointerLockElement !== null, undefined, { timeout: 2000 });
  } catch {
    await page.evaluate(() => {
      window.__monecraft!.input.input.pointerLocked = true;
    });
  }
}

export async function itemCount(page: Page, itemId: string): Promise<number> {
  return page.evaluate((id) => window.__monecraft!.engine.state.inventory.filter((slot) => slot.id === id).reduce((sum, slot) => sum + slot.count, 0), itemId);
}
