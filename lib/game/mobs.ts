import type { MobKind } from "@/lib/game/types";
import { createMobModel } from "@/lib/game/mobModel";
import { BOSS_HP, HOSTILE_MOB_HP } from "@/lib/game/config";

export type MobTemplate = {
  speed: number;
  hp: number;
  detectRange: number;
  attackDamage: number;
  attackCooldown: number;
  /** Fires arrows and kites instead of meleeing (skeletons, boss). */
  ranged?: boolean;
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
  cow: {
    speed: 0.9,
    hp: 10,
    detectRange: 0,
    attackDamage: 0,
    attackCooldown: 0,
    // White hide with brown patches and a pink snout — a stocky body like the sheep's.
    modelArgs: [0xf3efe6, 0x6f4a2f, 0x4f3320, 0x111111, 0xd98c8c, [1.25, 0.9, 1.7], [0.6, 0.55, 0.58]]
  },
  pig: {
    speed: 1.0,
    hp: 8,
    detectRange: 0,
    attackDamage: 0,
    attackCooldown: 0,
    // Pink body and a darker pink snout; small and low to the ground.
    modelArgs: [0xe79a9a, 0xd98484, 0xc06a6a, 0x111111, 0xb45656, [0.95, 0.62, 1.25], [0.5, 0.42, 0.46]]
  },
  zombie: {
    speed: 1.05,
    hp: HOSTILE_MOB_HP,
    detectRange: 11,
    attackDamage: 3,
    attackCooldown: 1.35,
    modelArgs: [0x669e57, 0x4e7e45, 0x41663a, 0xff3333, 0x264a2f, [0.78, 1.1, 0.52], [0.52, 0.52, 0.52]]
  },
  skeleton: {
    speed: 1.08,
    hp: HOSTILE_MOB_HP,
    detectRange: 12,
    attackDamage: 3,
    attackCooldown: 1.8,
    ranged: true,
    modelArgs: [0xe4e4e2, 0xcfcfcb, 0xb4b4b1, 0xff3333, 0x8f8f8f, [0.75, 1.08, 0.48], [0.48, 0.48, 0.48]]
  },
  spider: {
    speed: 1.2,
    hp: HOSTILE_MOB_HP,
    detectRange: 10,
    attackDamage: 2,
    attackCooldown: 1.1,
    modelArgs: [0x2e2e2e, 0x1f1f1f, 0x161616, 0xff3333, 0x4a0f0f, [1.15, 0.52, 1.15], [0.5, 0.42, 0.5]]
  },
  creeper: {
    speed: 1.0,
    hp: HOSTILE_MOB_HP,
    detectRange: 12,
    // Deals no melee damage — it detonates instead (see the creeper fuse in mobAI).
    attackDamage: 0,
    attackCooldown: 0,
    // Mottled green, taller than wide, with a dark face — the classic silhouette.
    modelArgs: [0x4f9a3a, 0x3f8030, 0x356b29, 0x1a1a1a, 0x2a5520, [0.7, 1.25, 0.7], [0.5, 0.5, 0.5]]
  },
  villager: {
    speed: 0.6,
    hp: 20,
    detectRange: 0,
    attackDamage: 0,
    attackCooldown: 0,
    // A robed humanoid: brown smock, tan head, big nose (the snout/detail). Passive
    // but does NOT flee — you can walk right up to trade (see mobAI's villager case).
    modelArgs: [0x6f5a44, 0xc9a986, 0x4a3b2c, 0x2a2a2a, 0xb98e6a, [0.7, 1.35, 0.55], [0.55, 0.6, 0.55]]
  },
  boss: {
    speed: 1.1,
    hp: BOSS_HP,
    detectRange: 28,
    attackDamage: 10,
    attackCooldown: 1.5,
    ranged: true,
    // A towering dark figure with red eyes — body height drives a tall hitbox.
    modelArgs: [0x3a1f4d, 0x2a1638, 0x1f1029, 0xff2a2a, 0x6a2fa0, [1.7, 2.6, 1.2], [1.0, 0.95, 0.95]]
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
