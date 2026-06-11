import * as THREE from "three";
import { BLOCK_COLORS, BlockId } from "./blocks";

// Procedural texture atlas: one 16x16 tile per block face variant, painted on a
// canvas at startup. This is the only world module that touches the DOM.
export const ATLAS_TILE_SIZE = 16;
export const ATLAS_FACE_VARIANTS = 3; // top, side, bottom
export const ATLAS_COLUMNS = 16;

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

  const totalTiles = (BlockId.Water + 1) * ATLAS_FACE_VARIANTS;
  const rows = Math.ceil(totalTiles / ATLAS_COLUMNS);
  const width = ATLAS_COLUMNS * ATLAS_TILE_SIZE;
  const height = rows * ATLAS_TILE_SIZE;
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
        if (block === BlockId.SliverOre && n > 0.86) c = tone([0.93, 0.93, 0.95], 1);
        if (block === BlockId.RubyOre && n > 0.88) c = tone([0.86, 0.24, 0.24], 1);
        if (block === BlockId.GoldOre && n > 0.84) c = tone([0.96, 0.8, 0.25], 1);
        if (block === BlockId.SapphireOre && n > 0.86) c = tone([0.2, 0.62, 0.9], 1);
        if (block === BlockId.DiamondOre && n > 0.9) c = tone([0.7, 0.94, 0.98], 1);
        if (block === BlockId.Water) c = tone([0.22, 0.48, 0.85], 0.95 + n * 0.12, face === "top" ? 0.02 : 0);
        if (block === BlockId.Sand && n > 0.84) c = tone(base, 1.12);

        ctx.fillStyle = rgb(c);
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  };

  for (let block = BlockId.Grass; block <= BlockId.Water; block += 1) {
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
