import * as THREE from "three";
import { collidesAt, hasSupportUnderPlayer } from "@/lib/world";
import { CROUCH_SPEED, GRAVITY, JUMP_VELOCITY, PLAYER_HALF_WIDTH, PLAYER_HEIGHT, SPRINT_SPEED, WALK_SPEED, WORLD_BORDER_PADDING } from "@/lib/game/config";
import type { FrameInput, GameState } from "../state";
import { speedScaleFromHunger } from "./playerStats";

export type MoveTickResult = {
  didSprint: boolean;
  didWalk: boolean;
  didJump: boolean;
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

  const stepAxis = (axis: "x" | "y" | "z", amount: number) => {
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
  const canSprint = state.hunger > 0;
  const sprinting = canSprint && forwardInput > 0 && keys.has("KeyW") && input.capsActive && !crouching;
  const speed = crouching ? CROUCH_SPEED : sprinting ? SPRINT_SPEED * speedScale : WALK_SPEED * speedScale;

  player.velocity.x = scratchMoveDir.x * speed;
  player.velocity.z = scratchMoveDir.z * speed;

  const wasGrounded = player.onGround;
  player.velocity.y -= GRAVITY * dt;
  let didJump = false;
  if (wantsJump && player.onGround && !crouching) {
    player.velocity.y = JUMP_VELOCITY;
    player.onGround = false;
    didJump = true;
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

  // Depenetration: if still colliding after movement, nudge up
  if (collidesAt(world, player.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT)) {
    for (let i = 0; i < 5; i += 1) {
      player.position.y += 0.2;
      if (!collidesAt(world, player.position, PLAYER_HALF_WIDTH, PLAYER_HEIGHT)) break;
    }
  }

  if (crouching && (player.onGround || wasGrounded) && !hasSupportUnderPlayer(world, player.position, PLAYER_HALF_WIDTH + 0.12)) {
    player.position.x = prevX;
    player.position.z = prevZ;
    player.velocity.x = 0;
    player.velocity.z = 0;
  }

  player.position.x = Math.min(world.sizeX - WORLD_BORDER_PADDING, Math.max(WORLD_BORDER_PADDING, player.position.x));
  player.position.z = Math.min(world.sizeZ - WORLD_BORDER_PADDING, Math.max(WORLD_BORDER_PADDING, player.position.z));

  if (!wasGrounded && player.onGround && vyBeforeMove < -14) {
    applyDamage(Math.min(18, Math.floor((-vyBeforeMove - 13) * 1.15)));
  }

  const inVoid = player.position.y < -4;
  if (inVoid) {
    timers.voidTimer += dt;
    if (timers.voidTimer >= 0.4) {
      applyDamage(3);
      timers.voidTimer = 0;
    }
  } else {
    timers.voidTimer = 0;
  }

  const horizontalDistance = Math.hypot(player.position.x - startX, player.position.z - startZ);
  const moving = horizontalDistance > 1e-4;
  const didSprint = sprinting && moving;
  const didWalk = !didSprint && moving;
  return { didSprint, didWalk, didJump, horizontalDistance };
}
