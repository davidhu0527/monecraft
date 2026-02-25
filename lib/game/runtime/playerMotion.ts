import * as THREE from "three";
import { collidesAt, hasSupportUnderPlayer, VoxelWorld } from "@/lib/world";

type PlayerState = {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  onGround: boolean;
};

type MoveTickArgs = {
  dt: number;
  world: VoxelWorld;
  camera: THREE.PerspectiveCamera;
  keys: Set<string>;
  capsActive: boolean;
  player: PlayerState;
  applyDamage: (amount: number) => void;
  playerHeight: number;
  playerHalfWidth: number;
  walkSpeed: number;
  sprintSpeed: number;
  crouchSpeed: number;
  gravity: number;
  jumpVelocity: number;
  worldBorderPadding: number;
  voidTimer: number;
  canSprint: boolean;
};

export function tickPlayerMovement(args: MoveTickArgs): { voidTimer: number; didSprint: boolean; didWalk: boolean; didJump: boolean; horizontalDistance: number } {
  const {
    dt,
    world,
    camera,
    keys,
    capsActive,
    player,
    applyDamage,
    playerHeight,
    playerHalfWidth,
    walkSpeed,
    sprintSpeed,
    crouchSpeed,
    gravity,
    jumpVelocity,
    worldBorderPadding,
    canSprint
  } = args;
  let { voidTimer } = args;

  const stepAxis = (axis: "x" | "y" | "z", amount: number) => {
    const stepSize = 0.05 * Math.sign(amount);
    let remaining = amount;
    while (Math.abs(remaining) > 1e-6) {
      const step = Math.abs(remaining) > Math.abs(stepSize) ? stepSize : remaining;
      player.position[axis] += step;
      if (collidesAt(world, player.position, playerHalfWidth, playerHeight)) {
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

  const up = new THREE.Vector3(0, 1, 0);
  const dirForward = new THREE.Vector3();
  const dirRight = new THREE.Vector3();
  const moveDir = new THREE.Vector3();

  camera.getWorldDirection(dirForward);
  dirForward.y = 0;
  if (dirForward.lengthSq() < 1e-6) dirForward.set(0, 0, -1);
  dirForward.normalize();
  dirRight.crossVectors(dirForward, up).normalize();

  moveDir.addScaledVector(dirForward, forwardInput);
  moveDir.addScaledVector(dirRight, strafeInput);
  if (moveDir.lengthSq() > 0) moveDir.normalize();

  const sprinting = canSprint && forwardInput > 0 && keys.has("KeyW") && capsActive && !crouching;
  const speed = crouching ? crouchSpeed : sprinting ? sprintSpeed : walkSpeed;

  player.velocity.x = moveDir.x * speed;
  player.velocity.z = moveDir.z * speed;

  const wasGrounded = player.onGround;
  player.velocity.y -= gravity * dt;
  let didJump = false;
  if (wantsJump && player.onGround && !crouching) {
    player.velocity.y = jumpVelocity;
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
  if (collidesAt(world, player.position, playerHalfWidth, playerHeight)) {
    for (let i = 0; i < 5; i += 1) {
      player.position.y += 0.2;
      if (!collidesAt(world, player.position, playerHalfWidth, playerHeight)) break;
    }
  }

  if (crouching && (player.onGround || wasGrounded) && !hasSupportUnderPlayer(world, player.position, playerHalfWidth + 0.12)) {
    player.position.x = prevX;
    player.position.z = prevZ;
    player.velocity.x = 0;
    player.velocity.z = 0;
  }

  player.position.x = Math.min(world.sizeX - worldBorderPadding, Math.max(worldBorderPadding, player.position.x));
  player.position.z = Math.min(world.sizeZ - worldBorderPadding, Math.max(worldBorderPadding, player.position.z));

  if (!wasGrounded && player.onGround && vyBeforeMove < -14) {
    applyDamage(Math.min(18, Math.floor((-vyBeforeMove - 13) * 1.15)));
  }

  const inVoid = player.position.y < -4;
  if (inVoid) {
    voidTimer += dt;
    if (voidTimer >= 0.4) {
      applyDamage(3);
      voidTimer = 0;
    }
  } else {
    voidTimer = 0;
  }

  const horizontalDistance = Math.hypot(player.position.x - startX, player.position.z - startZ);
  const moving = horizontalDistance > 1e-4;
  const didSprint = sprinting && moving;
  const didWalk = !didSprint && moving;
  return { voidTimer, didSprint, didWalk, didJump, horizontalDistance };
}
