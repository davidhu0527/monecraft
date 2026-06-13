"use client";

import { type MouseEvent, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import type { InventorySlot } from "@/lib/game/types";

export type TooltipContent = { title: string; lines?: string[] } | null;

/**
 * The tooltip content for an inventory slot, shared by the hotbar and the
 * inventory so both surfaces show the same details: the item label, plus a gray
 * "Durability x / y" line for damageable items. Empty slots get no tooltip.
 */
export function itemTooltipFor(slot: InventorySlot): TooltipContent {
  if (!slot.id || slot.count <= 0) return null;
  if (slot.maxDurability) return { title: slot.label, lines: [`Durability ${slot.durability ?? slot.maxDurability} / ${slot.maxDurability}`] };
  return { title: slot.label };
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
 */
export function useItemTooltip() {
  const [content, setContent] = useState<TooltipContent>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

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
            onMouseLeave: () => setContent(null)
          }
        : {},
    [track]
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
