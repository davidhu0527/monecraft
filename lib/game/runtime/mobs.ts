import * as THREE from "three";
import { voxelRaycast, VoxelWorld } from "@/lib/world";
import { createMobForKind } from "@/lib/game/mobs";
import type { MobEntity, MobKind } from "@/lib/game/types";

type SpawnMobArgs = {
  kind: MobKind;
  hostile: boolean;
  count: number;
  centerX: number;
  centerZ: number;
  radius: number;
  scene: THREE.Scene;
  mobs: MobEntity[];
  disposables: Array<{ materials: THREE.Material[]; geometries: THREE.BufferGeometry[] }>;
  randomLandPointNear: (centerX: number, centerZ: number, radius: number) => THREE.Vector3;
};

export function spawnMobGroup(args: SpawnMobArgs): void {
  const { kind, hostile, count, centerX, centerZ, radius, scene, mobs, disposables, randomLandPointNear } = args;
  for (let i = 0; i < count; i += 1) {
    const spec = createMobForKind(kind);
    const model = spec.model;
    const spawnPos = randomLandPointNear(centerX, centerZ, radius);
    model.group.position.set(spawnPos.x, spawnPos.y + model.halfHeight, spawnPos.z);
    scene.add(model.group);

    mobs.push({
      kind,
      hostile,
      hp: spec.hp,
      group: model.group,
      legs: model.legs,
      direction: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(),
      turnTimer: 1 + Math.random() * 3,
      speed: spec.speed,
      detectRange: spec.detectRange,
      attackDamage: spec.attackDamage,
      attackCooldown: spec.attackCooldown,
      attackTimer: Math.random(),
      halfHeight: model.halfHeight,
      bobSeed: Math.random() * 10
    });

    disposables.push({ materials: model.materials, geometries: model.geometries });
  }
}

type TickMobsArgs = {
  dt: number;
  time: number;
  world: VoxelWorld;
  worldSizeX: number;
  worldSizeZ: number;
  playerPosition: THREE.Vector3;
  playerVelocity: THREE.Vector3;
  isDead: boolean;
  surfaceYAt: (x: number, z: number) => number;
  mobs: MobEntity[];
  applyDamage: (amount: number) => void;
  removeMobAt: (index: number) => void;
  onCountsChanged: () => void;
};

export function tickMobs(args: TickMobsArgs): void {
  const {
    dt,
    time,
    world,
    worldSizeX,
    worldSizeZ,
    playerPosition,
    playerVelocity,
    isDead,
    surfaceYAt,
    mobs,
    applyDamage,
    removeMobAt,
    onCountsChanged
  } = args;

  const deadIndices: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const toPlayerRay = new THREE.Vector3();
  const mobEye = new THREE.Vector3();
  const playerAim = new THREE.Vector3();
  const mobToPlayer3D = new THREE.Vector3();

  for (let i = 0; i < mobs.length; i += 1) {
    const mob = mobs[i];
    mob.attackTimer -= dt;
    mob.turnTimer -= dt;

    const toPlayer = playerPosition.clone().sub(mob.group.position).setY(0);
    const distanceToPlayer = toPlayer.length();
    mobToPlayer3D.copy(playerPosition).sub(mob.group.position);
    const attackDistance = mobToPlayer3D.length();
    const verticalGap = Math.abs(mobToPlayer3D.y);
    let moveSpeed = mob.speed;

    if (mob.hostile && distanceToPlayer < mob.detectRange) {
      if (distanceToPlayer > 0.001) mob.direction.lerp(toPlayer.normalize(), 0.2).normalize();
      moveSpeed *= 1.15;
    } else if (!mob.hostile && distanceToPlayer < 4.2) {
      if (distanceToPlayer > 0.001) mob.direction.lerp(toPlayer.normalize().multiplyScalar(-1), 0.2).normalize();
      moveSpeed *= 1.15;
    } else if (mob.turnTimer <= 0) {
      mob.direction.applyAxisAngle(up, (Math.random() - 0.5) * Math.PI).normalize();
      mob.turnTimer = 1.5 + Math.random() * 4;
    }

    let nx = mob.group.position.x + mob.direction.x * moveSpeed * dt;
    let nz = mob.group.position.z + mob.direction.z * moveSpeed * dt;

    if (nx < 2 || nz < 2 || nx > worldSizeX - 2 || nz > worldSizeZ - 2) {
      mob.direction.multiplyScalar(-1);
      nx = mob.group.position.x + mob.direction.x * moveSpeed * dt;
      nz = mob.group.position.z + mob.direction.z * moveSpeed * dt;
      mob.turnTimer = 1;
    }

    const ground = surfaceYAt(nx, nz);
    const bob = Math.sin(time * 0.008 + mob.bobSeed) * 0.04;
    mob.group.position.set(nx, ground + mob.halfHeight + bob, nz);
    mob.group.rotation.y = Math.atan2(mob.direction.x, mob.direction.z);

    const gait = Math.sin(time * 0.015 * moveSpeed + mob.bobSeed) * 0.3;
    if (mob.legs.length === 4) {
      mob.legs[0].rotation.x = gait;
      mob.legs[1].rotation.x = -gait;
      mob.legs[2].rotation.x = -gait;
      mob.legs[3].rotation.x = gait;
    }

    let hasLineOfSight = true;
    if (mob.hostile && attackDistance < 4 && verticalGap < 1.6) {
      mobEye.set(mob.group.position.x, mob.group.position.y + mob.halfHeight * 0.35, mob.group.position.z);
      playerAim.set(playerPosition.x, playerPosition.y + 0.9, playerPosition.z);
      toPlayerRay.copy(playerAim).sub(mobEye);
      if (toPlayerRay.lengthSq() > 1e-6) {
        const hit = voxelRaycast(world, mobEye, toPlayerRay.normalize(), attackDistance + 0.5);
        hasLineOfSight = hit === null;
      }
    }

    if (mob.hostile && attackDistance < 4 && verticalGap < 1.6 && hasLineOfSight && mob.attackTimer <= 0) {
      applyDamage(mob.attackDamage);
      if (!isDead && distanceToPlayer > 0.001) {
        const knock = toPlayer.normalize().multiplyScalar(4.2);
        playerVelocity.x += knock.x;
        playerVelocity.z += knock.z;
        playerVelocity.y = Math.max(playerVelocity.y, 3.4);
      }
      mob.attackTimer = mob.attackCooldown;
    }

    if (mob.hp <= 0) deadIndices.push(i);
  }

  if (deadIndices.length > 0) {
    for (let i = deadIndices.length - 1; i >= 0; i -= 1) removeMobAt(deadIndices[i]);
    onCountsChanged();
  }
}
