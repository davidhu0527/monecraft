import type { MobState, PlayerState } from "./engine/state";

export type BossTracking = {
  /** Clockwise screen-space bearing: 0 ahead, 90 right, 180 behind, 270 left. */
  bearingDegrees: number;
  /** Horizontal distance in world blocks. */
  distanceBlocks: number;
};

/** Derives a compass-style bearing and ground distance from the player to any world point. */
export function trackTarget(player: PlayerState, x: number, z: number): BossTracking {
  const dx = x - player.position.x;
  const dz = z - player.position.z;
  const forward = -dx * Math.sin(player.yaw) - dz * Math.cos(player.yaw);
  const right = dx * Math.cos(player.yaw) - dz * Math.sin(player.yaw);
  const bearing = Math.atan2(right, forward) * (180 / Math.PI);

  return {
    bearingDegrees: Math.round((bearing + 360) % 360),
    distanceBlocks: Math.round(Math.hypot(dx, dz))
  };
}

/** Bearing/distance from the player to the boss (see trackTarget — the treasure compass shares it). */
export function bossTracking(player: PlayerState, boss: MobState): BossTracking {
  return trackTarget(player, boss.position.x, boss.position.z);
}
