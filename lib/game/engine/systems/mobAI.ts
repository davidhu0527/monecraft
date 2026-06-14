import * as THREE from "three";
import { voxelRaycast } from "@/lib/world";
import {
  ARROW_TTL,
  HOSTILE_BURN_ABOVE_DAYLIGHT,
  MOB_ARROW_KNOCKBACK,
  SKELETON_ARROW_DAMAGE,
  SKELETON_ARROW_SPEED,
  SKELETON_FIRE_VGAP,
  SKELETON_LEAD_FACTOR,
  SKELETON_STANDOFF_MAX,
  SKELETON_STANDOFF_MIN,
  SPIDER_AGGRO_BELOW_DAYLIGHT
} from "@/lib/game/config";
import { MOB_TEMPLATES } from "@/lib/game/mobs";
import type { EmitGameEvent, GameState, MobState } from "../state";
import { spawnArrow } from "../projectiles";
import type { SurfaceYAtFn } from "@/lib/game/spawn";

// Scratch vectors — per-frame tick over every mob must not allocate.
const UP = new THREE.Vector3(0, 1, 0);
const scratchToPlayer = new THREE.Vector3();
const scratchToPlayer3D = new THREE.Vector3();
const scratchMobEye = new THREE.Vector3();
const scratchPlayerAim = new THREE.Vector3();
const scratchRay = new THREE.Vector3();
const scratchAim = new THREE.Vector3();

/**
 * A ranged mob looses an arrow from its eye toward the player's chest, leading a
 * moving target by a fraction of the arrow's travel time. The arrow is not
 * player-owned, so it only ever hits the player (never the firer or other mobs).
 */
function fireMobArrow(state: GameState, mob: MobState, damage: number, speed: number, emit: EmitGameEvent): void {
  const { player } = state;
  const eyeY = mob.position.y + mob.halfHeight * 0.7;
  const dist = Math.hypot(player.position.x - mob.position.x, player.position.z - mob.position.z);
  const lead = (dist / speed) * SKELETON_LEAD_FACTOR;
  scratchAim.set(
    player.position.x + player.velocity.x * lead - mob.position.x,
    player.position.y + 0.9 - eyeY,
    player.position.z + player.velocity.z * lead - mob.position.z
  );
  spawnArrow(state, mob.position.x, eyeY, mob.position.z, scratchAim, {
    speed,
    damage,
    knockback: MOB_ARROW_KNOCKBACK,
    fromPlayer: false,
    ttl: ARROW_TTL
  });
  emit({ type: "mobAttacked", kind: mob.kind });
}

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
    const isRanged = MOB_TEMPLATES[mob.kind].ranged === true;
    let moveSign = 1;

    if (activeHostile && distanceToPlayer < mob.detectRange) {
      if (distanceToPlayer > 0.001) mob.direction.lerp(scratchToPlayer.normalize(), 0.2).normalize();
      moveSpeed *= 1.15;
      // Ranged mobs kite: back off when too close, hold inside the standoff band.
      if (isRanged) {
        if (distanceToPlayer < SKELETON_STANDOFF_MIN) moveSign = -1;
        else if (distanceToPlayer <= SKELETON_STANDOFF_MAX) moveSign = 0;
      }
    } else if (!mob.hostile && distanceToPlayer < 4.2) {
      if (distanceToPlayer > 0.001) mob.direction.lerp(scratchToPlayer.normalize().multiplyScalar(-1), 0.2).normalize();
      moveSpeed *= 1.15;
    } else if (mob.turnTimer <= 0) {
      mob.direction.applyAxisAngle(UP, (deps.rng() - 0.5) * Math.PI).normalize();
      mob.turnTimer = 1.5 + deps.rng() * 4;
    }
    mob.moveSpeed = moveSpeed;

    let nx = mob.position.x + mob.direction.x * moveSpeed * dt * moveSign;
    let nz = mob.position.z + mob.direction.z * moveSpeed * dt * moveSign;

    if (nx < 2 || nz < 2 || nx > world.sizeX - 2 || nz > world.sizeZ - 2) {
      mob.direction.multiplyScalar(-1);
      nx = mob.position.x + mob.direction.x * moveSpeed * dt * moveSign;
      nz = mob.position.z + mob.direction.z * moveSpeed * dt * moveSign;
      mob.turnTimer = 1;
    }

    const ground = deps.surfaceYAt(nx, nz);
    mob.position.set(nx, ground + mob.halfHeight, nz);
    mob.yaw = Math.atan2(mob.direction.x, mob.direction.z);

    // Ranged mobs shoot from anywhere in their detect range; melee mobs must be adjacent.
    const meleeReady = activeHostile && attackDistance < 4 && verticalGap < 1.6;
    const fireReady = isRanged && activeHostile && attackDistance < mob.detectRange && verticalGap < SKELETON_FIRE_VGAP;

    let hasLineOfSight = true;
    if (meleeReady || fireReady) {
      scratchMobEye.set(mob.position.x, mob.position.y + mob.halfHeight * 0.35, mob.position.z);
      scratchPlayerAim.set(playerPosition.x, playerPosition.y + 0.9, playerPosition.z);
      scratchRay.copy(scratchPlayerAim).sub(scratchMobEye);
      if (scratchRay.lengthSq() > 1e-6) {
        const hit = voxelRaycast(world, scratchMobEye, scratchRay.normalize(), attackDistance + 0.5);
        hasLineOfSight = hit === null;
      }
    }

    // !isDead: mobs keep ticking through the respawn countdown, but attacking a
    // corpse should neither sound nor re-arm the attack cooldown.
    if (!isDead && (meleeReady || fireReady) && hasLineOfSight && mob.attackTimer <= 0) {
      if (fireReady) {
        fireMobArrow(state, mob, SKELETON_ARROW_DAMAGE, SKELETON_ARROW_SPEED, deps.emit);
      } else {
        deps.emit({ type: "mobAttacked", kind: mob.kind });
        deps.applyDamage(mob.attackDamage);
        if (distanceToPlayer > 0.001) {
          scratchToPlayer.normalize().multiplyScalar(4.2);
          playerVelocity.x += scratchToPlayer.x;
          playerVelocity.z += scratchToPlayer.z;
          playerVelocity.y = Math.max(playerVelocity.y, 3.4);
        }
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
