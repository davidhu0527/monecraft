import * as THREE from "three";
import type { GameState, ProjectileState } from "./state";

export type SpawnArrowOptions = {
  speed: number;
  damage: number;
  knockback: number;
  fromPlayer: boolean;
  ttl: number;
};

// Spawn the arrow a little ahead of the muzzle so the firer never collides with
// its own arrow on the spawn frame.
const MUZZLE_OFFSET = 0.6;

const scratchDir = new THREE.Vector3();

/**
 * Launches an arrow from (originX, originY, originZ) along `dir`. The single
 * launch path shared by the player's bow, ranged skeletons, and the boss.
 * Returns the created projectile (handy for tests).
 */
export function spawnArrow(state: GameState, originX: number, originY: number, originZ: number, dir: THREE.Vector3, opts: SpawnArrowOptions): ProjectileState {
  scratchDir.copy(dir);
  if (scratchDir.lengthSq() < 1e-9) scratchDir.set(0, 0, -1);
  scratchDir.normalize();

  const velocity = scratchDir.clone().multiplyScalar(opts.speed);
  const projectile: ProjectileState = {
    id: state.nextProjectileId,
    position: new THREE.Vector3(originX + scratchDir.x * MUZZLE_OFFSET, originY + scratchDir.y * MUZZLE_OFFSET, originZ + scratchDir.z * MUZZLE_OFFSET),
    velocity,
    yaw: Math.atan2(scratchDir.x, scratchDir.z),
    pitch: Math.asin(Math.max(-1, Math.min(1, scratchDir.y))),
    damage: opts.damage,
    knockback: opts.knockback,
    fromPlayer: opts.fromPlayer,
    ttl: opts.ttl
  };

  state.nextProjectileId += 1;
  state.projectiles.push(projectile);
  return projectile;
}
