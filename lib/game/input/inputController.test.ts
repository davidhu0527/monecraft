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
