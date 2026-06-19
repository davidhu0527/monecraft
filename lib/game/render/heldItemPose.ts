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
export const CAST_MS = 350;
export const REEL_MS = 250;

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
  /** Start of the most recent fishing cast; -Infinity for none. */
  castStartMs?: number;
  /** Start of the most recent reel-in; -Infinity for none. */
  reelStartMs?: number;
  /** True while a cast is active — holds the rod out over the water. */
  fishingActive?: boolean;
  /** True during the bite window — adds a small rod-tip twitch. */
  fishingBiting?: boolean;
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

  // Fishing: hold the rod out over the water, plus one-shot cast/reel arcs.
  if (input.fishingActive) {
    pose.posY += 0.1; // raise
    pose.posZ -= 0.1; // push forward over the water
    pose.rotX += 0.3; // tilt the tip up
    pose.rotZ += 0.05;
    if (input.fishingBiting) pose.rotX += Math.sin(input.timeMs * 0.05) * 0.04; // tip twitch on a bite
  }
  // Cast: a quick wind-up (tip back) for the first third, then a forward flick.
  const c = (input.timeMs - (input.castStartMs ?? -Infinity)) / CAST_MS;
  if (c >= 0 && c <= 1) {
    if (c < 0.35) {
      pose.rotX += Math.sin((c / 0.35) * (Math.PI / 2)) * 0.55;
    } else {
      const s = Math.sin(((c - 0.35) / 0.65) * Math.PI);
      pose.rotX -= s * 0.85;
      pose.posZ -= s * 0.12;
    }
  }
  // Reel: yank the tip up and draw the rod toward the body.
  const r = (input.timeMs - (input.reelStartMs ?? -Infinity)) / REEL_MS;
  if (r >= 0 && r <= 1) {
    const s = Math.sin(r * Math.PI);
    pose.rotX += s * 0.7;
    pose.posY += s * 0.12;
    pose.posZ += s * 0.08;
  }

  // Idle sway: barely-visible drift so the item never looks frozen.
  pose.posY += Math.sin(input.timeMs * 0.0016) * 0.006;
  pose.rotZ += Math.sin(input.timeMs * 0.0013) * 0.015;

  // Walk bob: figure-eight-ish sway scaled by horizontal speed.
  const p = input.timeMs * 0.012;
  pose.posX += Math.sin(p) * 0.02 * input.moveFactor;
  pose.posY -= Math.abs(Math.sin(p)) * 0.025 * input.moveFactor;

  return pose;
}
