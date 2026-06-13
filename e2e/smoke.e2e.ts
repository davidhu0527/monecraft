import { acquirePointerLock, calmDaytime, expect, itemCount, playerPosition, test } from "./helpers";

test("boots without errors and renders the world", async ({ gamePage: page }) => {
  await expect(page.locator(".game-canvas-wrap canvas")).toBeVisible();
  await expect(page.getByTestId("hotbar")).toBeVisible();
  const triangles = await page.evaluate(() => window.__monecraft!.renderer.renderedTriangles());
  expect(triangles).toBeGreaterThan(0);

  // The audio director is wired up (still locked pre-gesture — the shared
  // console-error fixture proves boot stays clean without any unlock).
  expect(await page.evaluate(() => Boolean(window.__monecraft!.audio))).toBe(true);

  // The engine is alive: the day clock advances between frames.
  const clock1 = await page.evaluate(() => window.__monecraft!.engine.state.dayClock);
  await page.waitForTimeout(200);
  const clock2 = await page.evaluate(() => window.__monecraft!.engine.state.dayClock);
  expect(clock2).toBeGreaterThan(clock1);
});

test("pointer-lock flow enables WASD movement", async ({ gamePage: page }) => {
  await calmDaytime(page);
  await acquirePointerLock(page);

  await page.waitForTimeout(500); // settle onto the ground
  const before = await playerPosition(page);
  await page.keyboard.down("w");
  await page.waitForTimeout(700);
  await page.keyboard.up("w");
  const after = await playerPosition(page);

  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  expect(moved).toBeGreaterThan(0.5);
});

test("inventory opens and crafting works end to end", async ({ gamePage: page }) => {
  await calmDaytime(page);
  await page.keyboard.press("i");
  const panel = page.locator(".inventory-panel");
  await expect(panel).toBeVisible();

  const planksBefore = await itemCount(page, "planks"); // starter loadout: 20
  await panel.getByRole("button", { name: "2 Wood -> 4 Planks" }).click();

  expect(await itemCount(page, "planks")).toBe(planksBefore + 4);
  expect(await itemCount(page, "wood")).toBe(62);
  // The UI re-rendered from the new snapshot: the planks stack count updated.
  await expect(panel.locator('.inv-slot[title="Planks"]').first()).toContainText(`${planksBefore + 4}`);

  await page.keyboard.press("i");
  await expect(panel).not.toBeVisible();
});

test("holding the mouse mines the block underfoot", async ({ gamePage: page }) => {
  await calmDaytime(page);
  await acquirePointerLock(page);
  await page.waitForTimeout(1000); // settle (slow CI renderers need the margin)

  // Aim straight down from the center of the cell (a ray origin exactly on a
  // cell boundary may target the diagonal neighbor — see docs/testing.md).
  await page.evaluate(() => {
    const { player } = window.__monecraft!.engine.state;
    player.pitch = -Math.PI / 2 + 0.02;
    player.position.x = Math.floor(player.position.x) + 0.5;
    player.position.z = Math.floor(player.position.z) + 0.5;
  });

  await page.mouse.down();
  // Generous timeout: CI renders with software GL at single-digit FPS.
  await expect.poll(async () => page.evaluate(() => window.__monecraft!.engine.state.blockChanges.changes().length), { timeout: 30000 }).toBeGreaterThan(0);
  await page.mouse.up();
});

test("V cycles the camera views and the scene keeps rendering", async ({ gamePage: page }) => {
  await calmDaytime(page);
  const cameraMode = () => page.evaluate(() => window.__monecraft!.engine.state.cameraMode);

  expect(await cameraMode()).toBe("first");
  await page.keyboard.press("v");
  expect(await cameraMode()).toBe("third-rear");
  // The third-person scene (player body included) still draws.
  await expect.poll(() => page.evaluate(() => window.__monecraft!.renderer.renderedTriangles())).toBeGreaterThan(0);

  await page.keyboard.press("v");
  expect(await cameraMode()).toBe("third-front");
  await page.keyboard.press("v");
  expect(await cameraMode()).toBe("first");

  // V keeps working from the pause menu (render-only, like Minecraft F5).
  await page.keyboard.press("Escape"); // unlocked, so Escape pauses directly
  await expect(page.getByRole("button", { name: "Back to Game" })).toBeVisible();
  await page.keyboard.press("v");
  expect(await cameraMode()).toBe("third-rear");
  await page.keyboard.press("Escape"); // resume
});

test("the pause menu freezes the game and resumes it", async ({ gamePage: page }) => {
  await calmDaytime(page);
  await page.keyboard.press("Escape"); // unlocked, so Escape pauses directly
  await expect(page.getByRole("button", { name: "Back to Game" })).toBeVisible();

  const clock1 = await page.evaluate(() => window.__monecraft!.engine.state.dayClock);
  await page.waitForTimeout(250);
  const clock2 = await page.evaluate(() => window.__monecraft!.engine.state.dayClock);
  expect(clock2).toBe(clock1);

  await page.getByRole("button", { name: "Back to Game" }).click();
  await expect(page.getByRole("button", { name: "Back to Game" })).not.toBeVisible();
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__monecraft!.engine.state.dayClock)).toBeGreaterThan(clock2);
});

test("saving from the pause menu persists the world across a reload", async ({ gamePage: page }) => {
  await calmDaytime(page);
  const seed = await page.evaluate(() => window.__monecraft!.engine.state.world.seed);
  const positionBefore = await playerPosition(page);

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Save Game" }).click();
  const saved = await page.evaluate(() => localStorage.getItem("minecraft_save_v5"));
  expect(saved).not.toBeNull();
  expect(JSON.parse(saved!).seed).toBe(seed);
  expect(JSON.parse(saved!).version).toBe(2);

  await page.reload();
  await page.waitForFunction(() => window.__monecraft !== undefined, undefined, { timeout: 30000 });

  expect(await page.evaluate(() => window.__monecraft!.engine.state.world.seed)).toBe(seed);
  const positionAfter = await playerPosition(page);
  expect(Math.abs(positionAfter.x - positionBefore.x)).toBeLessThan(2);
  expect(Math.abs(positionAfter.z - positionBefore.z)).toBeLessThan(2);
});
