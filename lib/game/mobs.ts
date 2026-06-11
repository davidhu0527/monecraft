import type { MobKind } from "@/lib/game/types";
import { createMobModel } from "@/lib/game/mobModel";

export type MobTemplate = {
  speed: number;
  hp: number;
  detectRange: number;
  attackDamage: number;
  attackCooldown: number;
  modelArgs: Parameters<typeof createMobModel>;
};

export const MOB_TEMPLATES: Record<MobKind, MobTemplate> = {
  sheep: {
    speed: 0.9,
    hp: 10,
    detectRange: 0,
    attackDamage: 0,
    attackCooldown: 0,
    modelArgs: [0xf5f5f5, 0xd8d8d8, 0xb7b7b7, 0x111111, 0xcecece, [1.05, 0.75, 1.35], [0.58, 0.48, 0.5]]
  },
  chicken: {
    speed: 1.2,
    hp: 7,
    detectRange: 0,
    attackDamage: 0,
    attackCooldown: 0,
    modelArgs: [0xffefba, 0xffe095, 0xe0b970, 0x111111, 0xd28730, [0.52, 0.44, 0.62], [0.3, 0.28, 0.28]]
  },
  horse: {
    speed: 1.4,
    hp: 14,
    detectRange: 0,
    attackDamage: 0,
    attackCooldown: 0,
    modelArgs: [0x8a5d36, 0x74472a, 0x5d3a22, 0x101010, 0x3e2413, [1.45, 1.1, 2.2], [0.56, 0.6, 0.62]]
  },
  zombie: {
    speed: 1.05,
    hp: 10,
    detectRange: 11,
    attackDamage: 3,
    attackCooldown: 1.35,
    modelArgs: [0x669e57, 0x4e7e45, 0x41663a, 0xff3333, 0x264a2f, [0.78, 1.1, 0.52], [0.52, 0.52, 0.52]]
  },
  skeleton: {
    speed: 1.08,
    hp: 9,
    detectRange: 12,
    attackDamage: 3,
    attackCooldown: 1.4,
    modelArgs: [0xe4e4e2, 0xcfcfcb, 0xb4b4b1, 0xff3333, 0x8f8f8f, [0.75, 1.08, 0.48], [0.48, 0.48, 0.48]]
  },
  spider: {
    speed: 1.2,
    hp: 8,
    detectRange: 10,
    attackDamage: 2,
    attackCooldown: 1.1,
    modelArgs: [0x2e2e2e, 0x1f1f1f, 0x161616, 0xff3333, 0x4a0f0f, [1.15, 0.52, 1.15], [0.5, 0.42, 0.5]]
  }
};

/**
 * Body-center height above the ground for a mob kind. Mirrors the geometry
 * math in createMobModel so the headless simulation needs no Three.js meshes.
 */
export function mobHalfHeight(kind: MobKind): number {
  const bodyHeight = MOB_TEMPLATES[kind].modelArgs[5][1];
  const legHeight = Math.max(0.3, bodyHeight * 0.56);
  return Math.max(bodyHeight, legHeight) * 0.5 + 0.2;
}

/** Builds the Three.js model for a mob kind (renderer side). */
export function createMobModelForKind(kind: MobKind) {
  return createMobModel(...MOB_TEMPLATES[kind].modelArgs);
}
