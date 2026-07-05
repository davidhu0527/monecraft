import { afterEach, describe, expect, mock, test } from "bun:test";
import type { GameEngine } from "@/lib/game/engine/GameEngine";
import { TOUCH_HOLD_MINE_MS, TOUCH_JOYSTICK_RADIUS_PX, TOUCH_LOOK_SENSITIVITY, TOUCH_SPRINT_DOUBLE_TAP_MS, TOUCH_TAP_MAX_MS } from "@/lib/game/config";
import { createTouchInputController, type TouchInputController } from "./touchInputController";

/**
 * The whole gesture state machine runs against a stub engine and a fake
 * clock/scheduler — no DOM beyond the visibilitychange listener, which is
 * covered via a real document event.
 */

function makeStubEngine(inventory: Array<{ effect?: string } | undefined> = []) {
  const dispatch = mock((...args: unknown[]) => {
    void args;
  });
  const applyLook = mock((...args: unknown[]) => {
    void args;
  });
  const engine = {
    state: { paused: false, inventoryOpen: false, advancementsOpen: false, isDead: false, inventory, selectedSlot: 0 },
    dispatch,
    applyLook
  } as unknown as GameEngine;
  return { engine, dispatch, applyLook };
}

/** Deterministic time + timer queue. */
function makeClock() {
  let t = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  return {
    now: () => t,
    schedule: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    cancel: (id: number) => void timers.delete(id),
    advance(ms: number) {
      t += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= t) {
          timers.delete(id);
          timer.fn();
        }
      }
    }
  };
}

let controller: TouchInputController | null = null;

afterEach(() => {
  controller?.dispose();
  controller = null;
});

function setup(inventory: Array<{ effect?: string } | undefined> = []) {
  const { engine, dispatch, applyLook } = makeStubEngine(inventory);
  const clock = makeClock();
  const onLockChange = mock(() => {});
  controller = createTouchInputController({ engine, onLockChange, now: clock.now, schedule: clock.schedule, cancel: clock.cancel });
  controller.engage();
  onLockChange.mockClear();
  return { engine, dispatch, applyLook, clock, onLockChange, c: controller };
}

const R = TOUCH_JOYSTICK_RADIUS_PX;

describe("joystick", () => {
  test("maps 8-way sectors and the deadzone to move intents", () => {
    const { c } = setup();
    c.controls.joystickDown({ pointerId: 1, x: 0, y: 0 });
    expect(c.input.move.forward || c.input.move.back || c.input.move.left || c.input.move.right).toBe(false); // deadzone

    c.controls.joystickMove({ pointerId: 1, x: 0, y: -R }); // push up = forward
    expect(c.input.move).toMatchObject({ forward: true, back: false, left: false, right: false });

    c.controls.joystickMove({ pointerId: 1, x: R, y: -R }); // up-right diagonal
    expect(c.input.move).toMatchObject({ forward: true, right: true, back: false, left: false });

    c.controls.joystickMove({ pointerId: 1, x: -R, y: R * 0.2 }); // hard left, slight down: pure left
    expect(c.input.move).toMatchObject({ left: true, forward: false, back: false, right: false });

    c.controls.joystickUp(1);
    expect(c.input.move).toMatchObject({ forward: false, back: false, left: false, right: false });
  });

  test("quick re-engage latches sprint, applied only while pushing forward", () => {
    const { c, clock } = setup();
    c.controls.joystickDown({ pointerId: 1, x: 0, y: -R });
    c.controls.joystickUp(1);
    clock.advance(TOUCH_SPRINT_DOUBLE_TAP_MS - 50);
    c.controls.joystickDown({ pointerId: 1, x: 0, y: -R });
    expect(c.input.move.sprint).toBe(true);

    c.controls.joystickMove({ pointerId: 1, x: R, y: 0 }); // veer to pure right: no sprint sideways
    expect(c.input.move.sprint).toBe(false);
    c.controls.joystickMove({ pointerId: 1, x: 0, y: -R });
    expect(c.input.move.sprint).toBe(true);
    c.controls.joystickUp(1);
    expect(c.input.move.sprint).toBe(false);
  });

  test("a slow re-engage does not sprint", () => {
    const { c, clock } = setup();
    c.controls.joystickDown({ pointerId: 1, x: 0, y: -R });
    c.controls.joystickUp(1);
    clock.advance(TOUCH_SPRINT_DOUBLE_TAP_MS + 100);
    c.controls.joystickDown({ pointerId: 1, x: 0, y: -R });
    expect(c.input.move.sprint).toBe(false);
  });

  test("ignores moves from a pointer that does not own the stick", () => {
    const { c } = setup();
    c.controls.joystickDown({ pointerId: 1, x: 0, y: -R });
    c.controls.joystickMove({ pointerId: 9, x: R, y: 0 });
    expect(c.input.move).toMatchObject({ forward: true, right: false });
  });
});

describe("look gestures", () => {
  test("drag applies look deltas with the touch sensitivity and sign convention", () => {
    const { c, applyLook } = setup();
    c.controls.lookDown({ pointerId: 2, x: 100, y: 100 });
    c.controls.lookMove({ pointerId: 2, x: 130, y: 90 });
    expect(applyLook).toHaveBeenCalledWith(-30 * TOUCH_LOOK_SENSITIVITY, 10 * TOUCH_LOOK_SENSITIVITY);
    c.controls.lookUp(2);
  });

  test("a quick still tap dispatches exactly one attack", () => {
    const { c, dispatch, clock } = setup();
    c.controls.lookDown({ pointerId: 2, x: 100, y: 100 });
    clock.advance(TOUCH_TAP_MAX_MS - 100);
    c.controls.lookUp(2);
    expect(dispatch.mock.calls.filter(([cmd]) => (cmd as { type: string }).type === "attack")).toHaveLength(1);
  });

  test("a slow lift is not a tap; a drifted lift is not a tap", () => {
    const { c, dispatch, clock } = setup();
    c.controls.lookDown({ pointerId: 2, x: 100, y: 100 });
    clock.advance(TOUCH_TAP_MAX_MS + 300);
    c.controls.lookUp(2);

    c.controls.lookDown({ pointerId: 3, x: 100, y: 100 });
    c.controls.lookMove({ pointerId: 3, x: 160, y: 100 }); // way past slop
    clock.advance(50);
    c.controls.lookUp(3);
    // The hold timer fired during the slow lift while still within slop -> that
    // one counts as a mine-start attack; assert no TAP attacks beyond it.
    const attacks = dispatch.mock.calls.filter(([cmd]) => (cmd as { type: string }).type === "attack");
    expect(attacks.length).toBeLessThanOrEqual(1);
  });

  test("holding still starts mining (attack once, mineHeld until lift), and drags keep it digging", () => {
    const { c, dispatch, clock } = setup();
    c.controls.lookDown({ pointerId: 2, x: 100, y: 100 });
    expect(c.input.mineHeld).toBe(false);
    clock.advance(TOUCH_HOLD_MINE_MS);
    expect(c.input.mineHeld).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: "attack" });

    c.controls.lookMove({ pointerId: 2, x: 200, y: 140 }); // aim adjust mid-dig
    expect(c.input.mineHeld).toBe(true);

    c.controls.lookUp(2);
    expect(c.input.mineHeld).toBe(false);
    // The lift after mining is not also a tap.
    expect(dispatch.mock.calls.filter(([cmd]) => (cmd as { type: string }).type === "attack")).toHaveLength(1);
  });

  test("a drag past slop before the hold timer never mines", () => {
    const { c, clock } = setup();
    c.controls.lookDown({ pointerId: 2, x: 100, y: 100 });
    c.controls.lookMove({ pointerId: 2, x: 140, y: 100 });
    clock.advance(TOUCH_HOLD_MINE_MS * 3);
    expect(c.input.mineHeld).toBe(false);
    c.controls.lookUp(2);
  });

  test("pointercancel clears the gesture without an attack", () => {
    const { c, dispatch, clock } = setup();
    c.controls.lookDown({ pointerId: 2, x: 100, y: 100 });
    clock.advance(50);
    c.controls.lookCancel(2);
    expect(dispatch).not.toHaveBeenCalledWith({ type: "attack" });
    expect(c.input.mineHeld).toBe(false);
  });

  test("a second look pointer is ignored while the first owns the gesture", () => {
    const { c, applyLook } = setup();
    c.controls.lookDown({ pointerId: 2, x: 100, y: 100 });
    c.controls.lookDown({ pointerId: 7, x: 300, y: 300 });
    c.controls.lookMove({ pointerId: 7, x: 340, y: 300 });
    expect(applyLook).not.toHaveBeenCalled();
    c.controls.lookUp(2);
  });

  test("joystick and look pointers work concurrently without cross-talk", () => {
    const { c, applyLook } = setup();
    c.controls.joystickDown({ pointerId: 1, x: 0, y: -R });
    c.controls.lookDown({ pointerId: 2, x: 200, y: 200 });
    c.controls.lookMove({ pointerId: 2, x: 220, y: 200 });
    expect(c.input.move.forward).toBe(true);
    expect(applyLook).toHaveBeenCalledTimes(1);
    c.controls.joystickUp(1);
    c.controls.lookUp(2);
  });
});

describe("action buttons", () => {
  test("jump holds the intent; double-tap toggles flight and consumes the pair", () => {
    const { c, dispatch, clock } = setup();
    c.controls.buttonDown("jump");
    expect(c.input.move.jump).toBe(true);
    c.controls.buttonUp("jump");
    expect(c.input.move.jump).toBe(false);

    clock.advance(100); // within the fly window
    c.controls.buttonDown("jump");
    expect(dispatch).toHaveBeenCalledWith({ type: "toggleFlight" });
    c.controls.buttonUp("jump");
    clock.advance(100);
    c.controls.buttonDown("jump"); // third tap starts a fresh pair
    expect(dispatch.mock.calls.filter(([cmd]) => (cmd as { type: string }).type === "toggleFlight")).toHaveLength(1);
    c.controls.buttonUp("jump");
  });

  test("sneak is a latching toggle exposed for aria-pressed", () => {
    const { c } = setup();
    expect(c.controls.sneakLatched).toBe(false);
    c.controls.buttonDown("sneak");
    expect(c.input.move.crouch).toBe(true);
    expect(c.controls.sneakLatched).toBe(true);
    c.controls.buttonUp("sneak");
    expect(c.input.move.crouch).toBe(true); // still latched
    c.controls.buttonDown("sneak");
    expect(c.input.move.crouch).toBe(false);
  });

  test("place dispatches placeBlock; eat picks eatFood vs drinkPotion by the held slot", () => {
    const { c, dispatch } = setup([{ effect: undefined }]);
    c.controls.buttonDown("place");
    expect(dispatch).toHaveBeenCalledWith({ type: "placeBlock" });
    c.controls.buttonDown("eat");
    expect(dispatch).toHaveBeenCalledWith({ type: "eatFood" });

    // The afterEach only disposes the LAST setup()'s controller — dispose the
    // first one here or its visibilitychange listener leaks into later tests.
    c.dispose();
    const potion = setup([{ effect: "haste" }]);
    potion.c.controls.buttonDown("eat");
    expect(potion.dispatch).toHaveBeenCalledWith({ type: "drinkPotion" });
  });
});

describe("gates and lifecycle", () => {
  test("nothing works before engage() or while a panel is open", () => {
    const { engine, dispatch, applyLook } = makeStubEngine([]);
    const clk = makeClock();
    controller = createTouchInputController({ engine, onLockChange: () => {}, now: clk.now, schedule: clk.schedule, cancel: clk.cancel });
    const c = controller;

    c.controls.joystickDown({ pointerId: 1, x: 0, y: -R }); // not engaged yet
    expect(c.input.move.forward).toBe(false);
    c.controls.lookDown({ pointerId: 2, x: 0, y: 0 });
    clk.advance(TOUCH_HOLD_MINE_MS * 2);
    expect(c.input.mineHeld).toBe(false);

    c.engage();
    (engine.state as { paused: boolean }).paused = true;
    c.controls.buttonDown("place");
    expect(dispatch).not.toHaveBeenCalledWith({ type: "placeBlock" });
    (engine.state as { paused: boolean }).paused = false;
    expect(applyLook).not.toHaveBeenCalled();
  });

  test("engage/release fire onLockChange; forcePointerLock does not", () => {
    const { engine } = makeStubEngine();
    const onLockChange = mock(() => {});
    const clk = makeClock();
    controller = createTouchInputController({ engine, onLockChange, now: clk.now, schedule: clk.schedule, cancel: clk.cancel });

    controller.engage();
    expect(onLockChange).toHaveBeenCalledWith(true);
    controller.release();
    expect(onLockChange).toHaveBeenCalledWith(false);
    onLockChange.mockClear();
    controller.forcePointerLock(true);
    expect(controller.pointerLocked).toBe(true);
    expect(onLockChange).not.toHaveBeenCalled();
  });

  test("clearKeys drops gestures, latches, and mineHeld", () => {
    const { c, clock } = setup();
    c.controls.joystickDown({ pointerId: 1, x: 0, y: -R });
    c.controls.buttonDown("sneak");
    c.controls.lookDown({ pointerId: 2, x: 0, y: 0 });
    clock.advance(TOUCH_HOLD_MINE_MS);
    expect(c.input.mineHeld).toBe(true);

    c.clearKeys();
    expect(c.input).toMatchObject({ mineHeld: false, move: { forward: false, crouch: false, sprint: false, jump: false } });
    expect(c.controls.sneakLatched).toBe(false);
  });

  test("hiding the tab while active releases and pauses (the touch pointer-lock-loss analog)", () => {
    const { c, dispatch, onLockChange } = setup();
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onLockChange).toHaveBeenCalledWith(false);
    expect(dispatch).toHaveBeenCalledWith({ type: "pause" });
    expect(c.pointerLocked).toBe(false);
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
  });
});
