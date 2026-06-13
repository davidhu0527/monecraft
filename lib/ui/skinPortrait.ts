import type { PlayerPalette } from "@/lib/game/playerSkins";
import { paintGrid, type Rgb } from "./spritePixels";

/**
 * 16x16 pixel bust (head + shoulders) for the pause-menu skin picker, derived
 * from the same palette that colors the 3D body — so the swatch is
 * automatically truthful for any preset. Legend: h hair, s skin, S skin
 * shadow, w eye white, p pupil, t shirt, T shirt shadow.
 */
const BUST_GRID = [
  "................",
  "...hhhhhhhhhh...",
  "...hhhhhhhhhh...",
  "...hhhhhhhhhh...",
  "...hssssssssh...",
  "...ssssssssss...",
  "...sswwsswwss...",
  "...sswpsspwss...",
  "...ssssssssss...",
  "...sssSSSSsss...",
  "....SssssssS....",
  "......ssss......",
  "......SssS......",
  ".tttttttttttttt.",
  "tttttttttttttttt",
  "TTTTTTTTTTTTTTTT"
];

const toRgb = (hex: number): Rgb => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

const shade = (rgb: Rgb, factor: number): Rgb => [Math.round(rgb[0] * factor), Math.round(rgb[1] * factor), Math.round(rgb[2] * factor)];

export function renderSkinPortraitPixels(palette: PlayerPalette): Uint8ClampedArray {
  const skin = toRgb(palette.skin);
  const shirt = toRgb(palette.shirt);
  return paintGrid(BUST_GRID, {
    h: toRgb(palette.hair),
    s: skin,
    S: shade(skin, 0.75),
    w: toRgb(palette.eyeWhite),
    p: toRgb(palette.eyePupil),
    t: shirt,
    T: shade(shirt, 0.75)
  });
}
