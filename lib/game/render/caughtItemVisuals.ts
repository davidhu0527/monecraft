import * as THREE from "three";
import { renderSpritePixels } from "@/lib/ui/spritePixels";
import { buildExtrudedSpriteGeometry } from "./extrudedSprite";

const FLIGHT_S = 0.4; // bobber → player flight time
const LIFT = 0.6; // peak of the arc above the straight-line path

type Flier = {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  from: THREE.Vector3;
  /** null until its first sync, then the wall-clock start; keeps spawn() time-free. */
  startMs: number | null;
};

export type CaughtItemVisuals = {
  /** Launches a caught item's sprite from the bobber position; it arcs to the player and vanishes. */
  spawn(itemId: string, fromX: number, fromY: number, fromZ: number): void;
  /** Advances every in-flight catch toward `target` (the player's head). Call once per frame. */
  sync(timeMs: number, target: THREE.Vector3): void;
  dispose(): void;
};

/**
 * The "fish flies to you" flourish: on a catch, a small sprite of the caught item
 * arcs from the bobber to the player's head over ~0.4 s, then disposes. One mesh
 * per in-flight catch (rare and short-lived), built from the same sprite the
 * inventory icon uses; mirrors the transient-visual pattern of projectileVisuals.
 */
export function createCaughtItemVisuals(scene: THREE.Scene): CaughtItemVisuals {
  const fliers: Flier[] = [];
  const cur = new THREE.Vector3();

  const remove = (f: Flier): void => {
    scene.remove(f.mesh);
    f.geometry.dispose();
    f.material.dispose();
  };

  return {
    spawn(itemId, fromX, fromY, fromZ) {
      const geometry = buildExtrudedSpriteGeometry(renderSpritePixels(itemId));
      const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.position.set(fromX, fromY, fromZ);
      scene.add(mesh);
      fliers.push({ mesh, geometry, material, from: new THREE.Vector3(fromX, fromY, fromZ), startMs: null });
    },

    sync(timeMs, target) {
      for (let i = fliers.length - 1; i >= 0; i -= 1) {
        const f = fliers[i];
        if (f.startMs === null) f.startMs = timeMs;
        const k = (timeMs - f.startMs) / (FLIGHT_S * 1000);
        if (k >= 1) {
          remove(f);
          fliers.splice(i, 1);
          continue;
        }
        cur.lerpVectors(f.from, target, k);
        cur.y += Math.sin(k * Math.PI) * LIFT;
        f.mesh.position.copy(cur);
        f.mesh.rotation.y = timeMs * 0.012; // a little spin for flair
      }
    },

    dispose() {
      for (const f of fliers) remove(f);
      fliers.length = 0;
    }
  };
}
