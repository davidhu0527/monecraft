import * as THREE from "three";
import { BABY_GROW_SECONDS, BABY_SCALE, BREED_CHECK_INTERVAL_SECONDS, BREED_PARTNER_RADIUS, PASSIVE_CAP } from "@/lib/game/config";
import { MOB_TEMPLATES, mobHalfHeight } from "@/lib/game/mobs";
import type { SurfaceYAtFn } from "@/lib/game/spawn";
import type { EmitGameEvent, GameState, MobState } from "../state";

/**
 * Animal breeding. Each tick ages babies up and counts down the "in love"
 * window; on an interval it pairs two fed adults of the same kind that are close
 * together into a baby, bounded by PASSIVE_CAP. Mobs are never persisted, so
 * breeding state is session-only by the engine's existing design.
 */
export function tickBreeding(state: GameState, dt: number, rng: () => number, surfaceYAt: SurfaceYAtFn, emit: EmitGameEvent): void {
  const { mobs } = state;

  // Per-tick: tick down love + maturity timers; a matured baby regains full size.
  for (const mob of mobs) {
    if (mob.fedTimer > 0) mob.fedTimer = Math.max(0, mob.fedTimer - dt);
    if (mob.ageTimer > 0) {
      mob.ageTimer = Math.max(0, mob.ageTimer - dt);
      if (mob.ageTimer === 0) mob.halfHeight = mobHalfHeight(mob.kind);
    }
  }

  state.timers.breedTimer += dt;
  if (state.timers.breedTimer < BREED_CHECK_INTERVAL_SECONDS) return;
  state.timers.breedTimer = 0;

  let passiveCount = mobs.reduce((acc, mob) => acc + (mob.hostile ? 0 : 1), 0);
  const radiusSq = BREED_PARTNER_RADIUS * BREED_PARTNER_RADIUS;

  for (let i = 0; i < mobs.length; i += 1) {
    if (passiveCount >= PASSIVE_CAP) break;
    const a = mobs[i];
    if (a.hostile || a.fedTimer <= 0 || a.ageTimer > 0) continue;
    for (let j = i + 1; j < mobs.length; j += 1) {
      const b = mobs[j];
      if (b.hostile || b.kind !== a.kind || b.fedTimer <= 0 || b.ageTimer > 0) continue;
      if (a.position.distanceToSquared(b.position) > radiusSq) continue;

      spawnBaby(state, a, rng, surfaceYAt);
      passiveCount += 1;
      a.fedTimer = 0;
      b.fedTimer = 0;
      emit({ type: "mobBred", kind: a.kind });
      break; // a has bred; move to the next animal
    }
  }
}

/** Spawns a juvenile of the parent's kind at the midpoint, scaled down until grown. */
function spawnBaby(state: GameState, parent: MobState, rng: () => number, surfaceYAt: SurfaceYAtFn): void {
  const template = MOB_TEMPLATES[parent.kind];
  const halfHeight = mobHalfHeight(parent.kind) * BABY_SCALE;
  const x = parent.position.x;
  const z = parent.position.z;
  const baby: MobState = {
    id: state.nextMobId,
    kind: parent.kind,
    hostile: false,
    hp: template.hp,
    position: new THREE.Vector3(x, surfaceYAt(x, z) + halfHeight, z),
    direction: new THREE.Vector3(rng() - 0.5, 0, rng() - 0.5).normalize(),
    yaw: 0,
    turnTimer: 1 + rng() * 3,
    speed: template.speed,
    moveSpeed: template.speed,
    detectRange: template.detectRange,
    attackDamage: template.attackDamage,
    attackCooldown: template.attackCooldown,
    attackTimer: rng(),
    halfHeight,
    bobSeed: rng() * 10,
    fedTimer: 0,
    ageTimer: BABY_GROW_SECONDS
  };
  state.nextMobId += 1;
  state.mobs.push(baby);
}
