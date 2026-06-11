import type { GameState } from "@/lib/game/engine/state";
import { columnColor } from "./minimapColors";

/**
 * Top-right minimap: a north-up, top-down view of the columns around the
 * player, rebuilt only when the player crosses a sampling-grid boundary or
 * the world mesh is dirty (block edits). Synced from the rAF loop BEFORE the
 * renderer, which clears worldMeshDirty — this module only reads the flag.
 */

const SAMPLE_SIZE = 128; // columns sampled per side
const SAMPLE_GRID = 16; // rebuild when the player crosses this boundary
const SYNC_INTERVAL_MS = 100;
const CANVAS_CSS_SIZE = 144;

export type MinimapRenderer = {
  sync(state: GameState, now: number): void;
  dispose(): void;
};

export function createMinimapRenderer(container: HTMLElement): MinimapRenderer | null {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  canvas.className = "minimap-canvas";
  canvas.style.width = `${CANVAS_CSS_SIZE}px`;
  canvas.style.height = `${CANVAS_CSS_SIZE}px`;
  const ctx = canvas.getContext("2d");

  const base = document.createElement("canvas");
  base.width = SAMPLE_SIZE;
  base.height = SAMPLE_SIZE;
  const baseCtx = base.getContext("2d");

  if (!ctx || !baseCtx) return null;
  container.appendChild(canvas);

  let lastSync = 0;
  let baseOriginX = Number.NaN; // world coords of the base canvas's top-left column
  let baseOriginZ = Number.NaN;
  let baseBuilt = false;

  const rebuildBase = (state: GameState, originX: number, originZ: number) => {
    const { world } = state;
    const image = baseCtx.createImageData(SAMPLE_SIZE, SAMPLE_SIZE);
    for (let pz = 0; pz < SAMPLE_SIZE; pz += 1) {
      for (let px = 0; px < SAMPLE_SIZE; px += 1) {
        const wx = originX + px;
        const wz = originZ + pz;
        const i = (pz * SAMPLE_SIZE + px) * 4;
        if (wx < 0 || wz < 0 || wx >= world.sizeX || wz >= world.sizeZ) {
          image.data[i + 3] = 0; // outside the world: transparent
          continue;
        }
        const [r, g, b] = columnColor(world, wx, wz);
        image.data[i] = r;
        image.data[i + 1] = g;
        image.data[i + 2] = b;
        image.data[i + 3] = 255;
      }
    }
    baseCtx.putImageData(image, 0, 0);
    baseOriginX = originX;
    baseOriginZ = originZ;
    baseBuilt = true;
  };

  return {
    sync(state: GameState, now: number) {
      if (now - lastSync < SYNC_INTERVAL_MS) return;
      lastSync = now;

      const px = state.player.position.x;
      const pz = state.player.position.z;
      // Snap the sampled window to a coarse grid so walking does not rebuild
      // every frame; the blit below pans smoothly inside the window.
      const originX = Math.floor(px / SAMPLE_GRID) * SAMPLE_GRID - SAMPLE_SIZE / 2 + SAMPLE_GRID / 2;
      const originZ = Math.floor(pz / SAMPLE_GRID) * SAMPLE_GRID - SAMPLE_SIZE / 2 + SAMPLE_GRID / 2;
      if (!baseBuilt || originX !== baseOriginX || originZ !== baseOriginZ || state.worldMeshDirty) {
        rebuildBase(state, originX, originZ);
      }

      ctx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      ctx.imageSmoothingEnabled = false;
      // Center the view on the player by offsetting the base by the player's
      // position inside the sampled window.
      const offsetX = px - baseOriginX - SAMPLE_SIZE / 2;
      const offsetZ = pz - baseOriginZ - SAMPLE_SIZE / 2;
      ctx.drawImage(base, -offsetX, -offsetZ);

      // Player arrow (yaw 0 looks toward -Z, i.e. up/north on the map).
      const cx = SAMPLE_SIZE / 2;
      ctx.save();
      ctx.translate(cx, cx);
      ctx.rotate(-state.player.yaw);
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(4, 4);
      ctx.lineTo(0, 1.5);
      ctx.lineTo(-4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    },

    dispose() {
      canvas.remove();
    }
  };
}
