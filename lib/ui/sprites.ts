import { renderSpritePixels, SPRITE_SIZE } from "./spritePixels";
import { renderHudIconPixels, type HudIconName } from "./hudPixels";

/**
 * DOM side of the sprite system: turns pure pixel buffers into cached data
 * URLs for <img> tags. happy-dom has no 2D canvas context, so everything
 * degrades to a transparent pixel there — components stay testable while the
 * pixel logic itself is covered by the pure-module tests.
 */

const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const cache = new Map<string, string>();

export function spriteDataUrl(key: string, pixels: () => Uint8ClampedArray): string {
  const hit = cache.get(key);
  if (hit) return hit;

  let url = TRANSPARENT_PIXEL;
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = SPRITE_SIZE;
    canvas.height = SPRITE_SIZE;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      // Copy into a fresh buffer: ImageData requires a non-shared ArrayBuffer.
      ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels()), SPRITE_SIZE, SPRITE_SIZE), 0, 0);
      url = canvas.toDataURL();
    }
  }
  cache.set(key, url);
  return url;
}

/** Data URL for an inventory item's 16x16 icon. */
export function itemIconUrl(itemId: string): string {
  return spriteDataUrl(`item:${itemId}`, () => renderSpritePixels(itemId));
}

/** Data URL for a HUD icon (hearts, drumsticks, armor). */
export function hudIconUrl(name: HudIconName): string {
  return spriteDataUrl(`hud:${name}`, () => renderHudIconPixels(name));
}
