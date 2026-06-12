import * as THREE from "three";
import { voxelRaycast } from "@/lib/world";
import { HOSTILE_BURN_ABOVE_DAYLIGHT, SPIDER_AGGRO_BELOW_DAYLIGHT } from "@/lib/game/config";
import type { EmitGameEvent, GameState } from "../state";
import type { SurfaceYAtFn } from "@/lib/game/spawn";

// Scratch vectors — per-frame tick over every mob must not allocate.
const UP = new THREE.Vector3(0, 1, 0);
const scratchToPlayer = new THREE.Vector3();
const scratchToPlayer3D = new THREE.Vector3();
const scratchMobEye = new THREE.Vector3();
const scratchPlayerAim = new THREE.Vector3();
const scratchRay = new THREE.Vector3();

export type MobTickDeps = {
  surfaceYAt: SurfaceYAtFn;
  applyDamage: (amount: number) => void;
  removeMobAt: (index: number) => void;
  rng: () => number;
  emit: EmitGameEvent;
};

export function tickMobs(state: GameState, dt: number, deps: MobTickDeps): void {
  const { world, daylight, mobs, isDead } = state;
  const playerPosition = state.player.position;
  const playerVelocity = state.player.velocity;
  const deadIndices: number[] = [];

  for (let i = 0; i < mobs.length; i += 1) {
    const mob = mobs[i];
    mob.attackTimer -= dt;
    mob.turnTimer -= dt;
    const activeHostile = mob.hostile && (mob.kind !== "spider" || daylight < SPIDER_AGGRO_BELOW_DAYLIGHT);

    scratchToPlayer.copy(playerPosition).sub(mob.position).setY(0);
    const distanceToPlayer = scratchToPlayer.length();
    scratchToPlayer3D.copy(playerPosition).sub(mob.position);
    const attackDistance = scratchToPlayer3D.length();
    const verticalGap = Math.abs(scratchToPlayer3D.y);
    let moveSpeed = mob.speed;

    if (activeHostile && distanceToPlayer < mob.detectRange) {
      if (distanceToPlayer > 0.001) mob.direction.lerp(scratchToPlayer.normalize(), 0.2).normalize();
      moveSpeed *= 1.15;
    } else if (!mob.hostile && distanceToPlayer < 4.2) {
      if (distanceToPlayer > 0.001) mob.direction.lerp(scratchToPlayer.normalize().multiplyScalar(-1), 0.2).normalize();
      moveSpeed *= 1.15;
    } else if (mob.turnTimer <= 0) {
      mob.direction.applyAxisAngle(UP, (deps.rng() - 0.5) * Math.PI).normalize();
      mob.turnTimer = 1.5 + deps.rng() * 4;
    }
    mob.moveSpeed = moveSpeed;

    let nx = mob.position.x + mob.direction.x * moveSpeed * dt;
    let nz = mob.position.z + mob.direction.z * moveSpeed * dt;

    if (nx < 2 || nz < 2 || nx > world.sizeX - 2 || nz > world.sizeZ - 2) {
      mob.direction.multiplyScalar(-1);
      nx = mob.position.x + mob.direction.x * moveSpeed * dt;
      nz = mob.position.z + mob.direction.z * moveSpeed * dt;
      mob.turnTimer = 1;
    }

    const ground = deps.surfaceYAt(nx, nz);
    mob.position.set(nx, ground + mob.halfHeight, nz);
    mob.yaw = Math.atan2(mob.direction.x, mob.direction.z);

    let hasLineOfSight = true;
    if (activeHostile && attackDistance < 4 && verticalGap < 1.6) {
      scratchMobEye.set(mob.position.x, mob.position.y + mob.halfHeight * 0.35, mob.position.z);
      scratchPlayerAim.set(playerPosition.x, playerPosition.y + 0.9, playerPosition.z);
      scratchRay.copy(scratchPlayerAim).sub(scratchMobEye);
      if (scratchRay.lengthSq() > 1e-6) {
        const hit = voxelRaycast(world, scratchMobEye, scratchRay.normalize(), attackDistance + 0.5);
        hasLineOfSight = hit === null;
      }
    }

    if (activeHostile && attackDistance < 4 && verticalGap < 1.6 && hasLineOfSight && mob.attackTimer <= 0) {
      deps.emit({ type: "mobAttacked", kind: mob.kind });
      deps.applyDamage(mob.attackDamage);
      if (!isDead && distanceToPlayer > 0.001) {
        scratchToPlayer.normalize().multiplyScalar(4.2);
        playerVelocity.x += scratchToPlayer.x;
        playerVelocity.z += scratchToPlayer.z;
        playerVelocity.y = Math.max(playerVelocity.y, 3.4);
      }
      mob.attackTimer = mob.attackCooldown;
    }

    // Zombies and skeletons burn in broad daylight.
    if (mob.hostile && mob.kind !== "spider" && daylight > HOSTILE_BURN_ABOVE_DAYLIGHT) {
      mob.hp -= dt * 0.8;
    }

    if (mob.hp <= 0) deadIndices.push(i);
  }

  for (let i = deadIndices.length - 1; i >= 0; i -= 1) deps.removeMobAt(deadIndices[i]);
}
