import type { Locator, Page } from "@playwright/test";
import { calmDaytime, expect, playerPosition, test } from "./helpers";

/**
 * Touch play smoke on a landscape-phone viewport: the persisted "on" mode
 * forces the touch controller (device auto-detection is unit-tested — see the
 * touchMode fixture note in helpers.ts). Gesture semantics (tap vs hold vs drag
 * windows) are pinned in touchInputController.test.ts; this is the journey
 * through the real DOM.
 *
 * Sustained gestures (joystick hold, look drag, hold-to-mine) are driven by
 * dispatching PointerEvents straight to the overlay element rather than via
 * page.mouse: on the headless software-GL CI runner, page.mouse's down+move+hold
 * sequences have their coalesced pointermoves dropped and their hit-tests race
 * the compositor, so the gesture silently never engages (discrete taps/clicks
 * are fine — those tests use page click). dispatchEvent invokes the React
 * handler directly with exact coords, so the input deterministically lands.
 */

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

/** Fire a PointerEvent straight at an overlay element (see the file header). */
async function pointer(target: Locator, type: "pointerdown" | "pointermove" | "pointerup", x: number, y: number): Promise<void> {
  await target.dispatchEvent(type, {
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    clientX: x,
    clientY: y,
    button: type === "pointermove" ? -1 : 0,
    buttons: type === "pointerup" ? 0 : 1,
    bubbles: true,
    cancelable: true
  });
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
  const joystick = page.getByTestId("touch-joystick");
  const stick = await joystick.boundingBox();
  const cx = stick!.x + stick!.width / 2;
  const cy = stick!.y + stick!.height / 2;
  // Push and hold the stick fully forward (well past the deadzone); the engine
  // accumulates the walk while the offset stays set.
  await pointer(joystick, "pointerdown", cx, cy);
  await pointer(joystick, "pointermove", cx, cy - 70);
  await page.waitForTimeout(1500); // hold forward
  await pointer(joystick, "pointerup", cx, cy - 70);

  const after = await playerPosition(page);
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  if (moved <= 0.5) {
    // On a still-failing CI run, show whether the forward intent even registered.
    const move = await page.evaluate(() => (window.__monecraft!.input.input as { move?: unknown }).move ?? null);
    console.log(`JOYSTICK-DEBUG moved=${moved.toFixed(3)} move=${JSON.stringify(move)}`);
  }
  expect(moved).toBeGreaterThan(0.5);
});

test("dragging on the world turns the camera", async ({ gamePage: page }) => {
  await calmDaytime(page);
  await tapToPlay(page);
  await page.waitForTimeout(1000); // settle: the first seconds mesh chunks, and main-thread jank can swallow synthetic pointer moves

  const yawBefore = await page.evaluate(() => window.__monecraft!.engine.state.player.yaw);
  const lookpad = page.getByTestId("touch-lookpad");
  await pointer(lookpad, "pointerdown", 400, 180);
  for (let x = 440; x <= 680; x += 40) await pointer(lookpad, "pointermove", x, 180);
  await pointer(lookpad, "pointerup", 680, 180);
  const yawAfter = await page.evaluate(() => window.__monecraft!.engine.state.player.yaw);
  // Dragging right looks right: applyLook(-dx * sensitivity) decreases yaw. The
  // handler applies look synchronously per move, so dispatching the full 280px
  // sweep turns the camera regardless of CI rAF throttling.
  expect(yawAfter - yawBefore).toBeLessThan(-0.15);
});

test("press-and-hold on the world mines; lifting stops", async ({ gamePage: page }) => {
  await calmDaytime(page);
  await tapToPlay(page);
  await page.waitForTimeout(1000); // settle (see the drag test)

  const lookpad = page.getByTestId("touch-lookpad");
  // Press and hold within slop — no move, so it classifies as a mine after
  // TOUCH_HOLD_MINE_MS. mineHeld flips on a setTimeout; poll for it (CI timer
  // throttling can land it late) — the reads don't move the pointer, so the
  // still-hold keeps counting.
  await pointer(lookpad, "pointerdown", 400, 180);
  await expect.poll(() => page.evaluate(() => window.__monecraft!.input.input.mineHeld), { timeout: 10000 }).toBe(true);
  await pointer(lookpad, "pointerup", 400, 180);
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
