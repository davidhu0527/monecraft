import * as THREE from "three";
import { ATTACK_AIM_DOT, ATTACK_REACH, EYE_HEIGHT, FIST_DAMAGE } from "@/lib/game/config";
import type { MobKind } from "@/lib/game/types";
import type { GameState } from "../state";
import { lookDirection } from "./playerMotion";

const scratchForward = new THREE.Vector3();
const scratchOrigin = new THREE.Vector3();
const scratchToMob = new THREE.Vector3();
const scratchKnock = new THREE.Vector3();

export function weaponDamage(state: GameState): number {
  const slot = state.inventory[state.selectedSlot];
  if (slot?.kind === "weapon" && slot.count > 0) return slot.attack ?? 8;
  return FIST_DAMAGE;
}

/**
 * Index of the mob nearest the crosshair within melee reach and aim cone, or
 * -1. Shared by attacking and by feeding animals (Phase 5) so both use the same
 * "what am I pointing at" rule.
 */
export function findAimedMobIndex(state: GameState): number {
  const { position } = state.player;
  scratchOrigin.set(position.x, position.y + EYE_HEIGHT, position.z);
  lookDirection(state.player.yaw, state.player.pitch, scratchForward);

  let bestIndex = -1;
  let bestDist = Number.POSITIVE_INFINITY;

  for (let i = 0; i < state.mobs.length; i += 1) {
    const mob = state.mobs[i];
    scratchToMob.copy(mob.position).sub(scratchOrigin);
    const dist = scratchToMob.length();
    if (dist > ATTACK_REACH) continue;
    scratchToMob.normalize();
    if (scratchForward.dot(scratchToMob) < ATTACK_AIM_DOT) continue;
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
    }
  }
  return bestIndex;
}

/**
 * Melee attack at the mob nearest the crosshair within reach. Returns the kind
 * of the mob hit (or null); the caller (engine) handles death drops and durability.
 */
export function tryAttackMob(state: GameState, damage: number, onMobKilled: (index: number) => void): MobKind | null {
  const { position } = state.player;
  const bestIndex = findAimedMobIndex(state);
  if (bestIndex < 0) return null;
  const mob = state.mobs[bestIndex];
  mob.hp -= damage;

  scratchKnock.copy(mob.position).sub(position).setY(0);
  if (scratchKnock.lengthSq() > 0.0001) {
    scratchKnock.normalize();
    mob.direction.copy(scratchKnock);
    mob.position.addScaledVector(scratchKnock, 0.75);
    mob.position.y += 0.12;
  }

  if (mob.hp <= 0) onMobKilled(bestIndex);
  return mob.kind;
}
