import * as THREE from "three";
import {
  ARROW_SPEED,
  ARROW_TTL,
  ATTACK_AIM_DOT,
  ATTACK_REACH,
  BOW_ARROW_DAMAGE,
  BOW_COOLDOWN_SECONDS,
  BOW_DURABILITY_PER_SHOT,
  BOW_KNOCKBACK,
  EYE_HEIGHT,
  FIST_DAMAGE
} from "@/lib/game/config";
import { adjustSlotCount, consumeToolDurability, countsById } from "@/lib/game/inventory";
import type { InventorySlot, MobKind } from "@/lib/game/types";
import type { EmitGameEvent, GameState } from "../state";
import { spawnArrow } from "../projectiles";
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

export function weaponReach(state: GameState): number {
  const slot = state.inventory[state.selectedSlot];
  if (slot?.kind === "weapon" && slot.count > 0) return slot.meleeReach ?? ATTACK_REACH;
  return ATTACK_REACH;
}

/**
 * Index of the mob nearest the crosshair within melee reach and aim cone, or
 * -1. Shared by attacking and by feeding animals (Phase 5) so both use the same
 * "what am I pointing at" rule.
 */
export function findAimedMobIndex(state: GameState, reach = ATTACK_REACH): number {
  const { position } = state.player;
  scratchOrigin.set(position.x, position.y + EYE_HEIGHT, position.z);
  lookDirection(state.player.yaw, state.player.pitch, scratchForward);

  let bestIndex = -1;
  let bestDist = Number.POSITIVE_INFINITY;

  for (let i = 0; i < state.mobs.length; i += 1) {
    const mob = state.mobs[i];
    scratchToMob.copy(mob.position).sub(scratchOrigin);
    const dist = scratchToMob.length();
    if (dist > reach) continue;
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
export function tryAttackMob(state: GameState, damage: number, onMobKilled: (index: number) => void, reach = ATTACK_REACH): MobKind | null {
  const { position } = state.player;
  const bestIndex = findAimedMobIndex(state, reach);
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

/** True when the held slot is a usable bow (the attack input fires instead of melees). */
export function isBow(slot: InventorySlot | undefined): boolean {
  return slot?.id === "bow" && slot.count > 0;
}

/**
 * Fires one arrow from the player's eye along their look direction, consuming an
 * arrow and a point of bow durability and arming the fire-rate cooldown. Returns
 * false (no shot) when the bow is on cooldown or the player has no arrows — the
 * caller has already confirmed a bow is held via isBow, so a bow never melees.
 */
export function tryFireBow(state: GameState, emit: EmitGameEvent): boolean {
  const slot = state.inventory[state.selectedSlot];
  if (!isBow(slot)) return false;
  if (state.timers.bowCooldownTimer > 0) return false;
  if ((countsById(state.inventory).get("arrow") ?? 0) < 1) return false;

  const { position, yaw, pitch } = state.player;
  scratchOrigin.set(position.x, position.y + EYE_HEIGHT, position.z);
  lookDirection(yaw, pitch, scratchForward);
  spawnArrow(state, scratchOrigin.x, scratchOrigin.y, scratchOrigin.z, scratchForward, {
    speed: ARROW_SPEED,
    damage: BOW_ARROW_DAMAGE,
    knockback: BOW_KNOCKBACK,
    fromPlayer: true,
    ttl: ARROW_TTL
  });

  state.inventory = adjustSlotCount(state.inventory, "arrow", -1) ?? state.inventory;
  state.inventory = consumeToolDurability(state.inventory, state.selectedSlot, BOW_DURABILITY_PER_SHOT) ?? state.inventory;
  state.timers.bowCooldownTimer = BOW_COOLDOWN_SECONDS;
  emit({ type: "bowFired" });
  return true;
}
