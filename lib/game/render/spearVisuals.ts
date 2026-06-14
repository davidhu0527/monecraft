import * as THREE from "three";
import type { ThrownSpearState } from "@/lib/game/engine/state";
import { MATERIAL_PALETTES } from "@/lib/ui/spritePixels";

type SpearModel = {
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
};

export type SpearVisuals = {
  sync(spears: ThrownSpearState[]): void;
  dispose(): void;
};

const up = new THREE.Vector3(0, 1, 0);
const direction = new THREE.Vector3();

function materialColor(itemId: string): THREE.Color {
  const rgb = MATERIAL_PALETTES[itemId.split("_")[0]]?.m ?? [190, 190, 190];
  return new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
}

function createSpearModel(itemId: string): SpearModel {
  const group = new THREE.Group();
  const shaftGeometry = new THREE.CylinderGeometry(0.035, 0.035, 1.15, 6);
  const tipGeometry = new THREE.ConeGeometry(0.13, 0.38, 4);
  const shaftMaterial = new THREE.MeshStandardMaterial({ color: 0x8d6035, roughness: 0.8 });
  const tipMaterial = new THREE.MeshStandardMaterial({ color: materialColor(itemId), roughness: 0.45, metalness: 0.15 });
  const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
  const tip = new THREE.Mesh(tipGeometry, tipMaterial);
  shaft.position.y = -0.18;
  tip.position.y = 0.585;
  group.add(shaft, tip);
  return { group, geometries: [shaftGeometry, tipGeometry], materials: [shaftMaterial, tipMaterial] };
}

export function createSpearVisuals(scene: THREE.Scene): SpearVisuals {
  const models = new Map<number, SpearModel>();
  const seen = new Set<number>();

  const removeModel = (id: number) => {
    const model = models.get(id);
    if (!model) return;
    scene.remove(model.group);
    for (const geometry of model.geometries) geometry.dispose();
    for (const material of model.materials) material.dispose();
    models.delete(id);
  };

  return {
    sync(spears) {
      seen.clear();
      for (const spear of spears) {
        seen.add(spear.id);
        let model = models.get(spear.id);
        if (!model) {
          model = createSpearModel(spear.itemId);
          models.set(spear.id, model);
          scene.add(model.group);
        }
        model.group.position.copy(spear.position);
        direction.copy(spear.velocity);
        if (direction.lengthSq() > 0.0001) model.group.quaternion.setFromUnitVectors(up, direction.normalize());
      }
      for (const id of models.keys()) {
        if (!seen.has(id)) removeModel(id);
      }
    },

    dispose() {
      for (const id of [...models.keys()]) removeModel(id);
    }
  };
}
