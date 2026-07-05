"use client";

import { type MouseEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TOUCH_LONGPRESS_TOOLTIP_MS, TOUCH_TAP_SLOP_PX } from "@/lib/game/config";
import { displayName } from "@/lib/game/items";
import type { InventorySlot } from "@/lib/game/types";

export type TooltipContent = { title: string; lines?: string[] } | null;

/**
 * The tooltip content for an inventory slot, shared by the hotbar and the
 * inventory so both surfaces show the same details: the item label, plus a gray
 * "Durability x / y" line for damageable items. Empty slots get no tooltip.
 */
export function itemTooltipFor(slot: InventorySlot): TooltipContent {
  if (!slot.id || slot.count <= 0) return null;
  if (slot.maxDurability) {
    const lines = [`Durability ${slot.durability ?? slot.maxDurability} / ${slot.maxDurability}`];
    if (slot.attack) lines.push(`Attack ${slot.attack}`);
    if (slot.meleeReach) lines.push(`Reach ${slot.meleeReach}`);
    if (slot.throwDamage) lines.push(`Throw damage ${slot.throwDamage}`);
    return { title: displayName(slot), lines };
  }
  return { title: displayName(slot) };
}

/**
 * Minecraft-style item tooltip: a near-black box with a violet gradient border
 * that follows the cursor (matching the game and sidestepping clipping inside
 * the scrollable inventory). It renders in a portal on document.body and is
 * pointer-events:none, so it can never intercept the canvas click that
 * re-acquires pointer lock. During locked play the cursor is hidden and slots
 * aren't hover-reachable, so the tooltip simply never shows.
 *
 * Usage: `const { tooltip, bind } = useItemTooltip();` then spread
 * `{...bind(content)}` onto each hoverable element and render `{tooltip}` once.
 * Pass `null` content for empty/non-hover targets to disable the tooltip there.
 * Keep each element's aria-label — the tooltip is aria-hidden.
 *
 * Touch has no hover, so the same bind also implements LONG-PRESS: holding a
 * finger on the element for TOUCH_LONGPRESS_TOOLTIP_MS shows the tooltip at
 * the press point, the click that follows the lift is swallowed (a long-press
 * must not also swap slots or craft — recipe entries use `is-disabled`, not
 * `disabled`, so they do fire clicks), and the next touch anywhere dismisses.
 * The mouse path is byte-identical: every pointer handler ignores
 * pointerType "mouse".
 */
export function useItemTooltip() {
  const [content, setContent] = useState<TooltipContent>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const pressRef = useRef<{ timer: number; startX: number; startY: number } | null>(null);
  // Set when a long-press fired; the element's next click is suppressed once.
  const suppressClickRef = useRef(false);

  const cancelPress = useCallback(() => {
    if (pressRef.current) window.clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  }, []);

  // A long-press tooltip stays up after the finger lifts; the next touch
  // anywhere puts it away (registered only while something is shown).
  useEffect(() => {
    if (!content) return;
    const dismiss = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") setContent(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [content]);

  const track = useCallback((e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY }), []);

  const bind = useCallback(
    (c: TooltipContent) =>
      c
        ? {
            onMouseEnter: (e: MouseEvent) => {
              setContent(c);
              setPos({ x: e.clientX, y: e.clientY });
            },
            onMouseMove: track,
            onMouseLeave: () => setContent(null),
            onPointerDown: (e: ReactPointerEvent) => {
              if (e.pointerType === "mouse") return;
              suppressClickRef.current = false;
              cancelPress();
              const { clientX, clientY } = e;
              pressRef.current = {
                startX: clientX,
                startY: clientY,
                timer: window.setTimeout(() => {
                  pressRef.current = null;
                  suppressClickRef.current = true;
                  setContent(c);
                  setPos({ x: clientX, y: clientY });
                }, TOUCH_LONGPRESS_TOOLTIP_MS)
              };
            },
            onPointerMove: (e: ReactPointerEvent) => {
              if (e.pointerType === "mouse") return;
              const press = pressRef.current;
              if (press && Math.hypot(e.clientX - press.startX, e.clientY - press.startY) > TOUCH_TAP_SLOP_PX) cancelPress();
            },
            onPointerUp: (e: ReactPointerEvent) => {
              if (e.pointerType !== "mouse") cancelPress();
            },
            onPointerCancel: (e: ReactPointerEvent) => {
              if (e.pointerType !== "mouse") cancelPress();
            },
            onClickCapture: (e: MouseEvent) => {
              if (!suppressClickRef.current) return;
              suppressClickRef.current = false;
              e.preventDefault();
              e.stopPropagation();
            }
          }
        : {},
    [track, cancelPress]
  );

  let tooltip: React.ReactNode = null;
  if (content && typeof document !== "undefined") {
    // Flip to the cursor's left near the right edge so wide tooltips stay on screen.
    const flip = typeof window !== "undefined" && pos.x > window.innerWidth - 300;
    const style = flip ? { right: window.innerWidth - pos.x + 14, top: pos.y + 14 } : { left: pos.x + 14, top: pos.y + 14 };
    tooltip = createPortal(
      <div className="item-tooltip" style={style} aria-hidden="true">
        <span className="item-tooltip-title">{content.title}</span>
        {content.lines?.map((line) => (
          <span key={line} className="item-tooltip-line">
            {line}
          </span>
        ))}
      </div>,
      document.body
    );
  }

  return { tooltip, bind };
}
