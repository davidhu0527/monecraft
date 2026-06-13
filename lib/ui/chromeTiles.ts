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

/**
 * A grayscale grain tile for GUI chrome (panel face, slot well, button face).
 * Unlike noiseTileUrl this adds a small +/- variation around a fixed 8-bit gray
 * rather than multiplying a color, so the panel stays its intended shade with
 * just a faint texture. `bias` shifts the whole tile (negative = darker/sunken
 * slot well, positive = a faint raised button face); `delta` is the grain
 * amplitude in 0..255.
 */
function grayGrainTileUrl(base: number, salt: number, delta: number, bias = 0): string {
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
      const n = (v - Math.floor(v)) * 2 - 1;
      const g = Math.max(0, Math.min(255, Math.round(base + bias + n * delta)));
      const i = (y * SPRITE_SIZE + x) * 4;
      image.data[i] = g;
      image.data[i + 1] = g;
      image.data[i + 2] = g;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

let installed = false;

/**
 * Sets the generated UI tile CSS custom properties on the document root
 * (idempotent): --mc-tile-dirt / --mc-tile-stone for the menu backdrops, and
 * --mc-tile-panel / --mc-tile-well / --mc-tile-button for the chrome grain that
 * layers over the flat gray panel, slot, and button colors.
 */
export function installUiTiles(): void {
  if (installed || typeof document === "undefined") return;
  const dirt = noiseTileUrl(BLOCK_COLORS[BlockId.Dirt] ?? [0.46, 0.33, 0.2], 3, 0.55);
  const stone = noiseTileUrl(BLOCK_COLORS[BlockId.Stone] ?? [0.54, 0.56, 0.58], 7, 0.9);
  if (!dirt || !stone) return;
  const root = document.documentElement.style;
  root.setProperty("--mc-tile-dirt", `url("${dirt}")`);
  root.setProperty("--mc-tile-stone", `url("${stone}")`);
  // 0xc6 ~ --mc-panel, 0x8b ~ --mc-slot-well (sunk a touch), 0x6f ~ --mc-button.
  const panel = grayGrainTileUrl(0xc6, 11, 4);
  const well = grayGrainTileUrl(0x8b, 13, 5, -6);
  const button = grayGrainTileUrl(0x6f, 17, 4, 2);
  if (panel) root.setProperty("--mc-tile-panel", `url("${panel}")`);
  if (well) root.setProperty("--mc-tile-well", `url("${well}")`);
  if (button) root.setProperty("--mc-tile-button", `url("${button}")`);
  installed = true;
}
