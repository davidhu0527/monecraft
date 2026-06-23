import * as THREE from "three";
import { voxelRaycast } from "@/lib/world";
import {
  EYE_HEIGHT,
  SPEAR_HIT_RADIUS,
  SPEAR_STUCK_SECONDS,
  SPEAR_THROW_COOLDOWN_SECONDS,
  SPEAR_THROW_GRAVITY,
  SPEAR_THROW_LIFETIME_SECONDS,
  SPEAR_THROW_SPEED
} from "@/lib/game/config";
import { consumeToolDurability } from "@/lib/game/inventory";
import type { EmitGameEvent, GameState, ThrownSpearState } from "../state";
import { lookDirection } from "./playerMotion";

const scratchDirection = new THREE.Vector3();
const scratchDisplacement = new THREE.Vector3();
const scratchClosest = new THREE.Vector3();
const scratchToMob = new THREE.Vector3();

export function tryThrowSelectedSpear(state: GameState, emit: EmitGameEvent, rng?: () => number): boolean {
  const slot = state.inventory[state.selectedSlot];
  if (!slot?.id?.endsWith("_spear") || slot.kind !== "weapon" || !slot.throwDamage) return false;
  if (state.timers.spearThrowCooldown > 0) return true;

  lookDirection(state.player.yaw, state.player.pitch, scratchDirection);
  const position = new THREE.Vector3(state.player.position.x, state.player.position.y + EYE_HEIGHT, state.player.position.z).addScaledVector(
    scratchDirection,
    0.55
  );
  state.thrownSpears.push({
    id: state.nextThrownSpearId,
    itemId: slot.id,
    position,
    velocity: scratchDirection.clone().multiplyScalar(SPEAR_THROW_SPEED),
    damage: slot.throwDamage,
    age: 0,
    stuckTimer: null
  });
  state.nextThrownSpearId += 1;
  state.timers.spearThrowCooldown = SPEAR_THROW_COOLDOWN_SECONDS;
  state.inventory = consumeToolDurability(state.inventory, state.selectedSlot, 1, rng) ?? state.inventory;
  emit({ type: "attackSwung" });
  return true;
}

function segmentHitFraction(spear: ThrownSpearState, displacement: THREE.Vector3, mobPosition: THREE.Vector3, radius: number): number | null {
  const lengthSq = displacement.lengthSq();
  if (lengthSq <= 0) return null;
  scratchToMob.copy(mobPosition).sub(spear.position);
  const fraction = Math.max(0, Math.min(1, scratchToMob.dot(displacement) / lengthSq));
  scratchClosest.copy(spear.position).addScaledVector(displacement, fraction);
  return scratchClosest.distanceToSquared(mobPosition) <= radius * radius ? fraction : null;
}

export function tickThrownSpears(state: GameState, dt: number, removeMobAt: (index: number) => void, emit: EmitGameEvent): void {
  state.timers.spearThrowCooldown = Math.max(0, state.timers.spearThrowCooldown - dt);
  if (state.thrownSpears.length === 0) return;

  const survivors: ThrownSpearState[] = [];
  for (const spear of state.thrownSpears) {
    if (spear.stuckTimer !== null) {
      spear.stuckTimer += dt;
      if (spear.stuckTimer < SPEAR_STUCK_SECONDS) survivors.push(spear);
      continue;
    }

    spear.age += dt;
    if (spear.age >= SPEAR_THROW_LIFETIME_SECONDS) continue;

    scratchDisplacement.copy(spear.velocity).multiplyScalar(dt);
    const distance = scratchDisplacement.length();
    const terrainHit = distance > 0 ? voxelRaycast(state.world, spear.position, scratchDisplacement, distance) : null;
    const terrainFraction = terrainHit && distance > 0 ? terrainHit.distance / distance : Number.POSITIVE_INFINITY;

    let hitIndex = -1;
    let hitFraction = terrainFraction;
    for (let i = 0; i < state.mobs.length; i += 1) {
      const mob = state.mobs[i];
      const fraction = segmentHitFraction(spear, scratchDisplacement, mob.position, SPEAR_HIT_RADIUS + mob.halfHeight * 0.35);
      if (fraction === null || fraction >= hitFraction) continue;
      hitFraction = fraction;
      hitIndex = i;
    }

    if (hitIndex >= 0) {
      const mob = state.mobs[hitIndex];
      const kind = mob.kind;
      mob.hp -= spear.damage;
      scratchDirection.copy(spear.velocity).setY(0);
      if (scratchDirection.lengthSq() > 0.0001) {
        scratchDirection.normalize();
        mob.direction.copy(scratchDirection);
        mob.position.addScaledVector(scratchDirection, 0.9);
      }
      emit({ type: "mobHit", kind });
      if (mob.hp <= 0) removeMobAt(hitIndex);
      continue;
    }

    if (terrainHit) {
      spear.position.addScaledVector(scratchDisplacement, terrainFraction);
      spear.stuckTimer = 0;
      survivors.push(spear);
      continue;
    }
    spear.position.add(scratchDisplacement);
    spear.velocity.y -= SPEAR_THROW_GRAVITY * dt;
    survivors.push(spear);
  }
  state.thrownSpears = survivors;
}
