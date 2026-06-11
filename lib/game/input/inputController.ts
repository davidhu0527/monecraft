import type { GameEngine } from "@/lib/game/engine/GameEngine";
import type { FrameInput } from "@/lib/game/engine/state";

const MOUSE_SENSITIVITY = 0.0021;

type MutableInput = {
  keys: Set<string>;
  capsActive: boolean;
  leftMouseHeld: boolean;
  pointerLocked: boolean;
};

export type InputController = {
  /** Live continuous-input view, passed to engine.step every frame. */
  readonly input: FrameInput;
  /** Drops held keys and the mouse button (on death/respawn). */
  clearKeys(): void;
  dispose(): void;
};

type CreateInputControllerArgs = {
  /** The WebGL canvas — pointer lock target. */
  canvas: HTMLCanvasElement;
  engine: GameEngine;
  onResize: () => void;
  onLockChange: (locked: boolean) => void;
};

/**
 * Owns every DOM listener. Continuous input (keys, mouse button, pointer
 * lock) is exposed as a FrameInput the engine reads each step; discrete
 * actions become engine commands; mouse-look goes through engine.applyLook.
 */
export function createInputController(args: CreateInputControllerArgs): InputController {
  const { canvas, engine, onResize, onLockChange } = args;

  const input: MutableInput = {
    keys: new Set<string>(),
    capsActive: false,
    leftMouseHeld: false,
    pointerLocked: false
  };

  const uiBlocked = () => engine.state.inventoryOpen || engine.state.isDead;

  const onMouseMove = (evt: MouseEvent) => {
    if (!input.pointerLocked) return;
    engine.applyLook(-evt.movementX * MOUSE_SENSITIVITY, -evt.movementY * MOUSE_SENSITIVITY);
  };

  const onKeyDown = (evt: KeyboardEvent) => {
    if (evt.code.startsWith("Digit")) {
      const idx = evt.code === "Digit0" ? 9 : Number.parseInt(evt.code.slice(5), 10) - 1;
      engine.dispatch({ type: "selectSlot", index: idx });
    }

    if (evt.code === "KeyI") {
      engine.dispatch({ type: "toggleInventory" });
      input.keys.clear();
      if (input.pointerLocked) document.exitPointerLock();
      return;
    }

    if (evt.code === "KeyU") {
      engine.dispatch({ type: "unstuck" });
      return;
    }

    if (uiBlocked()) return;

    if (evt.code === "KeyE") {
      evt.preventDefault();
      engine.dispatch({ type: "placeBlock" });
    }
    if (evt.code === "KeyF") {
      evt.preventDefault();
      engine.dispatch({ type: "eatFood" });
    }

    input.keys.add(evt.code);
    input.capsActive = evt.getModifierState("CapsLock");
    if (evt.code === "Space") evt.preventDefault();
  };

  const onKeyUp = (evt: KeyboardEvent) => {
    input.keys.delete(evt.code);
    input.capsActive = evt.getModifierState("CapsLock");
  };

  const onMouseDown = (evt: MouseEvent) => {
    if (uiBlocked()) return;
    if (!input.pointerLocked) {
      // The first click only acquires pointer lock — no mining or placing.
      // The request can legitimately reject (recent Esc, unfocused document,
      // headless browsers); the game just stays unlocked.
      Promise.resolve(canvas.requestPointerLock()).catch(() => {});
      return;
    }

    if (evt.button === 0) {
      input.leftMouseHeld = true;
      engine.dispatch({ type: "attack" });
    }
    if (evt.button === 2) engine.dispatch({ type: "placeBlock" });
  };

  const onMouseUp = (evt: MouseEvent) => {
    if (evt.button !== 0) return;
    input.leftMouseHeld = false;
  };

  const onContextMenu = (evt: MouseEvent) => evt.preventDefault();

  const onPointerLockChange = () => {
    input.pointerLocked = document.pointerLockElement === canvas;
    onLockChange(input.pointerLocked);
  };

  window.addEventListener("resize", onResize);
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("mousedown", onMouseDown);
  document.addEventListener("mouseup", onMouseUp);
  document.addEventListener("contextmenu", onContextMenu);
  document.addEventListener("pointerlockchange", onPointerLockChange);

  return {
    input,

    clearKeys() {
      input.keys.clear();
      input.leftMouseHeld = false;
    },

    dispose() {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
    }
  };
}
