import * as THREE from "three";
import type { FishingState } from "@/lib/game/engine/state";

export type BobberVisuals = {
  /** Shows the bobber + line when a cast is active, hides them otherwise. */
  sync(fishing: FishingState | null, eye: THREE.Vector3): void;
  dispose(): void;
};

/**
 * Renders the single active fishing bobber: a small red float on the water and a
 * taut line from the player's eye to it. The bobber dips slightly while a fish is
 * biting. One mesh, one line, one geometry/material each — added to the scene only
 * while fishing, removed when the cast ends or on dispose().
 */
export function createBobberVisuals(scene: THREE.Scene): BobberVisuals {
  const bobberGeometry = new THREE.SphereGeometry(0.11, 8, 6);
  const bobberMaterial = new THREE.MeshStandardMaterial({ color: 0xd03c34, roughness: 0.5 });
  const bobber = new THREE.Mesh(bobberGeometry, bobberMaterial);

  const linePositions = new Float32Array(6);
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0xdedede });
  const line = new THREE.Line(lineGeometry, lineMaterial);

  let present = false;
  const setPresent = (next: boolean): void => {
    if (next === present) return;
    present = next;
    if (next) scene.add(bobber, line);
    else scene.remove(bobber, line);
  };

  return {
    sync(fishing, eye) {
      if (!fishing) {
        setPresent(false);
        return;
      }
      setPresent(true);
      const dip = fishing.biting ? -0.09 : 0; // the strike pulls the float under
      bobber.position.set(fishing.position.x, fishing.position.y + dip, fishing.position.z);
      linePositions[0] = eye.x;
      linePositions[1] = eye.y;
      linePositions[2] = eye.z;
      linePositions[3] = bobber.position.x;
      linePositions[4] = bobber.position.y;
      linePositions[5] = bobber.position.z;
      lineGeometry.attributes.position.needsUpdate = true;
    },

    dispose() {
      setPresent(false);
      bobberGeometry.dispose();
      bobberMaterial.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
    }
  };
}
