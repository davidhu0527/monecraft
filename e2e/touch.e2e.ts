import type { Page } from "@playwright/test";
import { calmDaytime, expect, playerPosition, test } from "./helpers";

/**
 * Touch play smoke on a landscape-phone viewport: the persisted "on" mode
 * forces the touch controller (device auto-detection is unit-tested — see the
 * touchMode fixture note in helpers.ts). Gesture semantics (tap vs hold vs drag
 * windows) are pinned in touchInputController.test.ts; this is the journey
 * through the real DOM.
 *
 * Input driving, by reliability on the headless software-GL CI runner:
 *   - discrete taps/clicks (tap-to-play, buttons): page click — fine.
 *   - EVERY sustained gesture (joystick push, look drag, press-and-hold):
 *     driven at the controller API the overlay itself calls
 *     (window.__monecraft.input.controls). Neither page.mouse nor
 *     dispatchEvent delivers pointer events to the overlay's React handlers
 *     reliably in CI — pointermove provably never arrives, and the
 *     press-and-hold pointerdown was the last holdout, flaking for months
 *     before failing whole runs under 2-worker load. The DOM pointer→controls
 *     wiring is covered by TouchControls.test.tsx; here we still exercise the
 *     real controller→engine integration (timers included) in the running app.
 */

type TouchPoint = { pointerId: number; x: number; y: number };
type TouchControls = {
  joystickDown(p: TouchPoint): void;
  joystickMove(p: TouchPoint): void;
  joystickUp(id: number): void;
  lookDown(p: TouchPoint): void;
  lookMove(p: TouchPoint): void;
  lookUp(id: number): void;
};

test.use({ touchMode: "on", hasTouch: true, viewport: { width: 812, height: 375 } });

/**
 * Click a pause-menu button by its handler, not a hit-test. The pause menu is a
 * scrollable grid (max-height:100dvh, overflow-y:auto — app/hud.css) and on the
 * 375-tall viewport its buttons overflow, so a real click can land on whatever
 * the compositor put on top ("Back to Game") after a scroll. dispatchEvent fires
 * the target button's onClick directly, immune to overlap/scroll.
 */
async function menuClick(page: Page, name: string): Promise<void> {
  const button = page.getByRole("button", { name });
  await expect(button).toBeVisible();
  await button.dispatchEvent("click");
}

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
  // Push and hold the stick forward via the controls API (see the file header).
  // Coords are stick-center-relative; y < 0 is forward, well past the deadzone.
  await page.evaluate(() => {
    const c = (window.__monecraft!.input as unknown as { controls: TouchControls }).controls;
    c.joystickDown({ pointerId: 1, x: 0, y: 0 });
    c.joystickMove({ pointerId: 1, x: 0, y: -70 });
  });
  await page.waitForTimeout(1500); // hold forward; the engine accumulates the walk
  await page.evaluate(() => (window.__monecraft!.input as unknown as { controls: TouchControls }).controls.joystickUp(1));

  const after = await playerPosition(page);
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  expect(moved).toBeGreaterThan(0.5);
});

test("dragging on the world turns the camera", async ({ gamePage: page }) => {
  await calmDaytime(page);
  await tapToPlay(page);
  await page.waitForTimeout(1000); // settle: the first seconds mesh chunks, and main-thread jank can swallow synthetic pointer moves

  const yawBefore = await page.evaluate(() => window.__monecraft!.engine.state.player.yaw);
  // Sweep the look gesture via the controls API (see the file header). lookMove
  // takes viewport px; only deltas matter, and dragging right decreases yaw
  // (applyLook(-dx * sensitivity)).
  await page.evaluate(() => {
    const c = (window.__monecraft!.input as unknown as { controls: TouchControls }).controls;
    c.lookDown({ pointerId: 1, x: 400, y: 180 });
    for (let x = 440; x <= 680; x += 40) c.lookMove({ pointerId: 1, x, y: 180 });
    c.lookUp(1);
  });
  const yawAfter = await page.evaluate(() => window.__monecraft!.engine.state.player.yaw);
  expect(yawAfter - yawBefore).toBeLessThan(-0.15);
});

test("press-and-hold on the world mines; lifting stops", async ({ gamePage: page }) => {
  // The mine intent fires from a real window.setTimeout (TOUCH_HOLD_MINE_MS =
  // 220 ms) in the controller — a wall-clock timer, not an engine tick. On the
  // 2-worker software-GL runner the main thread can be blocked long enough to
  // delay that timer by many seconds, so the polls below must be generous (the
  // 10 s they used flaked at retries: 0); give the whole test room to match.
  test.setTimeout(90000);
  await calmDaytime(page);
  await tapToPlay(page);
  await page.waitForTimeout(1000); // settle (see the drag test)

  // Press and hold within slop — no move, so it classifies as a mine after
  // TOUCH_HOLD_MINE_MS. Driven at the controller API like the joystick/drag
  // tests: this was the last touch test on a dispatched DOM pointer event, and
  // it graduated from "flaky" to failing whole CI runs — the pointerdown→
  // lookDown DOM wiring is pinned by TouchControls.test.tsx, and the
  // hold-vs-look classification windows by touchInputController.test.ts; here we
  // prove the live controller→input→engine seam with the real timer.
  await page.evaluate(() => {
    (window.__monecraft!.input as unknown as { controls: TouchControls }).controls.lookDown({ pointerId: 1, x: 400, y: 180 });
  });
  await expect.poll(() => page.evaluate(() => window.__monecraft!.input.input.mineHeld), { timeout: 30000 }).toBe(true);
  await page.evaluate(() => (window.__monecraft!.input as unknown as { controls: TouchControls }).controls.lookUp(1));
  await expect.poll(() => page.evaluate(() => window.__monecraft!.input.input.mineHeld), { timeout: 20000 }).toBe(false);
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
  await menuClick(page, "Options");
  await menuClick(page, "Touch controls Off");

  // Same world, new controller: identity changed, overlay gone, desktop hint back.
  expect(await page.evaluate(() => window.__monecraft!.input === (window as unknown as { __prevInput: unknown }).__prevInput)).toBe(false);
  await menuClick(page, "Back to Game");
  expect(await page.getByTestId("touch-joystick").count()).toBe(0);
  // Desktop scheme restored: the live controller is the desktop one (no touch
  // `controls` surface). The "Double-click to play" hint renders only while
  // unlocked (showClickHint = !locked), and CI's new-headless can grab pointer
  // lock on the resume click — hiding it — so assert the controller swap
  // directly rather than the lock-dependent hint.
  expect(await page.evaluate(() => "controls" in window.__monecraft!.input)).toBe(false);

  // And back on: Back to Game engages the fresh touch controller directly
  // (engage() is synchronous on touch — no tap-to-play round trip needed).
  await page.evaluate(() => window.__monecraft!.engine.dispatch({ type: "pause" }));
  await menuClick(page, "Options");
  await menuClick(page, "Touch controls On");
  await menuClick(page, "Back to Game");
  await page.waitForFunction(() => window.__monecraft!.input.pointerLocked);
  await expect(page.getByTestId("touch-joystick")).toBeVisible();
});
