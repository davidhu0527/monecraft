"use client";

import { useEffect, useRef, useState } from "react";
import { TOUCH_JOYSTICK_RADIUS_PX } from "@/lib/game/config";
import type { TouchControlsApi } from "@/lib/game/input/touchInputController";

/**
 * The on-screen touch controls: a fixed-base joystick (bottom-left), a
 * full-screen look pad behind the HUD (drag = look, tap = attack, hold =
 * mine), an action cluster (bottom-right), and a top bar (pause / inventory /
 * camera). Dumb by design — every gesture decision lives in the touch input
 * controller; this component only converts PointerEvents into plain
 * {pointerId, x, y} records (joystick coords relative to its center) and
 * renders the knob/pressed visuals. Handlers are pointerType-agnostic so a
 * mouse can drive the overlay (dev convenience + Playwright).
 */

type TouchControlsProps = {
  controls: TouchControlsApi;
  /** Selected slot is edible/drinkable — show the Eat button. */
  showEat: boolean;
  /** Flying (Creative/Spectator): Jump/Sneak read as Rise/Descend. */
  isFlying: boolean;
  onPause: () => void;
  onOpenInventory: () => void;
  onToggleCamera: () => void;
  /** Unmount cleanup — drops held gestures so nothing sticks through a panel. */
  onDeactivate: () => void;
};

/** setPointerCapture keeps drags delivering off-element; optional in happy-dom. */
function capture(e: React.PointerEvent): void {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // Test DOMs (and some odd UAs) lack pointer capture; drags just need the
    // finger to stay on-screen, which is the overwhelmingly common case.
  }
}

export default function TouchControls({ controls, showEat, isFlying, onPause, onOpenInventory, onToggleCamera, onDeactivate }: TouchControlsProps) {
  // Visual knob offset (clamped); the controller does its own vector math.
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [sneakOn, setSneakOn] = useState(controls.sneakLatched);
  const joystickCenterRef = useRef({ x: 0, y: 0 });

  useEffect(() => () => onDeactivate(), [onDeactivate]);

  const joystickLocal = (e: React.PointerEvent) => ({
    pointerId: e.pointerId,
    x: e.clientX - joystickCenterRef.current.x,
    y: e.clientY - joystickCenterRef.current.y
  });

  const onJoystickDown = (e: React.PointerEvent) => {
    capture(e);
    const rect = e.currentTarget.getBoundingClientRect();
    joystickCenterRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const p = joystickLocal(e);
    controls.joystickDown(p);
    setKnob(clampKnob(p.x, p.y));
  };
  const onJoystickMove = (e: React.PointerEvent) => {
    const p = joystickLocal(e);
    controls.joystickMove(p);
    setKnob(clampKnob(p.x, p.y));
  };
  const onJoystickEnd = (e: React.PointerEvent) => {
    controls.joystickUp(e.pointerId);
    setKnob({ x: 0, y: 0 });
  };

  const lookPoint = (e: React.PointerEvent) => ({ pointerId: e.pointerId, x: e.clientX, y: e.clientY });

  return (
    <>
      <div
        className="touch-lookpad"
        data-testid="touch-lookpad"
        onPointerDown={(e) => {
          capture(e);
          controls.lookDown(lookPoint(e));
        }}
        onPointerMove={(e) => controls.lookMove(lookPoint(e))}
        onPointerUp={(e) => controls.lookUp(e.pointerId)}
        onPointerCancel={(e) => controls.lookCancel(e.pointerId)}
      />

      <div
        className="touch-joystick"
        data-testid="touch-joystick"
        onPointerDown={onJoystickDown}
        onPointerMove={onJoystickMove}
        onPointerUp={onJoystickEnd}
        onPointerCancel={onJoystickEnd}
      >
        <div className="touch-joystick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} aria-hidden="true" />
      </div>

      <div className="touch-actions">
        {showEat ? (
          <button
            type="button"
            className="touch-btn"
            data-testid="touch-eat"
            onPointerDown={() => controls.buttonDown("eat")}
            onPointerUp={() => controls.buttonUp("eat")}
          >
            Eat
          </button>
        ) : null}
        <button
          type="button"
          className="touch-btn"
          data-testid="touch-place"
          onPointerDown={() => controls.buttonDown("place")}
          onPointerUp={() => controls.buttonUp("place")}
        >
          Place
        </button>
        <button
          type="button"
          className={sneakOn ? "touch-btn pressed" : "touch-btn"}
          data-testid="touch-sneak"
          aria-pressed={sneakOn}
          onPointerDown={() => {
            controls.buttonDown("sneak");
            setSneakOn(controls.sneakLatched);
          }}
          onPointerUp={() => controls.buttonUp("sneak")}
        >
          {isFlying ? "Descend" : "Sneak"}
        </button>
        <button
          type="button"
          className="touch-btn touch-btn-jump"
          data-testid="touch-jump"
          onPointerDown={() => controls.buttonDown("jump")}
          onPointerUp={() => controls.buttonUp("jump")}
          onPointerCancel={() => controls.buttonUp("jump")}
        >
          {isFlying ? "Rise" : "Jump"}
        </button>
      </div>

      <div className="touch-topbar">
        <button type="button" className="touch-btn" data-testid="touch-pause" onPointerDown={onPause}>
          ❚❚
        </button>
        <button type="button" className="touch-btn" data-testid="touch-inventory" onPointerDown={onOpenInventory}>
          Items
        </button>
        <button type="button" className="touch-btn" data-testid="touch-camera" onPointerDown={onToggleCamera}>
          View
        </button>
      </div>
    </>
  );
}

function clampKnob(x: number, y: number): { x: number; y: number } {
  const len = Math.hypot(x, y);
  if (len <= TOUCH_JOYSTICK_RADIUS_PX) return { x, y };
  const scale = TOUCH_JOYSTICK_RADIUS_PX / len;
  return { x: x * scale, y: y * scale };
}
