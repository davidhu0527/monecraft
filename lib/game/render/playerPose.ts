/**
 * Pure pose math for the third-person player body. No Three.js —
 * playerVisuals.ts applies the rotation.x values to the limb pivots each
 * frame. Deterministic in timeMs, like heldItemPose.ts.
 */

export const PLAYER_SWING_MS = 260;

export type PlayerPoseInput = {
  timeMs: number;
  /** 0..1 horizontal speed relative to walk speed — scales the walk gait. */
  moveFactor: number;
  /** True while mining — the arm chop loops instead of stopping after one cycle. */
  miningActive: boolean;
  /** Start of the most recent swing; -Infinity when the player has never swung. */
  swingStartMs: number;
};

/** rotation.x per limb pivot; negative swings the limb forward (toward -Z). */
export type PlayerPose = {
  leftArmX: number;
  rightArmX: number;
  leftLegX: number;
  rightLegX: number;
};

export function computePlayerPose(input: PlayerPoseInput): PlayerPose {
  // Walk gait: legs counter-phased, each arm counter-phased to its same-side
  // leg, all scaled by horizontal speed so the body idles when standing.
  const gait = Math.sin(input.timeMs * 0.012) * 0.8 * input.moveFactor;
  const pose = {
    leftLegX: gait,
    rightLegX: -gait,
    leftArmX: -gait * 0.8,
    rightArmX: gait * 0.8
  };

  // Attack/mining chop: the right arm raises forward and falls back, matching
  // the first-person held-item swing timing.
  let t = (input.timeMs - input.swingStartMs) / PLAYER_SWING_MS;
  if (input.miningActive && t >= 0) t %= 1;
  if (t >= 0 && t <= 1) pose.rightArmX -= Math.sin(t * Math.PI) * 1.9;

  return pose;
}
