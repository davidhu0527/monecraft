import type { GameEngine } from "@/lib/game/engine/GameEngine";
import type { FrameInput, MoveIntents } from "@/lib/game/engine/state";
import {
  FLY_DOUBLE_TAP_WINDOW_SECONDS,
  TOUCH_HOLD_MINE_MS,
  TOUCH_JOYSTICK_DEADZONE,
  TOUCH_JOYSTICK_RADIUS_PX,
  TOUCH_LOOK_SENSITIVITY,
  TOUCH_SPRINT_DOUBLE_TAP_MS,
  TOUCH_TAP_MAX_MS,
  TOUCH_TAP_SLOP_PX
} from "@/lib/game/config";
import type { InputController } from "./inputController";

/**
 * The touch counterpart of createInputController: same InputController
 * surface, but "gameplay capture" is a virtual `active` flag (there is no
 * pointer lock on touch — tap-to-play calls engage()). All gesture state
 * lives here, DOM-free: the TouchControls overlay forwards plain pointer
 * records into `controls`, so this whole state machine unit-tests without a
 * browser. The engine contract is identical to desktop: mutate FrameInput,
 * call engine.applyLook, dispatch Commands.
 *
 * Gesture model (Minecraft-PE classic): on the free look area, drag = look,
 * tap = one attack, press-and-hold within slop = attack + mineHeld until
 * lift — and a drag that leaves the slop first is ONLY ever a look (a camera
 * swipe must never dig). Movement rides a fixed-base joystick with 8-way
 * sectors; re-engaging the stick quickly latches sprint (applied only while
 * pushing forward); Jump double-tap toggles flight, mirroring Space.
 */

export type TouchPointer = { pointerId: number; x: number; y: number };
export type TouchActionButton = "jump" | "sneak" | "place" | "eat";

export type TouchControlsApi = {
  /** Joystick coords are relative to the stick's center (the overlay converts). */
  joystickDown(p: TouchPointer): void;
  joystickMove(p: TouchPointer): void;
  joystickUp(pointerId: number): void;
  /** Look coords are viewport CSS px (only deltas matter). */
  lookDown(p: TouchPointer): void;
  lookMove(p: TouchPointer): void;
  lookUp(pointerId: number): void;
  /** pointercancel: lift with no tap classification. */
  lookCancel(pointerId: number): void;
  buttonDown(button: TouchActionButton): void;
  buttonUp(button: TouchActionButton): void;
  readonly sneakLatched: boolean;
};

export type TouchInputController = InputController & { controls: TouchControlsApi };

type CreateTouchInputControllerArgs = {
  engine: GameEngine;
  onLockChange: (locked: boolean) => void;
  /** Injectable time/scheduling so tap-vs-hold tests are deterministic. */
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => number;
  cancel?: (id: number) => void;
};

/** 8-way sector threshold on the normalized joystick vector (sin of 22.5°). */
const DIAG = Math.sin(Math.PI / 8);

export function createTouchInputController(args: CreateTouchInputControllerArgs): TouchInputController {
  const { engine, onLockChange } = args;
  const now = args.now ?? (() => performance.now());
  const schedule = args.schedule ?? ((fn, ms) => window.setTimeout(fn, ms));
  const cancel = args.cancel ?? ((id) => window.clearTimeout(id));

  const move: MoveIntents = { forward: false, back: false, left: false, right: false, jump: false, sprint: false, crouch: false };
  const input: FrameInput = { move, mineHeld: false };

  let active = false;
  let sneakLatch = false;

  type LookGesture = {
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    startedAt: number;
    drift: number;
    mining: boolean;
    holdTimer: number | null;
  };
  let look: LookGesture | null = null;

  type JoystickGesture = { pointerId: number; sprintLatch: boolean };
  let joystick: JoystickGesture | null = null;
  let lastJoystickEngageAt = -Infinity;
  let lastJumpTapAt = -Infinity;

  const uiBlocked = () => engine.state.inventoryOpen || engine.state.advancementsOpen || engine.state.isDead || engine.state.paused;
  const gated = () => !active || uiBlocked();

  const clearJoystick = () => {
    joystick = null;
    move.forward = move.back = move.left = move.right = false;
    move.sprint = false;
  };

  const clearLook = () => {
    if (look?.holdTimer != null) cancel(look.holdTimer);
    look = null;
    input.mineHeld = false;
  };

  const applyJoystickVector = (x: number, y: number) => {
    const len = Math.hypot(x, y);
    if (len < TOUCH_JOYSTICK_DEADZONE * TOUCH_JOYSTICK_RADIUS_PX) {
      move.forward = move.back = move.left = move.right = false;
    } else {
      const nx = x / len;
      const ny = y / len;
      move.left = nx < -DIAG;
      move.right = nx > DIAG;
      move.forward = ny < -DIAG; // screen y grows downward
      move.back = ny > DIAG;
    }
    // Sprint needs both the quick re-engage latch and an actual forward push.
    move.sprint = (joystick?.sprintLatch ?? false) && move.forward;
  };

  const controls: TouchControlsApi = {
    joystickDown(p) {
      if (gated() || joystick) return;
      const engagedAt = now();
      joystick = { pointerId: p.pointerId, sprintLatch: engagedAt - lastJoystickEngageAt <= TOUCH_SPRINT_DOUBLE_TAP_MS };
      lastJoystickEngageAt = engagedAt;
      applyJoystickVector(p.x, p.y);
    },

    joystickMove(p) {
      if (!joystick || joystick.pointerId !== p.pointerId) return;
      if (gated()) return clearJoystick();
      applyJoystickVector(p.x, p.y);
    },

    joystickUp(pointerId) {
      if (joystick?.pointerId !== pointerId) return;
      clearJoystick();
    },

    lookDown(p) {
      if (gated() || look) return; // first look finger wins; extras ignored
      const holdTimer = schedule(() => {
        // Held still long enough: this is a mine, not a tap or a drag.
        if (!look || look.drift > TOUCH_TAP_SLOP_PX || gated()) return;
        look.mining = true;
        look.holdTimer = null;
        input.mineHeld = true;
        engine.dispatch({ type: "attack" }); // desktop mousedown parity: the swing starts the dig
      }, TOUCH_HOLD_MINE_MS);
      look = { pointerId: p.pointerId, startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, startedAt: now(), drift: 0, mining: false, holdTimer };
    },

    lookMove(p) {
      if (!look || look.pointerId !== p.pointerId) return;
      if (gated()) return clearLook();
      // Look responds from the very first move — tap jitter of a few px is an
      // imperceptible camera nudge, and immediacy matters more than purity.
      engine.applyLook(-(p.x - look.lastX) * TOUCH_LOOK_SENSITIVITY, -(p.y - look.lastY) * TOUCH_LOOK_SENSITIVITY);
      look.lastX = p.x;
      look.lastY = p.y;
      look.drift = Math.max(look.drift, Math.hypot(p.x - look.startX, p.y - look.startY));
      // Once it's a drag it can never become a tap or start mining… but a dig
      // already in progress keeps digging while the aim adjusts (desktop: held
      // button + mouse move).
      if (!look.mining && look.drift > TOUCH_TAP_SLOP_PX && look.holdTimer != null) {
        cancel(look.holdTimer);
        look.holdTimer = null;
      }
    },

    lookUp(pointerId) {
      if (look?.pointerId !== pointerId) return;
      const wasTap = !look.mining && look.drift <= TOUCH_TAP_SLOP_PX && now() - look.startedAt < TOUCH_TAP_MAX_MS;
      clearLook();
      if (wasTap && !gated()) engine.dispatch({ type: "attack" });
    },

    lookCancel(pointerId) {
      if (look?.pointerId !== pointerId) return;
      clearLook();
    },

    buttonDown(button) {
      if (gated()) return;
      if (button === "jump") {
        move.jump = true;
        const t = now();
        if (t - lastJumpTapAt <= FLY_DOUBLE_TAP_WINDOW_SECONDS * 1000) {
          engine.dispatch({ type: "toggleFlight" });
          lastJumpTapAt = -Infinity; // consume the pair so a third tap starts fresh
        } else {
          lastJumpTapAt = t;
        }
      }
      if (button === "sneak") {
        // A toggle, not a hold: holding a corner button while juggling the
        // joystick and look thumbs is a hand-cramp.
        sneakLatch = !sneakLatch;
        move.crouch = sneakLatch;
      }
      if (button === "place") engine.dispatch({ type: "placeBlock" });
      if (button === "eat") {
        // One button for consumables, same rule as KeyF.
        const held = engine.state.inventory[engine.state.selectedSlot];
        engine.dispatch({ type: held?.effect ? "drinkPotion" : "eatFood" });
      }
    },

    buttonUp(button) {
      if (button === "jump") move.jump = false;
      // sneak is a toggle; place/eat are one-shot on down.
    },

    get sneakLatched() {
      return sneakLatch;
    }
  };

  // App-switch/tab-hide is the touch analog of losing pointer lock: stop
  // everything and open the pause menu (the desktop path does this via
  // pointerlockchange).
  const onVisibilityChange = () => {
    if (!document.hidden || !active) return;
    api.release();
    engine.dispatch({ type: "pause" });
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  const clearAll = () => {
    clearJoystick();
    clearLook();
    move.jump = false;
    move.crouch = false;
    sneakLatch = false;
  };

  const api: TouchInputController = {
    input,
    controls,

    get pointerLocked() {
      return active;
    },

    clearKeys() {
      clearAll();
    },

    forcePointerLock(locked: boolean) {
      // Same contract as desktop's test hook: flip the engine-facing gate
      // without telling the React shell.
      active = locked;
      if (!locked) clearAll();
    },

    engage() {
      if (active) return;
      active = true;
      onLockChange(true);
    },

    release() {
      if (!active) return;
      clearAll();
      active = false;
      onLockChange(false);
    },

    dispose() {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearAll(); // cancels the hold timer
    }
  };

  return api;
}
