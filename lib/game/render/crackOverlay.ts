import * as THREE from "three";
import { BlockId, VoxelWorld } from "@/lib/world";
import { BREAK_HARDNESS } from "@/lib/game/items";
import type { MiningState } from "@/lib/game/engine/state";

export type CrackOverlayView = {
  /** Positions the crack box on the mined block with the stage for current progress. */
  update(mining: MiningState, world: VoxelWorld): void;
  dispose(): void;
};

function createCrackTextures(): THREE.CanvasTexture[] {
  const stages = 8;
  const textures: THREE.CanvasTexture[] = [];

  for (let stage = 0; stage < stages; stage += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    ctx.clearRect(0, 0, 16, 16);
    ctx.strokeStyle = `rgba(20, 20, 20, ${0.18 + stage * 0.09})`;
    ctx.lineWidth = 1.1;
    ctx.lineCap = "square";

    const draw = (points: Array<[number, number]>) => {
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
      ctx.stroke();
    };

    draw([
      [8, 0],
      [8, 5],
      [6, 8],
      [7, 12],
      [6, 16]
    ]);
    if (stage >= 1)
      draw([
        [8, 5],
        [11, 3],
        [14, 2],
        [16, 0]
      ]);
    if (stage >= 2)
      draw([
        [6, 8],
        [3, 8],
        [1, 10],
        [0, 13]
      ]);
    if (stage >= 2)
      draw([
        [7, 12],
        [10, 13],
        [13, 15]
      ]);
    if (stage >= 3)
      draw([
        [8, 5],
        [5, 4],
        [2, 2],
        [0, 0]
      ]);
    if (stage >= 3)
      draw([
        [6, 8],
        [8, 9],
        [11, 10],
        [15, 10]
      ]);
    if (stage >= 4)
      draw([
        [5, 4],
        [5, 1]
      ]);
    if (stage >= 4)
      draw([
        [10, 13],
        [11, 9],
        [13, 7],
        [16, 6]
      ]);
    if (stage >= 5)
      draw([
        [3, 8],
        [4, 11],
        [3, 14],
        [2, 16]
      ]);
    if (stage >= 5)
      draw([
        [11, 3],
        [10, 6],
        [11, 8]
      ]);
    if (stage >= 6)
      draw([
        [8, 9],
        [7, 11],
        [8, 14],
        [9, 16]
      ]);
    if (stage >= 6)
      draw([
        [11, 8],
        [13, 9],
        [16, 12]
      ]);
    if (stage >= 7)
      draw([
        [4, 11],
        [6, 10],
        [9, 10],
        [12, 11],
        [15, 14]
      ]);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    textures.push(texture);
  }

  return textures;
}

export function createCrackOverlay(scene: THREE.Scene): CrackOverlayView {
  const textures = createCrackTextures();
  const crackMaterials = textures.map(
    (texture) =>
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
      })
  );
  const geometry = new THREE.BoxGeometry(1.015, 1.015, 1.015);
  const overlay = new THREE.Mesh(geometry, crackMaterials[0]);
  overlay.visible = false;
  overlay.renderOrder = 5;
  scene.add(overlay);

  return {
    update(mining, world) {
      if (!mining.targetKey || mining.progress <= 0) {
        overlay.visible = false;
        return;
      }

      const [sx, sy, sz] = mining.targetKey.split(",");
      const bx = Number.parseInt(sx, 10);
      const by = Number.parseInt(sy, 10);
      const bz = Number.parseInt(sz, 10);
      if (!Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bz)) {
        overlay.visible = false;
        return;
      }

      const block = world.get(bx, by, bz);
      if (block === BlockId.Air || block === BlockId.Bedrock) {
        overlay.visible = false;
        return;
      }

      const hardness = BREAK_HARDNESS[block as BlockId] ?? 2;
      const progress = Math.max(0, Math.min(0.999, mining.progress / hardness));
      const stage = Math.min(crackMaterials.length - 1, Math.floor(progress * crackMaterials.length));
      overlay.material = crackMaterials[stage];
      overlay.position.set(bx + 0.5, by + 0.5, bz + 0.5);
      overlay.visible = true;
    },

    dispose() {
      scene.remove(overlay);
      geometry.dispose();
      for (const material of crackMaterials) material.dispose();
      for (const texture of textures) texture.dispose();
    }
  };
}
