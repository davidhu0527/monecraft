import * as THREE from "three";
import { HELD_BLOCK_COLORS, HELD_BLOCK_FALLBACK_COLOR } from "@/lib/world";
import type { InventorySlot } from "@/lib/game/types";

export type HeldItemView = {
  /** Rebuilds the first-person model when the selected item changes. */
  update(slot: InventorySlot | undefined): void;
  dispose(): void;
};

export function createHeldItemView(camera: THREE.Camera): HeldItemView {
  const root = new THREE.Group();
  camera.add(root);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  let mesh: THREE.Object3D | null = null;
  let key = "";

  const clear = () => {
    if (mesh) root.remove(mesh);
    mesh = null;
    key = "";
    while (geometries.length) geometries.pop()?.dispose();
    while (materials.length) materials.pop()?.dispose();
  };

  const blockColor = (blockId: number | undefined): number =>
    (blockId !== undefined ? HELD_BLOCK_COLORS[blockId as keyof typeof HELD_BLOCK_COLORS] : undefined) ?? HELD_BLOCK_FALLBACK_COLOR;

  return {
    update(slot) {
      const nextKey = slot?.id && slot.count > 0 ? `${slot.id}` : "";
      if (nextKey === key) return;
      clear();
      if (!slot?.id || slot.count <= 0 || !slot.kind) return;

      let next: THREE.Object3D;
      if (slot.kind === "block") {
        const geometry = new THREE.BoxGeometry(0.22, 0.22, 0.22);
        const material = new THREE.MeshStandardMaterial({ color: blockColor(slot.blockId), roughness: 0.7, metalness: 0.05 });
        geometries.push(geometry);
        materials.push(material);
        next = new THREE.Mesh(geometry, material);
      } else if (slot.kind === "tool") {
        const group = new THREE.Group();
        const handleGeom = new THREE.BoxGeometry(0.05, 0.28, 0.05);
        const handleMat = new THREE.MeshStandardMaterial({ color: 0x8d653d, roughness: 0.82, metalness: 0.02 });
        const headGeom = new THREE.BoxGeometry(0.18, 0.07, 0.07);
        const headMat = new THREE.MeshStandardMaterial({ color: 0x9da1a8, roughness: 0.58, metalness: 0.1 });
        geometries.push(handleGeom, headGeom);
        materials.push(handleMat, headMat);
        const handle = new THREE.Mesh(handleGeom, handleMat);
        const head = new THREE.Mesh(headGeom, headMat);
        handle.position.set(0, -0.06, 0);
        head.position.set(0.05, 0.07, 0);
        group.add(handle, head);
        next = group;
      } else {
        const geometry = new THREE.BoxGeometry(0.07, 0.34, 0.03);
        const material = new THREE.MeshStandardMaterial({ color: 0xc2c7cc, roughness: 0.5, metalness: 0.18 });
        geometries.push(geometry);
        materials.push(material);
        next = new THREE.Mesh(geometry, material);
      }

      next.position.set(0.34, -0.28, -0.55);
      next.rotation.set(-0.35, -0.55, -0.12);
      root.add(next);
      mesh = next;
      key = nextKey;
    },

    dispose() {
      clear();
      camera.remove(root);
    }
  };
}
