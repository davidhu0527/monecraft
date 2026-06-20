import * as THREE from "three";
import { BLOCK_COLORS, BlockId } from "./blocks";
import { doorState, isDoorBlock } from "./doors";

// Procedural texture atlas: one 16x16 tile per block face variant, painted on a
// canvas at startup. This is the only world module that touches the DOM.
export const ATLAS_TILE_SIZE = 16;
export const ATLAS_FACE_VARIANTS = 3; // top, side, bottom
export const ATLAS_COLUMNS = 16;

// Tile range derived from the palette so new blocks get tiles automatically —
// a hardcoded last-block bound here once left new blocks sampling garbage UVs.
export const ATLAS_BLOCK_COUNT = Math.max(...Object.keys(BLOCK_COLORS).map(Number)) + 1;
export const ATLAS_ROWS = Math.ceil((ATLAS_BLOCK_COUNT * ATLAS_FACE_VARIANTS) / ATLAS_COLUMNS);

let atlasTextureCache: THREE.CanvasTexture | null = null;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function tone(c: [number, number, number], mul: number, add = 0): [number, number, number] {
  return [clamp01(c[0] * mul + add), clamp01(c[1] * mul + add), clamp01(c[2] * mul + add)];
}

function rgb(c: [number, number, number]): string {
  return `rgb(${Math.floor(clamp01(c[0]) * 255)}, ${Math.floor(clamp01(c[1]) * 255)}, ${Math.floor(clamp01(c[2]) * 255)})`;
}

export function tileIndexFor(block: number, face: "top" | "side" | "bottom"): number {
  const faceId = face === "top" ? 0 : face === "side" ? 1 : 2;
  return block * ATLAS_FACE_VARIANTS + faceId;
}

export function createBlockAtlasTexture(): THREE.CanvasTexture {
  if (atlasTextureCache) return atlasTextureCache;

  const width = ATLAS_COLUMNS * ATLAS_TILE_SIZE;
  const height = ATLAS_ROWS * ATLAS_TILE_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to create atlas context");
  ctx.imageSmoothingEnabled = false;

  const drawTile = (block: number, face: "top" | "side" | "bottom") => {
    const tile = tileIndexFor(block, face);
    const col = tile % ATLAS_COLUMNS;
    const row = Math.floor(tile / ATLAS_COLUMNS);
    const ox = col * ATLAS_TILE_SIZE;
    const oy = row * ATLAS_TILE_SIZE;

    const baseBlockColor = BLOCK_COLORS[block] ?? [1, 0, 1];
    let base = baseBlockColor;
    if (face === "top") base = tone(base, 1.08);
    if (face === "bottom") base = tone(base, 0.96);
    if (block === BlockId.Grass && face === "bottom") base = BLOCK_COLORS[BlockId.Dirt];

    for (let y = 0; y < ATLAS_TILE_SIZE; y += 1) {
      for (let x = 0; x < ATLAS_TILE_SIZE; x += 1) {
        const h = Math.sin((x + block * 13 + (face === "top" ? 7 : face === "side" ? 17 : 29)) * 12.1 + (y + block * 19) * 7.7) * 43758.5453;
        const n = h - Math.floor(h);
        let c = tone(base, 0.92 + n * 0.22);

        if (block === BlockId.Grass && face === "side" && y < 4) c = tone(BLOCK_COLORS[BlockId.Grass], 0.95 + n * 0.15);
        if ((block === BlockId.Stone || block === BlockId.Cobblestone || block === BlockId.Bedrock) && n > 0.8) c = tone(base, 1.18);
        if ((block === BlockId.Wood || block === BlockId.Planks) && (x + y) % 4 === 0) c = tone(base, 0.82);
        if (block === BlockId.CoalOre && n > 0.82) c = tone([0.09, 0.09, 0.11], 1);
        if (block === BlockId.SliverOre && n > 0.86) c = tone([0.93, 0.93, 0.95], 1);
        if (block === BlockId.RubyOre && n > 0.88) c = tone([0.86, 0.24, 0.24], 1);
        if (block === BlockId.GoldOre && n > 0.84) c = tone([0.96, 0.8, 0.25], 1);
        if (block === BlockId.SapphireOre && n > 0.86) c = tone([0.2, 0.62, 0.9], 1);
        if (block === BlockId.DiamondOre && n > 0.9) c = tone([0.7, 0.94, 0.98], 1);
        if (block === BlockId.Water) c = tone([0.22, 0.48, 0.85], 0.95 + n * 0.12, face === "top" ? 0.02 : 0);
        if (block === BlockId.Sand && n > 0.84) c = tone(base, 1.12);
        if (block === BlockId.Cactus && face === "side" && x % 4 === 0) c = tone(base, 0.72);
        if (block === BlockId.Snow) c = tone(base, 0.97 + n * 0.06);
        if (block === BlockId.Bed && face === "top" && y < 5) c = tone([0.95, 0.95, 0.97], 0.95 + n * 0.1); // pillow band
        if (block >= BlockId.WheatStage0 && block <= BlockId.WheatStage3 && face === "side" && x % 3 === 1) c = tone(base, 0.66); // gaps read as stalks
        if (block === BlockId.Sapling) {
          // A young sprout: a short brown stem in the lower center under a small
          // green leafy crown. Like wheat, it's a full cube painted to read as a plant.
          const stem = x >= 7 && x <= 8 && y >= 10;
          const crown = Math.abs(x - 7.5) + Math.abs(y - 6) < 5;
          c = stem ? tone([0.45, 0.32, 0.18], 0.85 + n * 0.2) : crown ? tone([0.27, 0.5, 0.2], 0.8 + n * 0.4) : tone([0.2, 0.36, 0.16], 0.85 + n * 0.25);
        }
        if (block === BlockId.Furnace && face === "side" && x >= 5 && x <= 10 && y >= 8 && y <= 12) c = tone([0.95, 0.45, 0.12], 0.85 + n * 0.3); // glowing mouth
        if (block === BlockId.Chest) {
          if ((x + y) % 4 === 0) c = tone(base, 0.82); // plank grain
          if (face === "top" && y === 8) c = tone(base, 0.6); // lid seam
          if (face === "side" && y === 7) c = tone(base, 0.58); // lid joint band
          if (face === "side" && x >= 7 && x <= 8 && y >= 6 && y <= 9) c = tone([0.62, 0.64, 0.68], 0.9 + n * 0.2); // metal latch
        }
        if (block === BlockId.MossyCobblestone) {
          if (n > 0.8) c = tone([0.5, 0.52, 0.5], 1.05); // pale cobble chunks
          if (n < 0.32) c = tone([0.2, 0.4, 0.16], 0.85 + n * 0.5); // moss patches in the cracks
        }
        if (block === BlockId.Spawner) {
          // A dark iron cage over a faint ember core — reads as a Minecraft spawner.
          const bar = x % 5 === 0 || y % 5 === 0;
          c = bar ? tone([0.32, 0.34, 0.4], 0.85 + n * 0.25) : tone([0.5, 0.16, 0.12], 0.5 + n * 0.6);
        }
        if (block === BlockId.Lava) {
          // Molten rock: a hot orange bed with brighter cracks and dark crust
          // flecks. The block emits max light, so it reads as glowing.
          const crack = n > 0.78;
          const crust = n < 0.2;
          c = crack ? tone([1, 0.78, 0.2], 1) : crust ? tone([0.35, 0.1, 0.04], 1) : tone([0.92, 0.34, 0.08], 0.85 + n * 0.4);
        }
        if (block === BlockId.Tnt) {
          // Classic TNT: a red block of "dynamite" with a white label band around
          // the sides and a darker cap on the top/bottom (the bundled fuse ends).
          if (face === "side") {
            c = y >= 6 && y <= 9 ? tone([0.92, 0.9, 0.86], 0.95 + n * 0.1) : tone([0.78, 0.2, 0.15], 0.88 + n * 0.2);
          } else {
            c = tone([0.5, 0.16, 0.12], 0.9 + n * 0.18);
            if ((x + y) % 5 === 0) c = tone([0.2, 0.18, 0.16], 1); // fuse-end flecks
          }
        }
        if (block === BlockId.Torch) {
          // A wooden stick on a dark ground with a bright flame near the top —
          // the block self-illuminates, so the flame reads as the light source.
          const onStick = x >= 7 && x <= 8 && y >= 6;
          const flame = x >= 6 && x <= 9 && y <= 6 && Math.abs(x - 7.5) + y * 0.5 < 4;
          if (face === "top")
            c = tone([1, 0.86, 0.32], 0.8 + n * 0.5); // looking down at the flame
          else if (flame) c = tone([1, 0.83, 0.3], 0.78 + n * 0.55);
          else if (onStick) c = tone([0.55, 0.38, 0.2], 0.85 + n * 0.2);
          else c = tone([0.05, 0.05, 0.07], 1);
        }
        if (block === BlockId.BrewingStand) {
          // A stone base under a glowing central rod, lit by a faint purple brew.
          const rod = x >= 7 && x <= 8;
          if (face === "top") {
            c = Math.abs(x - 7.5) + Math.abs(y - 7.5) < 3 ? tone([0.62, 0.42, 0.82], 0.9 + n * 0.3) : tone(base, 0.9 + n * 0.2);
          } else if (y >= 11) {
            c = tone([0.42, 0.43, 0.47], 0.9 + n * 0.2); // stone base
          } else if (rod && y >= 3) {
            c = tone([0.86, 0.8, 0.5], 0.85 + n * 0.3); // the glowing rod
          } else {
            c = tone([0.52, 0.46, 0.62], 0.85 + n * 0.25); // purple-tinted body
          }
        }
        if (isDoorBlock(block)) {
          const state = doorState(block)!;
          const panelY = state.upper ? y : y + ATLAS_TILE_SIZE;
          const border = x < 2 || x > 13 || panelY < 2 || panelY > 29;
          const inset = x >= 4 && x <= 11 && ((panelY >= 4 && panelY <= 13) || (panelY >= 18 && panelY <= 27));
          if (border) c = tone(base, 0.62);
          else if (inset) c = tone(base, 0.78 + n * 0.08);
          else c = tone(base, 0.95 + n * 0.12);
          if (!state.upper && x >= 11 && x <= 12 && y >= 5 && y <= 6) c = tone([0.82, 0.72, 0.36], 0.9 + n * 0.15);
        }

        ctx.fillStyle = rgb(c);
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  };

  for (let block = BlockId.Grass; block < ATLAS_BLOCK_COUNT; block += 1) {
    drawTile(block, "top");
    drawTile(block, "side");
    drawTile(block, "bottom");
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapNearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.needsUpdate = true;
  atlasTextureCache = texture;
  return texture;
}
