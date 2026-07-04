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
  FIST_DAMAGE,
  MELEE_KNOCKBACK_IMPULSE
} from "@/lib/game/config";
import { adjustSlotCount, consumeToolDurability, countsById } from "@/lib/game/inventory";
import { powerBonus, punchKnockback } from "@/lib/game/enchantments";
import type { InventorySlot, MobKind } from "@/lib/game/types";
import type { EmitGameEvent, GameState, PlayerState } from "../state";
import { spawnArrow } from "../projectiles";
import { lookDirection } from "./playerMotion";

const scratchForward = new THREE.Vector3();
const scratchOrigin = new THREE.Vector3();
const scratchToMob = new THREE.Vector3();
const scratchKnock = new THREE.Vector3();

export function weaponDamage(player: PlayerState): number {
  const slot = player.inventory[player.selectedSlot];
  if (slot?.kind === "weapon" && slot.count > 0) return slot.attack ?? 8;
  return FIST_DAMAGE;
}

export function weaponReach(player: PlayerState): number {
  const slot = player.inventory[player.selectedSlot];
  if (slot?.kind === "weapon" && slot.count > 0) return slot.meleeReach ?? ATTACK_REACH;
  return ATTACK_REACH;
}

/**
 * Index of the mob nearest the crosshair within melee reach and aim cone, or
 * -1. Shared by attacking and by feeding animals (Phase 5) so both use the same
 * "what am I pointing at" rule.
 */
export function findAimedMobIndex(state: GameState, player: PlayerState, reach = ATTACK_REACH): number {
  const { position } = player;
  scratchOrigin.set(position.x, position.y + EYE_HEIGHT, position.z);
  lookDirection(player.yaw, player.pitch, scratchForward);

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
 * `knockback` is the extra horizontal impulse from the Knockback enchantment (0 by
 * default); `lootingLevel` (the held weapon's Looting) is forwarded to the kill
 * callback so the drop roll uses the *killing* weapon, not whatever is held when a
 * delayed kill resolves — Looting is a melee enchant, so indirect kills pass 0.
 */
export function tryAttackMob(
  state: GameState,
  player: PlayerState,
  damage: number,
  onMobKilled: (index: number, lootingLevel?: number) => void,
  reach = ATTACK_REACH,
  knockback = 0,
  lootingLevel = 0
): MobKind | null {
  const { position } = player;
  const bestIndex = findAimedMobIndex(state, player, reach);
  if (bestIndex < 0) return null;
  const mob = state.mobs[bestIndex];
  mob.hp -= damage;
  mob.lastHitByPlayer = player.id; // kill credit (incl. a later burn/sweep death)

  scratchKnock.copy(mob.position).sub(position).setY(0);
  if (scratchKnock.lengthSq() > 0.0001) {
    scratchKnock.normalize();
    mob.direction.copy(scratchKnock);
    mob.position.addScaledVector(scratchKnock, MELEE_KNOCKBACK_IMPULSE + knockback);
    mob.position.y += 0.12;
  }

  if (mob.hp <= 0) onMobKilled(bestIndex, lootingLevel);
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
export function tryFireBow(state: GameState, player: PlayerState, emit: EmitGameEvent, rng?: () => number): boolean {
  const slot = player.inventory[player.selectedSlot];
  if (!isBow(slot)) return false;
  if (player.timers.bowCooldownTimer > 0) return false;
  if ((countsById(player.inventory).get("arrow") ?? 0) < 1) return false;

  const { position, yaw, pitch } = player;
  scratchOrigin.set(position.x, position.y + EYE_HEIGHT, position.z);
  lookDirection(yaw, pitch, scratchForward);
  // Power and Punch are bow-only enchants, read off the held bow at the one fire seam.
  spawnArrow(state, scratchOrigin.x, scratchOrigin.y, scratchOrigin.z, scratchForward, {
    speed: ARROW_SPEED,
    damage: BOW_ARROW_DAMAGE + powerBonus(slot),
    knockback: BOW_KNOCKBACK + punchKnockback(slot),
    fromPlayer: true,
    owner: player.id, // kill credit follows the shooter
    ttl: ARROW_TTL
  });

  player.inventory = adjustSlotCount(player.inventory, "arrow", -1) ?? player.inventory;
  player.inventory = consumeToolDurability(player.inventory, player.selectedSlot, BOW_DURABILITY_PER_SHOT, rng) ?? player.inventory;
  player.timers.bowCooldownTimer = BOW_COOLDOWN_SECONDS;
  emit({ type: "bowFired" });
  return true;
}
