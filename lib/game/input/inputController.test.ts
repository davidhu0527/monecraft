import { afterEach, describe, expect, mock, test } from "bun:test";
import { createInputController, type InputController } from "@/lib/game/input/inputController";
import type { GameEngine } from "@/lib/game/engine/GameEngine";

/**
 * A minimal stand-in for the engine: the input controller only reaches for
 * `state` flags and `dispatch`/`applyLook` on the keydown paths we exercise.
 */
function makeStubEngine() {
  const dispatch = mock(() => {});
  const engine = {
    state: { paused: false, inventoryOpen: false, isDead: false },
    dispatch,
    applyLook: () => {}
  } as unknown as GameEngine;
  return { engine, dispatch };
}

function pressKey(code: string, modifiers: { shiftKey?: boolean } = {}): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true, ...modifiers }));
}

let controller: InputController | null = null;

afterEach(() => {
  controller?.dispose();
  controller = null;
});

describe("inputController emergency unstuck", () => {
  function setup() {
    const { engine, dispatch } = makeStubEngine();
    controller = createInputController({
      canvas: document.createElement("canvas"),
      engine,
      onResize: () => {},
      onLockChange: () => {}
    });
    return dispatch;
  }

  test("a bare U keypress does not trigger unstuck", () => {
    const dispatch = setup();
    pressKey("KeyU");
    expect(dispatch).not.toHaveBeenCalledWith({ type: "unstuck" });
  });

  test("Shift + U triggers unstuck", () => {
    const dispatch = setup();
    pressKey("KeyU", { shiftKey: true });
    expect(dispatch).toHaveBeenCalledWith({ type: "unstuck" });
  });
});

describe("inputController pointer lock", () => {
  test("requires a double-click to start play", () => {
    const { engine } = makeStubEngine();
    const canvas = document.createElement("canvas");
    const requestPointerLock = mock(() => Promise.resolve());
    canvas.requestPointerLock = requestPointerLock;
    controller = createInputController({
      canvas,
      engine,
      onResize: () => {},
      onLockChange: () => {}
    });

    document.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true }));
    expect(requestPointerLock).not.toHaveBeenCalled();

    document.dispatchEvent(new MouseEvent("dblclick", { button: 0, bubbles: true }));
    expect(requestPointerLock).toHaveBeenCalledTimes(1);
  });

  test("engage() requests pointer lock on the canvas", () => {
    const { engine } = makeStubEngine();
    const canvas = document.createElement("canvas");
    const requestPointerLock = mock(() => Promise.resolve());
    canvas.requestPointerLock = requestPointerLock;
    controller = createInputController({ canvas, engine, onResize: () => {}, onLockChange: () => {} });

    controller.engage();
    expect(requestPointerLock).toHaveBeenCalledTimes(1);
  });

  test("release() exits pointer lock only when this controller's canvas holds it", () => {
    const { engine } = makeStubEngine();
    const canvas = document.createElement("canvas");
    controller = createInputController({ canvas, engine, onResize: () => {}, onLockChange: () => {} });
    const exitPointerLock = mock(() => {});
    document.exitPointerLock = exitPointerLock;

    // Someone else's element holds the lock: not ours to release.
    Object.defineProperty(document, "pointerLockElement", { value: document.createElement("div"), configurable: true });
    controller.release();
    expect(exitPointerLock).not.toHaveBeenCalled();

    Object.defineProperty(document, "pointerLockElement", { value: canvas, configurable: true });
    controller.release();
    expect(exitPointerLock).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "pointerLockElement", { value: null, configurable: true });
  });
});
