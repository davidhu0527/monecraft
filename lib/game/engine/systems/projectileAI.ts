import * as THREE from "three";
import { voxelRaycast } from "@/lib/world";
import { ARROW_GRAVITY, ARROW_HIT_RADIUS, ARROW_MAX_SEGMENT, ARROW_MAX_SUBSTEPS, PLAYER_HALF_WIDTH, PLAYER_HEIGHT } from "@/lib/game/config";
import type { EmitGameEvent, GameState, MobState } from "../state";

export type ProjectileTickDeps = {
  applyDamage: (amount: number) => void;
  removeMobAt: (index: number) => void;
  emit: EmitGameEvent;
};

// Scratch vectors — the tick runs every frame over every arrow and must not allocate.
const segDir = new THREE.Vector3();
const knock = new THREE.Vector3();

/**
 * Distance along the unit-direction segment [origin, origin + dir*len] of the
 * point on it closest to (px, py, pz), clamped to the segment endpoints.
 */
function closestParam(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number, px: number, py: number, pz: number): number {
  const t = (px - ox) * dx + (py - oy) * dy + (pz - oz) * dz;
  return t < 0 ? 0 : t > len ? len : t;
}

// A boss body is far wider than the default padding suits, so widen the hit
// cylinder for tall mobs; ordinary mobs keep the tight 0.45 padding.
function mobBodyRadius(mob: MobState): number {
  return ARROW_HIT_RADIUS + (mob.halfHeight > 1.4 ? 0.9 : 0);
}

/**
 * Advances every in-flight arrow. Each arrow integrates under gravity in capped
 * substeps so a fast shot can't skip a 1-block wall or a thin mob: per substep
 * it sweeps the world DDA for a block hit and tests the segment against the
 * relevant entity (mobs for player arrows, the player for mob arrows), resolving
 * whichever is nearer. Spent arrows (hit, expired, or out of bounds) despawn.
 */
export function tickProjectiles(state: GameState, dt: number, deps: ProjectileTickDeps): void {
  const { world, projectiles } = state;
  if (projectiles.length === 0) return;
  const dead: number[] = [];

  for (let i = 0; i < projectiles.length; i += 1) {
    const p = projectiles[i];
    p.ttl -= dt;
    if (p.ttl <= 0) {
      dead.push(i);
      continue;
    }

    const substeps = Math.min(ARROW_MAX_SUBSTEPS, Math.max(1, Math.ceil((p.velocity.length() * dt) / ARROW_MAX_SEGMENT)));
    const sdt = dt / substeps;
    let removed = false;

    for (let s = 0; s < substeps && !removed; s += 1) {
      p.velocity.y -= ARROW_GRAVITY * sdt;
      const segLen = p.velocity.length() * sdt;
      if (segLen < 1e-9) continue;
      segDir.copy(p.velocity).divideScalar(p.velocity.length());

      // Swept block collision (reuses the world DDA used for mining/line-of-sight).
      let blockT = Number.POSITIVE_INFINITY;
      const blockHit = voxelRaycast(world, p.position, segDir, segLen);
      if (blockHit && blockHit.distance <= segLen) blockT = blockHit.distance;

      // Nearest entity along the segment.
      let entityT = Number.POSITIVE_INFINITY;
      let hitMobIndex = -1;
      if (p.fromPlayer) {
        for (let m = 0; m < state.mobs.length; m += 1) {
          const mob = state.mobs[m];
          const t = closestParam(
            p.position.x,
            p.position.y,
            p.position.z,
            segDir.x,
            segDir.y,
            segDir.z,
            segLen,
            mob.position.x,
            mob.position.y,
            mob.position.z
          );
          const horiz = Math.hypot(p.position.x + segDir.x * t - mob.position.x, p.position.z + segDir.z * t - mob.position.z);
          const vert = Math.abs(p.position.y + segDir.y * t - mob.position.y);
          if (horiz <= mobBodyRadius(mob) && vert <= mob.halfHeight + ARROW_HIT_RADIUS && t < entityT) {
            entityT = t;
            hitMobIndex = m;
          }
        }
      } else {
        const feet = state.player.position;
        const midY = feet.y + PLAYER_HEIGHT / 2;
        const t = closestParam(p.position.x, p.position.y, p.position.z, segDir.x, segDir.y, segDir.z, segLen, feet.x, midY, feet.z);
        const horiz = Math.hypot(p.position.x + segDir.x * t - feet.x, p.position.z + segDir.z * t - feet.z);
        const vert = Math.abs(p.position.y + segDir.y * t - midY);
        if (horiz <= PLAYER_HALF_WIDTH + ARROW_HIT_RADIUS && vert <= PLAYER_HEIGHT / 2 + ARROW_HIT_RADIUS) entityT = t;
      }

      if (entityT !== Number.POSITIVE_INFINITY && entityT <= blockT) {
        const hx = p.position.x + segDir.x * entityT;
        const hy = p.position.y + segDir.y * entityT;
        const hz = p.position.z + segDir.z * entityT;
        if (p.fromPlayer) {
          const mob = state.mobs[hitMobIndex];
          mob.hp -= p.damage;
          knock.set(segDir.x, 0, segDir.z);
          if (knock.lengthSq() > 1e-6) {
            knock.normalize();
            mob.direction.copy(knock);
            mob.position.addScaledVector(knock, p.knockback);
            mob.position.y += 0.1;
          }
          deps.emit({ type: "mobHit", kind: mob.kind });
          deps.emit({ type: "arrowHit", x: hx, y: hy, z: hz, target: "mob" });
          if (mob.hp <= 0) deps.removeMobAt(hitMobIndex);
        } else {
          deps.applyDamage(p.damage);
          state.player.velocity.x += segDir.x * p.knockback;
          state.player.velocity.z += segDir.z * p.knockback;
          deps.emit({ type: "arrowHit", x: hx, y: hy, z: hz, target: "player" });
        }
        removed = true;
      } else if (blockT !== Number.POSITIVE_INFINITY) {
        deps.emit({
          type: "arrowHit",
          x: p.position.x + segDir.x * blockT,
          y: p.position.y + segDir.y * blockT,
          z: p.position.z + segDir.z * blockT,
          target: "block"
        });
        removed = true;
      } else {
        p.position.addScaledVector(segDir, segLen);
      }
    }

    if (!removed) {
      const speed = p.velocity.length();
      p.yaw = Math.atan2(p.velocity.x, p.velocity.z);
      p.pitch = Math.asin(speed > 1e-6 ? Math.max(-1, Math.min(1, p.velocity.y / speed)) : 0);
      if (
        p.position.x < 1 ||
        p.position.z < 1 ||
        p.position.x > world.sizeX - 1 ||
        p.position.z > world.sizeZ - 1 ||
        p.position.y < 0 ||
        p.position.y > world.sizeY
      ) {
        removed = true;
      }
    }
    if (removed) dead.push(i);
  }

  for (let i = dead.length - 1; i >= 0; i -= 1) projectiles.splice(dead[i], 1);
}
