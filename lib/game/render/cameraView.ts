import * as THREE from "three";
import type { CameraMode } from "@/lib/game/engine/state";

/**
 * Pure camera placement math for the view modes. No world access — the
 * renderer raycasts for wall clamping and passes the final boom distance in.
 * Conventions match the rest of the engine: forward at yaw 0 is -Z, rotation
 * order YXZ, positive pitch looks up.
 */

export type CameraPose = {
  posX: number;
  posY: number;
  posZ: number;
  yaw: number;
  pitch: number;
};

/** Unit direction from the eye toward the desired camera position. */
export function cameraOffsetDirection(mode: "third-rear" | "third-front", yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
  const cp = Math.cos(pitch);
  // The player's look direction — same formula as lookDirection() in playerMotion.
  out.set(-cp * Math.sin(yaw), Math.sin(pitch), -cp * Math.cos(yaw));
  return mode === "third-rear" ? out.negate() : out;
}

export function computeCameraPose(
  mode: CameraMode,
  eyeX: number,
  eyeY: number,
  eyeZ: number,
  yaw: number,
  pitch: number,
  distance: number,
  scratch: THREE.Vector3
): CameraPose {
  if (mode === "first") return { posX: eyeX, posY: eyeY, posZ: eyeZ, yaw, pitch };

  const dir = cameraOffsetDirection(mode, yaw, pitch, scratch);
  const posX = eyeX + dir.x * distance;
  const posY = eyeY + dir.y * distance;
  const posZ = eyeZ + dir.z * distance;

  // Rear: over-the-shoulder, looking the same way as the player.
  if (mode === "third-rear") return { posX, posY, posZ, yaw, pitch };
  // Front: the camera faces back at the player, so the heading flips and the
  // tilt inverts (player looks up -> the camera sits up-forward looking down).
  return { posX, posY, posZ, yaw: yaw + Math.PI, pitch: -pitch };
}
