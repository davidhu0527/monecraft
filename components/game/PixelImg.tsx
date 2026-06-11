/* eslint-disable @next/next/no-img-element -- tiny generated data-URL sprites; next/image cannot optimize them */

import { useSyncExternalStore } from "react";
import { TRANSPARENT_PIXEL } from "@/lib/ui/sprites";

type PixelImgProps = {
  src: string;
  alt: string;
  size: number;
  className?: string;
  "aria-hidden"?: boolean;
};

const noopSubscribe = () => () => {};

/**
 * True after hydration. Sprites are canvas-generated, so the server can only
 * ever render the transparent fallback; the hydration render must match it
 * (React does not patch mismatched src attributes), and the real sprite swaps
 * in on the immediate follow-up render.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}

/** An <img> for generated pixel-art sprites: never draggable, always pixelated. */
export default function PixelImg({ src, alt, size, className, "aria-hidden": ariaHidden }: PixelImgProps) {
  const hydrated = useHydrated();
  return (
    <img
      src={hydrated ? src : TRANSPARENT_PIXEL}
      alt={alt}
      draggable={false}
      width={size}
      height={size}
      className={className}
      aria-hidden={ariaHidden}
      style={{ imageRendering: "pixelated" }}
    />
  );
}
