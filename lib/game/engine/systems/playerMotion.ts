import * as THREE from "three";
import { collidesAt, hasSupportUnderPlayer } from "@/lib/world";
import { canFly, isNoclip } from "@/lib/game/gameModes";
import {
  CROUCH_SPEED,
  FLY_SPEED,
  GRAVITY,
  JUMP_VELOCITY,
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT,
  SPRINT_MIN_HUNGER,
  SPRINT_SPEED,
  WALK_SPEED,
  WORLD_BORDER_PADDING
} from "@/lib/game/config";
import type { FrameInput, GameState } from "../state";
import { featherFallingReduction } from "@/lib/game/enchantments";
import { speedScaleFromHunger } from "./playerStats";
import { jumpBoostBonus, speedMultiplier } from "./statusEffects";

export type MoveTickResult = {
  didSprint: boolean;
  didWalk: boolean;
  didJump: boolean;
  /** Touched down this tick after being airborne. */
  didLand: boolean;
  /** Downward speed at touchdown (positive); 0 when didLand is false. */
  landImpact: number;
  horizontalDistance: number;
};

// Module-scope scratch vectors — the tick runs every frame and must not allocate.
const scratchForward = new THREE.Vector3();
const scratchRight = new THREE.Vector3();
const scratchMoveDir = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Horizontal forward direction for a yaw angle (camera order YXZ, looking down -Z). */
export function forwardFromYaw(yaw: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
}

/** Full look direction for yaw+pitch — what the camera's getWorldDirection returns. */
export function lookDirection(yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
  const cp = Math.cos(pitch);
  return out.set(-cp * Math.sin(yaw), Math.sin(pitch), -cp * Math.cos(yaw));
}

export function tickPlayerMotion(state: GameState, input: FrameInput, dt: number, applyDamage: (amount: number) => void): MoveTickResult {
  const { world, player, timers } = state;
  const keys = input.keys;
  // Spectator phases through terrain (noclip); Creative/Spectator fly with direct
  // vertical control instead of gravity.
  const noclip = isNoclip(state.gameMode);
  const flying = noclip || (state.isFlying && canFly(state.gameMode));

  const stepAxis = (axis: "x" | "y" | "z", amount: number) => {
    if (noclip) {
      player.position[axis] += amount; // pass straight through blocks
      return;
    }
    const stepSize = 0.05 * Math.sign(amount);
    let remaining = amount;
    while (Math.abs(remaining) > 1e-6) {
      const step = Math.abs(remaining) > Math.abs(stepSize) ? stepSize : remaining;
      player.position[axis] += step;
      if (collidesAt(world, player.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT)) {
        player.position[axis] -= step;
        if (axis === "y" && step < 0) player.onGround = true;
        if (axis === "y") player.velocity.y = 0;
        break;
      }
      remaining -= step;
    }
  };

  const forwardInput = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
  const strafeInput = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
  const wantsJump = keys.has("Space");
  const crouching = keys.has("KeyC");

  forwardFromYaw(player.yaw, scratchForward);
  scratchRight.crossVectors(scratchForward, UP).normalize();
  scratchMoveDir.set(0, 0, 0);
  scratchMoveDir.addScaledVector(scratchForward, forwardInput);
  scratchMoveDir.addScaledVector(scratchRight, strafeInput);
  if (scratchMoveDir.lengthSq() > 0) scratchMoveDir.normalize();

  const speedScale = speedScaleFromHunger(state.hunger);
  const canSprint = state.hunger > SPRINT_MIN_HUNGER;
  const sprinting = canSprint && forwardInput > 0 && keys.has("KeyW") && input.capsActive && !crouching;
  const baseSpeed = crouching ? CROUCH_SPEED : sprinting ? SPRINT_SPEED * speedScale : WALK_SPEED * speedScale;
  const speed = baseSpeed * speedMultiplier(state);

  player.velocity.x = scratchMoveDir.x * speed;
  player.velocity.z = scratchMoveDir.z * speed;

  const wasGrounded = player.onGround;
  let didJump = false;
  if (flying) {
    // Flight: direct vertical control, no gravity. Space ascends, crouch
    // descends, neither (or both) hovers. Collision still applies in Creative;
    // Spectator's noclip is handled in stepAxis.
    const ascend = (wantsJump ? 1 : 0) - (crouching ? 1 : 0);
    player.velocity.y = ascend * FLY_SPEED;
  } else {
    player.velocity.y -= GRAVITY * dt;
    if (wantsJump && player.onGround && !crouching) {
      player.velocity.y = JUMP_VELOCITY + jumpBoostBonus(state);
      player.onGround = false;
      didJump = true;
    }
  }

  const vyBeforeMove = player.velocity.y;
  const startX = player.position.x;
  const startZ = player.position.z;
  const prevX = player.position.x;
  const prevZ = player.position.z;

  player.onGround = false;
  stepAxis("x", player.velocity.x * dt);
  stepAxis("z", player.velocity.z * dt);
  stepAxis("y", player.velocity.y * dt);

  // Depenetration: if still colliding after movement, nudge up (skipped in noclip).
  if (!noclip && collidesAt(world, player.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT)) {
    for (let i = 0; i < 5; i += 1) {
      player.position.y += 0.2;
      if (!collidesAt(world, player.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT)) break;
    }
  }

  // While flying, crouch means "descend" — don't snap the player back from edges.
  if (!flying && crouching && (player.onGround || wasGrounded) && !hasSupportUnderPlayer(world, player.position, PLAYER_HALF_WIDTH + 0.12)) {
    player.position.x = prevX;
    player.position.z = prevZ;
    player.velocity.x = 0;
    player.velocity.z = 0;
  }

  player.position.x = Math.min(world.sizeX - WORLD_BORDER_PADDING, Math.max(WORLD_BORDER_PADDING, player.position.x));
  player.position.z = Math.min(world.sizeZ - WORLD_BORDER_PADDING, Math.max(WORLD_BORDER_PADDING, player.position.z));

  if (!wasGrounded && player.onGround && vyBeforeMove < -14) {
    // Any fall hard enough to trigger this deals at least half a heart; Feather
    // Falling on worn boots softens the landing before armor mitigation.
    const raw = Math.min(19, Math.floor((-vyBeforeMove - 13) * 0.5));
    const softened = raw * (1 - featherFallingReduction(state.equippedArmor.boots));
    applyDamage(Math.max(1, Math.round(softened)));
  }

  const inVoid = player.position.y < -4;
  if (inVoid) {
    timers.voidTimer += dt;
    if (timers.voidTimer >= 0.4) {
      applyDamage(1);
      timers.voidTimer = 0;
    }
  } else {
    timers.voidTimer = 0;
  }

  const horizontalDistance = Math.hypot(player.position.x - startX, player.position.z - startZ);
  const moving = horizontalDistance > 1e-4;
  const didSprint = sprinting && moving;
  const didWalk = !didSprint && moving;
  const didLand = !wasGrounded && player.onGround && vyBeforeMove < 0;
  return { didSprint, didWalk, didJump, didLand, landImpact: didLand ? -vyBeforeMove : 0, horizontalDistance };
}
