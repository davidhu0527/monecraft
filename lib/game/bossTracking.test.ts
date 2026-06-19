import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { bossTracking } from "./bossTracking";
import type { MobState, PlayerState } from "./engine/state";

function player(yaw = 0): PlayerState {
  return {
    position: new THREE.Vector3(10, 20, 10),
    velocity: new THREE.Vector3(),
    yaw,
    pitch: 0,
    onGround: true
  };
}

function boss(x: number, z: number): MobState {
  return {
    id: 1,
    kind: "boss",
    hostile: true,
    hp: 1000,
    position: new THREE.Vector3(x, 20, z),
    direction: new THREE.Vector3(),
    yaw: 0,
    turnTimer: 0,
    speed: 0,
    moveSpeed: 0,
    detectRange: 0,
    attackDamage: 0,
    attackCooldown: 0,
    attackTimer: 0,
    halfHeight: 2,
    bobSeed: 0,
    fedTimer: 0,
    ageTimer: 0
  };
}

describe("bossTracking", () => {
  test("maps world positions to player-relative compass bearings", () => {
    expect(bossTracking(player(), boss(10, 0)).bearingDegrees).toBe(0);
    expect(bossTracking(player(), boss(20, 10)).bearingDegrees).toBe(90);
    expect(bossTracking(player(), boss(10, 20)).bearingDegrees).toBe(180);
    expect(bossTracking(player(), boss(0, 10)).bearingDegrees).toBe(270);
  });

  test("follows player yaw and reports rounded horizontal block distance", () => {
    const tracking = bossTracking(player(-Math.PI / 2), boss(13, 14));
    expect(tracking.bearingDegrees).toBe(53);
    expect(tracking.distanceBlocks).toBe(5);
  });
});
