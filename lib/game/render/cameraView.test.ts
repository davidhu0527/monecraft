import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { cameraOffsetDirection, computeCameraPose } from "@/lib/game/render/cameraView";

const scratch = new THREE.Vector3();

describe("cameraOffsetDirection", () => {
  test("rear points opposite the look direction, front along it", () => {
    // yaw 0, pitch 0: the player looks along -Z.
    const rear = cameraOffsetDirection("third-rear", 0, 0, scratch);
    expect(rear.x).toBeCloseTo(0);
    expect(rear.y).toBeCloseTo(0);
    expect(rear.z).toBeCloseTo(1);
    const front = cameraOffsetDirection("third-front", 0, 0, scratch);
    expect(front.x).toBeCloseTo(0);
    expect(front.y).toBeCloseTo(0);
    expect(front.z).toBeCloseTo(-1);
  });

  test("looking up drops the rear camera below the look axis", () => {
    const dir = cameraOffsetDirection("third-rear", 0, Math.PI / 4, scratch);
    expect(dir.y).toBeLessThan(0);
    expect(dir.z).toBeGreaterThan(0);
  });
});

describe("computeCameraPose", () => {
  test("first person is the eye itself with passthrough rotation", () => {
    const pose = computeCameraPose("first", 1, 2, 3, 0.5, -0.3, 99, scratch);
    expect([pose.posX, pose.posY, pose.posZ]).toEqual([1, 2, 3]);
    expect(pose.yaw).toBe(0.5);
    expect(pose.pitch).toBe(-0.3);
  });

  test("rear sits behind the eye and keeps the player's view direction", () => {
    const pose = computeCameraPose("third-rear", 0, 10, 0, 0, 0, 4, scratch);
    expect(pose.posZ).toBeCloseTo(4);
    expect(pose.posY).toBeCloseTo(10);
    expect(pose.yaw).toBe(0);
    expect(pose.pitch).toBe(0);
  });

  test("front sits ahead, flips the heading, and inverts the tilt", () => {
    const pose = computeCameraPose("third-front", 0, 10, 0, 0.5, 0.4, 4, scratch);
    const lookX = -Math.cos(0.4) * Math.sin(0.5) * 4;
    const lookZ = -Math.cos(0.4) * Math.cos(0.5) * 4;
    expect(pose.posX).toBeCloseTo(lookX);
    expect(pose.posY).toBeCloseTo(10 + Math.sin(0.4) * 4);
    expect(pose.posZ).toBeCloseTo(lookZ);
    expect(pose.yaw).toBeCloseTo(0.5 + Math.PI);
    expect(pose.pitch).toBeCloseTo(-0.4);
  });

  test("a clamped distance pulls the camera proportionally closer", () => {
    const far = computeCameraPose("third-rear", 0, 10, 0, 0, 0, 4, scratch);
    const near = computeCameraPose("third-rear", 0, 10, 0, 0, 0, 1.5, scratch);
    expect(near.posZ).toBeCloseTo((far.posZ * 1.5) / 4);
  });
});
