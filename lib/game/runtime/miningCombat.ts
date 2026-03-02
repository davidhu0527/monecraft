import * as THREE from "three";
import { BlockId, collidesAt, VoxelWorld, voxelRaycast } from "@/lib/world";
import { BREAK_HARDNESS } from "@/lib/game/config";
import type { InventorySlot, MobEntity } from "@/lib/game/types";

type MiningContext = {
  world: VoxelWorld;
  camera: THREE.PerspectiveCamera;
  pointerLockElement: Element;
  pointer: THREE.Vector2;
  raycaster: THREE.Raycaster;
  playerPosition: THREE.Vector3;
  playerHeight: number;
  playerHalfWidth: number;
  selectedSlotRef: { current: number };
  inventoryRef: { current: InventorySlot[] };
  mineProgressRef: { current: number };
  mineTargetRef: { current: string };
  leftMouseHeldRef: { current: boolean };
  inventoryOpenRef: { current: boolean };
  isDeadRef: { current: boolean };
  consumeSelectedToolDurability: (amount?: number) => void;
  adjustSlotCount: (slotId: string, delta: number, preferredIndex?: number) => void;
  addBlockDrop: (block: BlockId) => void;
  setBlockTracked: (x: number, y: number, z: number, nextBlock: BlockId) => void;
  rebuildWorldMesh: (force?: boolean) => void;
};

export function selectedTool(inventoryRef: { current: InventorySlot[] }, selectedSlotRef: { current: number }): InventorySlot | null {
  const slot = inventoryRef.current[selectedSlotRef.current];
  return slot?.kind === "tool" && slot.count > 0 ? slot : null;
}

export function canMineBlock(block: BlockId, toolTier: number): boolean {
  if (block === BlockId.Stone || block === BlockId.Cobblestone || block === BlockId.Brick) return toolTier >= 1;
  if (block === BlockId.SliverOre) return toolTier >= 2;
  if (block === BlockId.RubyOre) return toolTier >= 3;
  if (block === BlockId.GoldOre) return toolTier >= 3;
  if (block === BlockId.SapphireOre) return toolTier >= 4;
  if (block === BlockId.DiamondOre) return toolTier >= 4;
  return true;
}

export function miningSpeed(tool: InventorySlot | null): number {
  return tool?.minePower ?? 0.8;
}

export function weaponDamage(inventoryRef: { current: InventorySlot[] }, selectedSlotRef: { current: number }): number {
  const slot = inventoryRef.current[selectedSlotRef.current];
  if (slot?.kind === "weapon" && slot.count > 0) return slot.attack ?? 8;
  return 6;
}

export function tryAttackMob(
  mobs: MobEntity[],
  camera: THREE.PerspectiveCamera,
  playerPosition: THREE.Vector3,
  damage: number,
  onMobKilled: (index: number) => void
): boolean {
  const origin = camera.position;
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);

  let bestIndex = -1;
  let bestDist = Number.POSITIVE_INFINITY;

  for (let i = 0; i < mobs.length; i += 1) {
    const mob = mobs[i];
    const toMob = mob.group.position.clone().sub(origin);
    const dist = toMob.length();
    if (dist > 4.5) continue;
    toMob.normalize();
    if (forward.dot(toMob) < 0.89) continue;
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
    }
  }

  if (bestIndex < 0) return false;
  const mob = mobs[bestIndex];
  mob.hp -= damage;

  const knock = mob.group.position.clone().sub(playerPosition).setY(0);
  if (knock.lengthSq() > 0.0001) {
    const dir = knock.normalize();
    mob.direction.copy(dir);
    mob.group.position.addScaledVector(dir, 0.75);
    mob.group.position.y += 0.12;
  }

  if (mob.hp <= 0) onMobKilled(bestIndex);
  return true;
}

export function doPlace(ctx: MiningContext): void {
  const { world, camera, pointer, raycaster, selectedSlotRef, inventoryRef, adjustSlotCount, setBlockTracked, playerPosition, playerHalfWidth, playerHeight, rebuildWorldMesh } = ctx;

  raycaster.setFromCamera(pointer, camera);
  const result = voxelRaycast(world, camera.position, raycaster.ray.direction, 7);
  if (!result) return;

  const tx = result.previous.x;
  const ty = result.previous.y;
  const tz = result.previous.z;
  if (!world.inBounds(tx, ty, tz) || world.get(tx, ty, tz) !== BlockId.Air) return;

  const slot = inventoryRef.current[selectedSlotRef.current];
  if (!slot || !slot.id || slot.kind !== "block" || slot.count <= 0 || slot.blockId === undefined) return;
  if (slot.blockId === BlockId.Bedrock) return;

  adjustSlotCount(slot.id, -1, selectedSlotRef.current);
  setBlockTracked(tx, ty, tz, slot.blockId);
  if (collidesAt(world, playerPosition, playerHalfWidth, playerHeight)) {
    setBlockTracked(tx, ty, tz, BlockId.Air);
    adjustSlotCount(slot.id, 1, selectedSlotRef.current);
    return;
  }

  rebuildWorldMesh(true);
}

export function processMining(ctx: MiningContext, dt: number): void {
  const {
    world,
    camera,
    pointerLockElement,
    pointer,
    raycaster,
    selectedSlotRef,
    inventoryRef,
    mineProgressRef,
    mineTargetRef,
    leftMouseHeldRef,
    inventoryOpenRef,
    isDeadRef,
    consumeSelectedToolDurability,
    addBlockDrop,
    setBlockTracked,
    rebuildWorldMesh
  } = ctx;

  if (!leftMouseHeldRef.current || inventoryOpenRef.current || isDeadRef.current) return;
  if (document.pointerLockElement !== pointerLockElement) return;

  raycaster.setFromCamera(pointer, camera);
  const result = voxelRaycast(world, camera.position, raycaster.ray.direction, 7);
  if (!result) {
    mineTargetRef.current = "";
    mineProgressRef.current = 0;
    return;
  }

  const bx = result.hit.x;
  const by = result.hit.y;
  const bz = result.hit.z;
  const targetBlock = world.get(bx, by, bz);
  const tool = selectedTool(inventoryRef, selectedSlotRef);
  const tier = tool?.mineTier ?? 0;

  if (targetBlock === BlockId.Bedrock || targetBlock === BlockId.Air || !canMineBlock(targetBlock as BlockId, tier)) {
    mineTargetRef.current = "";
    mineProgressRef.current = 0;
    return;
  }

  const key = `${bx},${by},${bz}`;
  if (mineTargetRef.current !== key) {
    mineTargetRef.current = key;
    mineProgressRef.current = 0;
  }

  const hardness = BREAK_HARDNESS[targetBlock as BlockId] ?? 2;
  mineProgressRef.current += dt * miningSpeed(tool) * 2.1;
  if (mineProgressRef.current < hardness) return;

  setBlockTracked(bx, by, bz, BlockId.Air);
  if (tool) consumeSelectedToolDurability(1);
  addBlockDrop(targetBlock as BlockId);
  rebuildWorldMesh(true);
  mineProgressRef.current = 0;
  mineTargetRef.current = "";
}
