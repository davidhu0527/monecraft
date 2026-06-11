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
  Water = 17
}

export enum BiomeId {
  Plains = 0,
  Desert = 1,
  Ocean = 2,
  Forest = 3,
  Mountains = 4
}

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
  [BlockId.SliverOre]: [0.54, 0.56, 0.58],
  [BlockId.RubyOre]: [0.54, 0.56, 0.58],
  [BlockId.GoldOre]: [0.54, 0.56, 0.58],
  [BlockId.SapphireOre]: [0.54, 0.56, 0.58],
  [BlockId.DiamondOre]: [0.54, 0.56, 0.58],
  [BlockId.Water]: [0.26, 0.45, 0.78]
};
