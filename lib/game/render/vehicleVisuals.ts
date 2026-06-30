import * as THREE from "three";
import type { VehicleState } from "@/lib/game/engine/state";

type VehicleVisual = {
  group: THREE.Group;
  materials: THREE.Material[];
  geometries: THREE.BufferGeometry[];
};

export type VehicleVisuals = {
  sync(vehicles: VehicleState[]): void;
  dispose(): void;
};

const WOOD = 0x9a6231;
const DARK_WOOD = 0x4f321f;
const SAIL = 0xdedab8;

function box(
  w: number,
  h: number,
  d: number,
  color: number,
  x = 0,
  y = 0,
  z = 0
): { mesh: THREE.Mesh; material: THREE.Material; geometry: THREE.BufferGeometry } {
  const geometry = new THREE.BoxGeometry(w, h, d);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  return { mesh, material, geometry };
}

function createRaft(): VehicleVisual {
  const group = new THREE.Group();
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  for (const x of [-0.36, 0, 0.36]) {
    const part = box(0.28, 0.16, 1.55, WOOD, x, 0, 0);
    group.add(part.mesh);
    materials.push(part.material);
    geometries.push(part.geometry);
  }
  for (const z of [-0.45, 0.45]) {
    const rail = box(1.25, 0.1, 0.12, DARK_WOOD, 0, 0.12, z);
    group.add(rail.mesh);
    materials.push(rail.material);
    geometries.push(rail.geometry);
  }
  return { group, materials, geometries };
}

function createShip(): VehicleVisual {
  const group = new THREE.Group();
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const hull = box(1.9, 0.34, 3.05, WOOD, 0, 0, 0);
  const deck = box(1.55, 0.14, 2.55, 0xb77b42, 0, 0.24, 0);
  const bow = box(1.35, 0.42, 0.35, DARK_WOOD, 0, 0.16, -1.68);
  const stern = box(1.5, 0.48, 0.42, DARK_WOOD, 0, 0.22, 1.58);
  const mast = box(0.08, 1.35, 0.08, DARK_WOOD, 0, 0.95, -0.15);
  const sail = box(0.08, 0.85, 0.9, SAIL, 0, 1.02, -0.18);
  for (const part of [hull, deck, bow, stern, mast, sail]) {
    group.add(part.mesh);
    materials.push(part.material);
    geometries.push(part.geometry);
  }
  return { group, materials, geometries };
}

function createVisual(vehicle: VehicleState): VehicleVisual {
  return vehicle.kind === "raft" ? createRaft() : createShip();
}

export function createVehicleVisuals(scene: THREE.Scene): VehicleVisuals {
  const visuals = new Map<number, VehicleVisual>();
  const seen = new Set<number>();

  const remove = (id: number) => {
    const visual = visuals.get(id);
    if (!visual) return;
    scene.remove(visual.group);
    for (const material of visual.materials) material.dispose();
    for (const geometry of visual.geometries) geometry.dispose();
    visuals.delete(id);
  };

  return {
    sync(vehicles) {
      seen.clear();
      for (const vehicle of vehicles) {
        seen.add(vehicle.id);
        let visual = visuals.get(vehicle.id);
        if (!visual) {
          visual = createVisual(vehicle);
          visuals.set(vehicle.id, visual);
          scene.add(visual.group);
        }
        visual.group.position.set(vehicle.position.x, vehicle.position.y + 0.08, vehicle.position.z);
        visual.group.rotation.y = vehicle.yaw;
      }
      for (const id of visuals.keys()) {
        if (!seen.has(id)) remove(id);
      }
    },

    dispose() {
      for (const id of [...visuals.keys()]) remove(id);
    }
  };
}
