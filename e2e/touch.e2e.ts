import type { Page } from "@playwright/test";
import { calmDaytime, expect, playerPosition, test } from "./helpers";

/**
 * Touch play smoke on a landscape-phone viewport: the persisted "on" mode
 * forces the touch controller (device auto-detection is unit-tested — see the
 * touchMode fixture note in helpers.ts), and the overlay's handlers are
 * pointerType-agnostic, so page.mouse drives every gesture with real
 * PointerEvents. Gesture semantics (tap vs hold vs drag windows) are pinned in
 * touchInputController.test.ts; this is the journey through the real DOM.
 */

test.use({ touchMode: "on", hasTouch: true, viewport: { width: 812, height: 375 } });

/** The world boots unlocked; on touch the click-hint is a full-screen tap target. */
async function tapToPlay(page: Page): Promise<void> {
  await expect(page.getByText("Tap to play")).toBeVisible();
  await page.locator(".touch-tap-area").click({ position: { x: 400, y: 180 } });
  await page.waitForFunction(() => window.__monecraft!.input.pointerLocked);
  // The lock flag flips before React commits the overlay — wait for the DOM,
  // or an immediate gesture can land on nothing.
  await expect(page.getByTestId("touch-lookpad")).toBeVisible();
}

test("tap to play engages the touch controller and shows the controls", async ({ gamePage: page }) => {
  await tapToPlay(page);
  await expect(page.getByTestId("touch-joystick")).toBeVisible();
  await expect(page.getByTestId("touch-jump")).toBeVisible();
  await expect(page.getByTestId("touch-place")).toBeVisible();
  // No keyboard on touch: the CapsLock sprint indicator is gone.
  expect(await page.locator(".caps-indicator").count()).toBe(0);
});

test("pushing the joystick forward walks the player", async ({ gamePage: page }) => {
  await calmDaytime(page);
  await tapToPlay(page);
  await page.waitForTimeout(1000); // settle (slow CI renderers)

  const before = await playerPosition(page);
  const stick = await page.getByTestId("touch-joystick").boundingBox();
  const cx = stick!.x + stick!.width / 2;
  const cy = stick!.y + stick!.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // Discrete awaited moves to a larger offset: a single steps:N move lets CI's
  // slow compositor coalesce and DROP the trailing pointermoves, leaving the
  // stick in the deadzone (observed moved=0). Each awaited move lands as a
  // delivered event, so the stick reaches "forward" and holds there.
  for (let dy = 15; dy <= 70; dy += 15) await page.mouse.move(cx, cy - dy);
  await page.waitForTimeout(1500); // hold forward
  await page.mouse.up();

  const after = await playerPosition(page);
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  expect(moved).toBeGreaterThan(0.5);
});

test("dragging on the world turns the camera", async ({ gamePage: page }) => {
  await calmDaytime(page);
  await tapToPlay(page);
  await page.waitForTimeout(1000); // settle: the first seconds mesh chunks, and main-thread jank can swallow synthetic pointer moves

  const yawBefore = await page.evaluate(() => window.__monecraft!.engine.state.player.yaw);
  await page.mouse.move(400, 180);
  await page.mouse.down();
  // Individually-awaited moves across a longer sweep. A single `steps: N` move
  // lets CI's slow compositor coalesce and DROP the trailing pointermoves, so
  // only a fraction of the drag reaches the lookpad (observed ~18px of 150 —
  // barely a nudge). Discrete awaited moves each land as a delivered event
  // (pointer capture keeps them on the lookpad), so the whole sweep turns.
  for (let x = 440; x <= 680; x += 40) {
    await page.mouse.move(x, 180);
  }
  await page.waitForTimeout(200);
  await page.mouse.up();
  const yawAfter = await page.evaluate(() => window.__monecraft!.engine.state.player.yaw);
  // Dragging right looks right: applyLook(-dx * sensitivity) decreases yaw.
  // Direction + a meaningful turn is the contract; the exact magnitude depends
  // on how many moves survive CI's slow compositor.
  expect(yawAfter - yawBefore).toBeLessThan(-0.15);
});

test("press-and-hold on the world mines; lifting stops", async ({ gamePage: page }) => {
  await calmDaytime(page);
  await tapToPlay(page);
  await page.waitForTimeout(1000); // settle (see the drag test)

  await page.mouse.move(400, 180);
  await page.mouse.down();
  // mineHeld flips on a setTimeout(TOUCH_HOLD_MINE_MS); under CI timer
  // throttling it can land well after a fixed wait, so poll for it (10s — the
  // throttled timer has overrun 5s in CI) — reads don't move the pointer, so
  // the still-hold keeps counting toward the flip.
  await expect.poll(() => page.evaluate(() => window.__monecraft!.input.input.mineHeld), { timeout: 10000 }).toBe(true);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__monecraft!.input.input.mineHeld), { timeout: 10000 }).toBe(false);
});

test("the Place button places a block through the touch path", async ({ gamePage: page }) => {
  await calmDaytime(page);
  await tapToPlay(page);
  await page.waitForTimeout(1000); // settle

  // Carve a clear lane ending in a stone backstop (same fixture as the smoke
  // right-click test); slot 0 holds the starter grass blocks.
  await page.evaluate(() => {
    const state = window.__monecraft!.engine.state;
    const ex = Math.floor(state.player.position.x);
    const ez = Math.floor(state.player.position.z);
    state.player.position.x = ex + 0.5;
    state.player.position.z = ez + 0.5;
    state.player.yaw = 0;
    state.player.pitch = 0;
    const ey = Math.floor(state.player.position.y + 1.62);
    // 1 = Grass, 0 = Air, 3 = Stone (BlockId enum values).
    state.blockChanges.set(ex, ey, ez - 1, 0);
    state.blockChanges.set(ex, ey, ez - 2, 0);
    state.blockChanges.set(ex, ey, ez - 3, 3);
    state.selectedSlot = 0;
  });

  await page.getByTestId("touch-place").click();
  const placed = await page.evaluate(() => {
    const state = window.__monecraft!.engine.state;
    const ex = Math.floor(state.player.position.x);
    const ey = Math.floor(state.player.position.y + 1.62);
    const ez = Math.floor(state.player.position.z);
    return state.world.get(ex, ey, ez - 2);
  });
  expect(placed).toBe(1); // grass in the carved cell
});

test("the pause button pauses; Back to Game re-engages touch play", async ({ gamePage: page }) => {
  await calmDaytime(page);
  await tapToPlay(page);

  await page.getByTestId("touch-pause").click();
  expect(await page.evaluate(() => window.__monecraft!.engine.state.paused)).toBe(true);
  // Panels replace the overlay entirely.
  expect(await page.getByTestId("touch-joystick").count()).toBe(0);

  await page.getByRole("button", { name: "Back to Game" }).click();
  expect(await page.evaluate(() => window.__monecraft!.engine.state.paused)).toBe(false);
  // Touch engage() is synchronous — no pointer-lock round trip.
  expect(await page.evaluate(() => window.__monecraft!.input.pointerLocked)).toBe(true);
  await expect(page.getByTestId("touch-joystick")).toBeVisible();
});

test("the Options toggle hot-swaps the controller without leaving the world", async ({ gamePage: page }) => {
  await tapToPlay(page);
  await page.evaluate(() => {
    (window as unknown as { __prevInput: unknown }).__prevInput = window.__monecraft!.input;
  });

  await page.getByTestId("touch-pause").click();
  await page.getByRole("button", { name: "Options" }).click();
  await page.getByRole("button", { name: "Touch controls Off" }).click();

  // Same world, new controller: identity changed, overlay gone, desktop hint back.
  expect(await page.evaluate(() => window.__monecraft!.input === (window as unknown as { __prevInput: unknown }).__prevInput)).toBe(false);
  await page.getByRole("button", { name: "Back to Game" }).click();
  expect(await page.getByTestId("touch-joystick").count()).toBe(0);
  // Desktop scheme restored: the live controller is the desktop one (no touch
  // `controls` surface). The "Double-click to play" hint renders only while
  // unlocked (showClickHint = !locked), and CI's new-headless can grab pointer
  // lock on the resume click — hiding it — so assert the controller swap
  // directly rather than the lock-dependent hint.
  expect(await page.evaluate(() => "controls" in window.__monecraft!.input)).toBe(false);

  // And back on: Back to Game engages the fresh touch controller directly
  // (engage() is synchronous on touch — no tap-to-play round trip needed).
  //
  // force: true — we're now in DESKTOP mode on the 375-tall phone viewport, an
  // artificial combo where PauseMenu's pinned "Back to Game" (always on top)
  // visually overlaps the Options tab and intercepts the click. The tabs are
  // present and functional; force past the overlap rather than fight the layout.
  await page.evaluate(() => window.__monecraft!.engine.dispatch({ type: "pause" }));
  await expect(page.getByRole("button", { name: "Options" })).toBeVisible();
  await page.getByRole("button", { name: "Options" }).click({ force: true });
  await page.getByRole("button", { name: "Touch controls On" }).click({ force: true });
  await page.getByRole("button", { name: "Back to Game" }).click({ force: true });
  await page.waitForFunction(() => window.__monecraft!.input.pointerLocked);
  await expect(page.getByTestId("touch-joystick")).toBeVisible();
});
