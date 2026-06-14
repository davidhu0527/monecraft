import * as THREE from "three";
import { renderSpritePixels } from "@/lib/ui/spritePixels";
import type { ProjectileState } from "@/lib/game/engine/state";
import { buildExtrudedSpriteGeometry } from "./extrudedSprite";

export type ProjectileVisuals = {
  /** Creates/removes arrow meshes to match the projectile list and orients each along its flight. */
  sync(projectiles: ProjectileState[]): void;
  dispose(): void;
};

// The arrow sprite is drawn pointing up (+Y); rotate that axis onto the velocity.
const UP_Y = new THREE.Vector3(0, 1, 0);
const scratchDir = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();

/**
 * Renders in-flight arrows. One extruded-sprite geometry and one material are
 * shared across every live arrow — only each mesh's transform differs — so the
 * pool allocates nothing per shot and frees both once on dispose().
 */
export function createProjectileVisuals(scene: THREE.Scene): ProjectileVisuals {
  const geometry = buildExtrudedSpriteGeometry(renderSpritePixels("arrow"));
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 });
  const meshes = new Map<number, THREE.Mesh>();
  const seen = new Set<number>();

  const removeMesh = (id: number): void => {
    const mesh = meshes.get(id);
    if (!mesh) return;
    scene.remove(mesh);
    meshes.delete(id);
  };

  return {
    sync(projectiles) {
      seen.clear();
      for (const p of projectiles) {
        seen.add(p.id);
        let mesh = meshes.get(p.id);
        if (!mesh) {
          mesh = new THREE.Mesh(geometry, material);
          meshes.set(p.id, mesh);
          scene.add(mesh);
        }
        mesh.position.set(p.position.x, p.position.y, p.position.z);
        if (p.velocity.lengthSq() > 1e-6) {
          scratchDir.copy(p.velocity).normalize();
          mesh.quaternion.copy(scratchQuat.setFromUnitVectors(UP_Y, scratchDir));
        }
      }
      for (const id of meshes.keys()) {
        if (!seen.has(id)) removeMesh(id);
      }
    },

    dispose() {
      for (const id of [...meshes.keys()]) removeMesh(id);
      geometry.dispose();
      material.dispose();
    }
  };
}
