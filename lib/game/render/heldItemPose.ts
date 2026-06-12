/**
 * Pure pose math for the first-person held item. No Three.js — heldItem.ts
 * applies the result to the holder group each frame. All motion is a function
 * of wall-clock timeMs plus a few timestamps, so poses are deterministic and
 * testable headlessly.
 */

export type HeldPose = {
  posX: number;
  posY: number;
  posZ: number;
  rotX: number;
  rotY: number;
  rotZ: number;
};

/** Rest pose in camera space — lower-right of the view, matching the old static placement. */
export const BASE_POSE: HeldPose = { posX: 0.34, posY: -0.28, posZ: -0.55, rotX: -0.35, rotY: -0.55, rotZ: -0.12 };

export const SWING_MS = 260;
export const EQUIP_MS = 220;

export type HeldPoseInput = {
  timeMs: number;
  /** Start of the most recent swing; -Infinity when the item has never swung. */
  swingStartMs: number;
  /** True while mining — the swing arc loops instead of stopping after one cycle. */
  continuousSwing: boolean;
  /** Start of the most recent equip (item switch); -Infinity to skip the dip. */
  equipStartMs: number;
  /** 0..1 horizontal speed relative to walk speed — scales the walk bob. */
  moveFactor: number;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function computeHeldPose(input: HeldPoseInput): HeldPose {
  const pose = { ...BASE_POSE };

  // Swing: a sin(t*PI) chop arc — out and down, with a slight inward twist.
  let t = (input.timeMs - input.swingStartMs) / SWING_MS;
  if (input.continuousSwing && t >= 0) t %= 1;
  if (t >= 0 && t <= 1) {
    const s = Math.sin(t * Math.PI);
    pose.rotX -= s * 1.15;
    pose.rotY += s * 0.35;
    pose.posZ -= s * 0.16;
    pose.posY -= s * 0.1;
  }

  // Equip: the item rises into frame from below after a slot switch.
  const e = clamp01((input.timeMs - input.equipStartMs) / EQUIP_MS);
  const q = 1 - (1 - e) * (1 - e);
  pose.posY -= (1 - q) * 0.4;
  pose.rotX -= (1 - q) * 0.5;

  // Idle sway: barely-visible drift so the item never looks frozen.
  pose.posY += Math.sin(input.timeMs * 0.0016) * 0.006;
  pose.rotZ += Math.sin(input.timeMs * 0.0013) * 0.015;

  // Walk bob: figure-eight-ish sway scaled by horizontal speed.
  const p = input.timeMs * 0.012;
  pose.posX += Math.sin(p) * 0.02 * input.moveFactor;
  pose.posY -= Math.abs(Math.sin(p)) * 0.025 * input.moveFactor;

  return pose;
}
