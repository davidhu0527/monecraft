import { BLOCK_COLORS, BlockId } from "@/lib/world";
import { SPRITE_SIZE } from "./spritePixels";

/**
 * Tiled noise backgrounds for UI chrome (the pause-menu dirt backdrop and the
 * panel stone texture), generated once and installed as CSS custom properties.
 */

function noiseTileUrl(base: [number, number, number], salt: number, dimming: number): string {
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const image = ctx.createImageData(SPRITE_SIZE, SPRITE_SIZE);
  for (let y = 0; y < SPRITE_SIZE; y += 1) {
    for (let x = 0; x < SPRITE_SIZE; x += 1) {
      const v = Math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453;
      const noise = 0.75 + (v - Math.floor(v)) * 0.5;
      const i = (y * SPRITE_SIZE + x) * 4;
      image.data[i] = Math.round(base[0] * 255 * noise * dimming);
      image.data[i + 1] = Math.round(base[1] * 255 * noise * dimming);
      image.data[i + 2] = Math.round(base[2] * 255 * noise * dimming);
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

let installed = false;

/** Sets --mc-tile-dirt / --mc-tile-stone on the document root (idempotent). */
export function installUiTiles(): void {
  if (installed || typeof document === "undefined") return;
  const dirt = noiseTileUrl(BLOCK_COLORS[BlockId.Dirt] ?? [0.46, 0.33, 0.2], 3, 0.55);
  const stone = noiseTileUrl(BLOCK_COLORS[BlockId.Stone] ?? [0.54, 0.56, 0.58], 7, 0.9);
  if (!dirt || !stone) return;
  document.documentElement.style.setProperty("--mc-tile-dirt", `url("${dirt}")`);
  document.documentElement.style.setProperty("--mc-tile-stone", `url("${stone}")`);
  installed = true;
}
