import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import TouchControls from "@/components/game/TouchControls";
import type { TouchControlsApi } from "@/lib/game/input/touchInputController";

/**
 * The overlay is dumb by contract: these tests only assert that PointerEvents
 * route to the right TouchControlsApi calls with the right coordinates. All
 * gesture semantics are covered in touchInputController.test.ts.
 */

function makeApi(): TouchControlsApi & Record<string, ReturnType<typeof mock>> {
  return {
    joystickDown: mock((...a: unknown[]) => void a),
    joystickMove: mock((...a: unknown[]) => void a),
    joystickUp: mock((...a: unknown[]) => void a),
    lookDown: mock((...a: unknown[]) => void a),
    lookMove: mock((...a: unknown[]) => void a),
    lookUp: mock((...a: unknown[]) => void a),
    lookCancel: mock((...a: unknown[]) => void a),
    buttonDown: mock((...a: unknown[]) => void a),
    buttonUp: mock((...a: unknown[]) => void a),
    sneakLatched: false
  } as never;
}

function renderControls(overrides: Partial<Parameters<typeof TouchControls>[0]> = {}) {
  const api = makeApi();
  const props = {
    controls: api as TouchControlsApi,
    showEat: false,
    isFlying: false,
    onPause: mock(() => {}),
    onOpenInventory: mock(() => {}),
    onToggleCamera: mock(() => {}),
    onDeactivate: mock(() => {}),
    ...overrides
  };
  const view = render(<TouchControls {...props} />);
  return { api, props, view };
}

describe("TouchControls", () => {
  test("look pad routes down/move/up/cancel with pointer ids and viewport coords", () => {
    const { api } = renderControls();
    const pad = screen.getByTestId("touch-lookpad");
    fireEvent.pointerDown(pad, { pointerId: 7, clientX: 300, clientY: 120 });
    expect(api.lookDown).toHaveBeenCalledWith({ pointerId: 7, x: 300, y: 120 });
    fireEvent.pointerMove(pad, { pointerId: 7, clientX: 320, clientY: 110 });
    expect(api.lookMove).toHaveBeenCalledWith({ pointerId: 7, x: 320, y: 110 });
    fireEvent.pointerUp(pad, { pointerId: 7 });
    expect(api.lookUp).toHaveBeenCalledWith(7);
    fireEvent.pointerDown(pad, { pointerId: 8, clientX: 1, clientY: 1 });
    fireEvent.pointerCancel(pad, { pointerId: 8 });
    expect(api.lookCancel).toHaveBeenCalledWith(8);
  });

  test("joystick passes center-relative coordinates", () => {
    const { api } = renderControls();
    const stick = screen.getByTestId("touch-joystick");
    // happy-dom rects are 0x0 at (0,0) — the center is (0,0), so client coords
    // pass through as the relative vector.
    fireEvent.pointerDown(stick, { pointerId: 3, clientX: 10, clientY: -20 });
    expect(api.joystickDown).toHaveBeenCalledWith({ pointerId: 3, x: 10, y: -20 });
    fireEvent.pointerMove(stick, { pointerId: 3, clientX: -5, clientY: 40 });
    expect(api.joystickMove).toHaveBeenCalledWith({ pointerId: 3, x: -5, y: 40 });
    fireEvent.pointerUp(stick, { pointerId: 3 });
    expect(api.joystickUp).toHaveBeenCalledWith(3);
  });

  test("action buttons route to buttonDown/Up; Eat renders only when edible", () => {
    const { api } = renderControls();
    expect(screen.queryByTestId("touch-eat")).toBeNull();
    fireEvent.pointerDown(screen.getByTestId("touch-jump"), { pointerId: 1 });
    fireEvent.pointerUp(screen.getByTestId("touch-jump"), { pointerId: 1 });
    expect(api.buttonDown).toHaveBeenCalledWith("jump");
    expect(api.buttonUp).toHaveBeenCalledWith("jump");
    fireEvent.pointerDown(screen.getByTestId("touch-place"), { pointerId: 1 });
    expect(api.buttonDown).toHaveBeenCalledWith("place");

    const withEat = renderControls({ showEat: true });
    fireEvent.pointerDown(withEat.view.container.querySelector('[data-testid="touch-eat"]')!, { pointerId: 1 });
    expect(withEat.api.buttonDown).toHaveBeenCalledWith("eat");
  });

  test("top bar fires the shell callbacks", () => {
    const { props } = renderControls();
    fireEvent.pointerDown(screen.getByTestId("touch-pause"), { pointerId: 1 });
    expect(props.onPause).toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByTestId("touch-inventory"), { pointerId: 1 });
    expect(props.onOpenInventory).toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByTestId("touch-camera"), { pointerId: 1 });
    expect(props.onToggleCamera).toHaveBeenCalled();
  });

  test("flying relabels Jump/Sneak as Rise/Descend", () => {
    renderControls({ isFlying: true });
    expect(screen.getByTestId("touch-jump").textContent).toBe("Rise");
    expect(screen.getByTestId("touch-sneak").textContent).toBe("Descend");
  });

  test("unmount calls onDeactivate so held gestures never stick through a panel", () => {
    const { props, view } = renderControls();
    view.unmount();
    expect(props.onDeactivate).toHaveBeenCalledTimes(1);
  });
});
