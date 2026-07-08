import type { MobFaction, MobKind } from "@/lib/game/types";
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
  /** What a ranged kind shoots; absent = an ordinary arrow (the scorcher's fireball). */
  projectileKind?: "fireball";
  /** Lives in water: swims in 3D via the aquatic branch in mobAI, suffocates on land. */
  aquatic?: boolean;
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
  wolf: {
    // Wild and passive (flees like other animals) until tamed; taming flips it to
    // an ally and raises hp/detectRange (see config PET_*). attackDamage drives its
    // bite once it fights for the player.
    speed: 1.3,
    hp: 8,
    detectRange: 0,
    attackDamage: 4,
    attackCooldown: 0.9,
    // Grey body, lighter head, dark legs, amber eyes; low and long like a dog.
    modelArgs: [0x9a9a9a, 0xb0b0b0, 0x6f6f6f, 0xffe08a, 0x7a7a7a, [0.85, 0.6, 1.25], [0.5, 0.5, 0.55]]
  },
  cat: {
    speed: 1.35,
    hp: 8,
    detectRange: 0,
    attackDamage: 3,
    attackCooldown: 1.0,
    // Orange tabby with green eyes; small and lithe.
    modelArgs: [0xd98a3a, 0xe0a050, 0xb06a28, 0x9bd84f, 0xc06a20, [0.55, 0.45, 0.95], [0.42, 0.4, 0.42]]
  },
  cod: {
    // A small schooling fish: passive, flees the player in 3D (see the aquatic
    // branch in mobAI). detectRange 0 like the land passives.
    speed: 1.1,
    hp: 3,
    detectRange: 0,
    attackDamage: 0,
    attackCooldown: 0,
    aquatic: true,
    // Grey-brown body, sandy belly fins, pale tail; flat and small.
    modelArgs: [0x8a8a72, 0xa0a088, 0x6f6f5c, 0x101010, 0xb8b8a4, [0.32, 0.3, 0.7], [0.3, 0.34, 0.38], "fish"]
  },
  salmon: {
    speed: 1.25,
    hp: 4,
    detectRange: 0,
    attackDamage: 0,
    attackCooldown: 0,
    aquatic: true,
    // Red-pink body with darker back fins; longer than the cod.
    modelArgs: [0xb35a4a, 0xc06a56, 0x7a3a30, 0x101010, 0x8f4438, [0.38, 0.34, 0.92], [0.32, 0.4, 0.44], "fish"]
  },
  drowned: {
    // The first hostile of the deep: a sunken zombie that swims in 3D and
    // pursues players through water (the hostile branch of tickAquaticMob).
    // Strictly water-bound — the aquatic destination gate keeps it submerged,
    // and beaching suffocates it like a fish.
    speed: 1.15,
    hp: HOSTILE_MOB_HP,
    detectRange: 10,
    attackDamage: 3,
    attackCooldown: 1.4,
    aquatic: true,
    // The zombie silhouette gone teal from the deep, with pale cyan eyes.
    modelArgs: [0x3f8a7a, 0x2f6f63, 0x27584f, 0x66ffd9, 0x1f4a42, [0.78, 1.1, 0.52], [0.52, 0.52, 0.52]]
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
  raider: {
    // A pillager that storms a village in waves (see systems/raid.ts). Hostile, so
    // it chases the player up close and hunts villagers otherwise (the faction
    // enmity table). Tougher than an ordinary hostile.
    speed: 1.1,
    hp: 120,
    detectRange: 16,
    attackDamage: 5,
    attackCooldown: 1.2,
    // A drab grey-green brute with red eyes and a dark tunic.
    modelArgs: [0x55603f, 0x6b6b5a, 0x3a3a30, 0xff3333, 0x2a2a22, [0.82, 1.18, 0.55], [0.54, 0.54, 0.54]]
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
  },
  imp: {
    // The nether's melee brute: faster and harder-hitting than a zombie, and
    // half again as tough — the price of mining next to perpetual spawns.
    speed: 1.25,
    hp: 150,
    detectRange: 12,
    attackDamage: 5,
    attackCooldown: 1.1,
    // A stocky crimson figure with ember eyes and charcoal legs.
    modelArgs: [0x8a3428, 0x9c4030, 0x3a201a, 0xffb03a, 0x571f18, [0.85, 1.05, 0.6], [0.55, 0.5, 0.55]]
  },
  scorcher: {
    // The nether's ranged threat: hovers (a legless "fish" silhouette floated
    // above the ground — see mobHalfHeight) and lobs fireballs, kiting like a
    // skeleton on the ordinary land-AI path (NOT aquatic).
    speed: 1.0,
    hp: HOSTILE_MOB_HP,
    detectRange: 14,
    attackDamage: 4,
    attackCooldown: 2.2,
    ranged: true,
    projectileKind: "fireball",
    // A smouldering golden core with white-hot eyes and a charcoal shell.
    modelArgs: [0xd98a2a, 0xf0b04a, 0x3a2a1a, 0xfff2c0, 0x8a4a14, [0.6, 0.6, 0.6], [0.46, 0.44, 0.46], "fish"]
  }
};

/**
 * The mob kinds that spawn hostile. Hostility is set per-mob at spawn time (see
 * spawnDirector.pushMob), not stored on MOB_TEMPLATES, so this set is the single
 * source of truth for "is this kind a monster" — used by the statistics /
 * advancements system to count hostile kills.
 */
export const HOSTILE_MOB_KINDS: ReadonlySet<MobKind> = new Set<MobKind>([
  "zombie",
  "skeleton",
  "spider",
  "creeper",
  "raider",
  "boss",
  "drowned",
  "imp",
  "scorcher"
]);

/**
 * The allegiance each kind spawns with (see MobFaction). The targeting axis, set
 * once at spawn (spawnDirector.pushMob); taming flips a wolf/cat to "ally". Wild
 * animals and villagers never fight; hostiles/raiders/allies are the "fighters".
 * Matches HOSTILE_MOB_KINDS for the monster kinds (which also spawn `hostile:true`).
 */
export const FACTION_BY_KIND: Record<MobKind, MobFaction> = {
  sheep: "wild",
  chicken: "wild",
  horse: "wild",
  cow: "wild",
  pig: "wild",
  wolf: "wild",
  cat: "wild",
  cod: "wild",
  salmon: "wild",
  drowned: "hostile",
  villager: "villager",
  zombie: "hostile",
  skeleton: "hostile",
  spider: "hostile",
  creeper: "hostile",
  raider: "raider",
  boss: "hostile",
  imp: "hostile",
  scorcher: "hostile"
};

/**
 * Body-center height above the ground for a mob kind. Mirrors the geometry
 * math in createMobModel so the headless simulation needs no Three.js meshes.
 */
export function mobHalfHeight(kind: MobKind): number {
  const template = MOB_TEMPLATES[kind];
  const bodyHeight = template.modelArgs[5][1];
  // The scorcher's legless body floats well off the ground — a hoverer, not a
  // walker — so its ground clamp holds it airborne.
  if (kind === "scorcher") return bodyHeight * 0.5 + 0.6;
  // Legless "fish"-variant models are centered on the body (createFishModel).
  if (template.modelArgs[7] === "fish") return bodyHeight * 0.5 + 0.05;
  const legHeight = Math.max(0.3, bodyHeight * 0.56);
  return Math.max(bodyHeight, legHeight) * 0.5 + 0.2;
}

/** Builds the Three.js model for a mob kind (renderer side). */
export function createMobModelForKind(kind: MobKind) {
  return createMobModel(...MOB_TEMPLATES[kind].modelArgs);
}
