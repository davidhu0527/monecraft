/** Horizontal blocks walked between steps; cadence tracks speed automatically. */
export const STEP_DISTANCE = 2.0;

export type FootstepScheduler = {
  /** Feed per-frame movement; returns true when a step sound is due. */
  tick(onGround: boolean, dx: number, dz: number): boolean;
};

export function createFootstepScheduler(): FootstepScheduler {
  let traveled = 0;
  return {
    tick(onGround, dx, dz) {
      if (!onGround) {
        // Jumps and falls reset the stride; the landing thud covers touchdown.
        traveled = 0;
        return false;
      }
      traveled += Math.hypot(dx, dz);
      if (traveled < STEP_DISTANCE) return false;
      // Carry the overshoot so cadence stays true at low frame rates.
      traveled -= STEP_DISTANCE;
      return true;
    }
  };
}
