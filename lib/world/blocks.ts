export const WORLD_SIZE_X = 512;
export const WORLD_SIZE_Y = 150;
export const WORLD_SIZE_Z = 512;

export const enum BlockId {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Wood = 4,
  Leaves = 5,
  Bedrock = 6,
  Planks = 7,
  Cobblestone = 8,
  Sand = 9,
  Brick = 10,
  Glass = 11,
  SliverOre = 12,
  RubyOre = 13,
  GoldOre = 14,
  SapphireOre = 15,
  DiamondOre = 16,
  Water = 17,
  Snow = 18,
  Cactus = 19,
  Bed = 20,
  Farmland = 21,
  // Wheat growth stages — consecutive ids so a crop advances by +1 (see randomTicks.ts).
  WheatStage0 = 22,
  WheatStage1 = 23,
  WheatStage2 = 24,
  WheatStage3 = 25,
  Furnace = 26,
  Chest = 27,
  // Dungeon blocks (worldgen-only flavor + the spawner block-entity marker).
  MossyCobblestone = 28,
  Spawner = 29,
  // Wood doors — 16 contiguous ids (4 facings × open/closed × lower/upper).
  // doors.ts derives state by offset from DoorNorthLower, so keep them in order.
  DoorNorthLower = 30,
  DoorNorthUpper = 31,
  DoorEastLower = 32,
  DoorEastUpper = 33,
  DoorSouthLower = 34,
  DoorSouthUpper = 35,
  DoorWestLower = 36,
  DoorWestUpper = 37,
  DoorNorthOpenLower = 38,
  DoorNorthOpenUpper = 39,
  DoorEastOpenLower = 40,
  DoorEastOpenUpper = 41,
  DoorSouthOpenLower = 42,
  DoorSouthOpenUpper = 43,
  DoorWestOpenLower = 44,
  DoorWestOpenUpper = 45,
  // A placeable light source: a solid block that emits block light (see lighting.ts).
  Torch = 46,
  // A worldgen-only hazard: a solid, unmineable block that emits max block light
  // and burns the player on contact (see lighting.ts, playerStats.ts).
  Lava = 47,
  // A shallow, common ore: mineable with a wood pickaxe, drops coal (furnace fuel).
  CoalOre = 48
}

export enum BiomeId {
  Plains = 0,
  Desert = 1,
  Ocean = 2,
  Forest = 3,
  Mountains = 4
}

// Hex palette tinting the first-person held-item block model. Deliberately a
// different (brighter) palette than BLOCK_COLORS below, which feeds the atlas.
export const HELD_BLOCK_COLORS: Partial<Record<BlockId, number>> = {
  [BlockId.Grass]: 0x5ea74a,
  [BlockId.Dirt]: 0x7f5d3d,
  [BlockId.Stone]: 0x8f9296,
  [BlockId.Wood]: 0x8d653d,
  [BlockId.Planks]: 0xbe965d,
  [BlockId.Cobblestone]: 0x787c82,
  [BlockId.Sand]: 0xd8ca84,
  [BlockId.Brick]: 0xb65448,
  [BlockId.Glass]: 0xaed4dc,
  [BlockId.CoalOre]: 0x4a4a52,
  [BlockId.SliverOre]: 0x9fa3aa,
  [BlockId.RubyOre]: 0xa26464,
  [BlockId.GoldOre]: 0xd9b33b,
  [BlockId.SapphireOre]: 0x3f92d6,
  [BlockId.DiamondOre]: 0x85e9f4,
  [BlockId.Snow]: 0xf2f5fa,
  [BlockId.Cactus]: 0x6aa850,
  [BlockId.Bed]: 0xc0392b,
  [BlockId.Furnace]: 0x63666a,
  [BlockId.Chest]: 0x9c6a3c,
  [BlockId.MossyCobblestone]: 0x6a7a55,
  [BlockId.DoorNorthLower]: 0xa8753f,
  [BlockId.Torch]: 0xffab40
};

export const HELD_BLOCK_FALLBACK_COLOR = 0xbababa;

// Float RGB palette used to paint the procedural texture atlas (see atlas.ts).
// Not to be confused with the hex palette tinting the held-item model.
export const BLOCK_COLORS: Record<number, [number, number, number]> = {
  [BlockId.Grass]: [0.35, 0.68, 0.22],
  [BlockId.Dirt]: [0.46, 0.33, 0.2],
  [BlockId.Stone]: [0.54, 0.56, 0.58],
  [BlockId.Wood]: [0.51, 0.37, 0.19],
  [BlockId.Leaves]: [0.22, 0.5, 0.2],
  [BlockId.Bedrock]: [0.14, 0.14, 0.14],
  [BlockId.Planks]: [0.76, 0.61, 0.38],
  [BlockId.Cobblestone]: [0.42, 0.43, 0.45],
  [BlockId.Sand]: [0.86, 0.8, 0.5],
  [BlockId.Brick]: [0.68, 0.28, 0.2],
  [BlockId.Glass]: [0.73, 0.9, 0.95],
  // Ores share the stone-gray base; their sparkle is painted in the atlas (atlas.ts).
  [BlockId.CoalOre]: [0.54, 0.56, 0.58],
  [BlockId.SliverOre]: [0.54, 0.56, 0.58],
  [BlockId.RubyOre]: [0.54, 0.56, 0.58],
  [BlockId.GoldOre]: [0.54, 0.56, 0.58],
  [BlockId.SapphireOre]: [0.54, 0.56, 0.58],
  [BlockId.DiamondOre]: [0.54, 0.56, 0.58],
  [BlockId.Water]: [0.26, 0.45, 0.78],
  [BlockId.Snow]: [0.92, 0.94, 0.97],
  [BlockId.Cactus]: [0.33, 0.55, 0.27],
  [BlockId.Bed]: [0.72, 0.2, 0.22],
  [BlockId.Farmland]: [0.36, 0.25, 0.16],
  // Wheat ripens green -> gold across the four stages.
  [BlockId.WheatStage0]: [0.4, 0.62, 0.25],
  [BlockId.WheatStage1]: [0.55, 0.66, 0.27],
  [BlockId.WheatStage2]: [0.7, 0.69, 0.29],
  [BlockId.WheatStage3]: [0.82, 0.72, 0.3],
  [BlockId.Furnace]: [0.38, 0.39, 0.41],
  [BlockId.Chest]: [0.58, 0.41, 0.22],
  // Cobble tinted with patches of moss; the spawner is a near-black iron cage.
  [BlockId.MossyCobblestone]: [0.34, 0.42, 0.3],
  [BlockId.Spawner]: [0.18, 0.19, 0.22],
  [BlockId.DoorNorthLower]: [0.62, 0.4, 0.2],
  [BlockId.DoorNorthUpper]: [0.62, 0.4, 0.2],
  [BlockId.DoorEastLower]: [0.62, 0.4, 0.2],
  [BlockId.DoorEastUpper]: [0.62, 0.4, 0.2],
  [BlockId.DoorSouthLower]: [0.62, 0.4, 0.2],
  [BlockId.DoorSouthUpper]: [0.62, 0.4, 0.2],
  [BlockId.DoorWestLower]: [0.62, 0.4, 0.2],
  [BlockId.DoorWestUpper]: [0.62, 0.4, 0.2],
  [BlockId.DoorNorthOpenLower]: [0.62, 0.4, 0.2],
  [BlockId.DoorNorthOpenUpper]: [0.62, 0.4, 0.2],
  [BlockId.DoorEastOpenLower]: [0.62, 0.4, 0.2],
  [BlockId.DoorEastOpenUpper]: [0.62, 0.4, 0.2],
  [BlockId.DoorSouthOpenLower]: [0.62, 0.4, 0.2],
  [BlockId.DoorSouthOpenUpper]: [0.62, 0.4, 0.2],
  [BlockId.DoorWestOpenLower]: [0.62, 0.4, 0.2],
  [BlockId.DoorWestOpenUpper]: [0.62, 0.4, 0.2],
  [BlockId.Torch]: [0.9, 0.6, 0.25],
  [BlockId.Lava]: [0.85, 0.3, 0.08]
};
