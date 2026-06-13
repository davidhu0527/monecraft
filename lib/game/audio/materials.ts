import { BlockId } from "@/lib/world";

/** Sound family of a block — drives break/place/footstep/mining-tick sounds. */
export type MaterialGroup = "stone" | "wood" | "grass" | "sand" | "glass" | "water";

export const MATERIAL_GROUPS: readonly MaterialGroup[] = ["stone", "wood", "grass", "sand", "glass", "water"];

// Exhaustive over BlockId so adding a block without a sound group is a type error.
const GROUP_BY_BLOCK: Record<BlockId, MaterialGroup> = {
  [BlockId.Air]: "grass", // never audible; mapped only for exhaustiveness
  [BlockId.Grass]: "grass",
  [BlockId.Dirt]: "grass",
  [BlockId.Stone]: "stone",
  [BlockId.Wood]: "wood",
  [BlockId.Leaves]: "grass",
  [BlockId.Bedrock]: "stone",
  [BlockId.Planks]: "wood",
  [BlockId.Cobblestone]: "stone",
  [BlockId.Sand]: "sand",
  [BlockId.Brick]: "stone",
  [BlockId.Glass]: "glass",
  [BlockId.SliverOre]: "stone",
  [BlockId.RubyOre]: "stone",
  [BlockId.GoldOre]: "stone",
  [BlockId.SapphireOre]: "stone",
  [BlockId.DiamondOre]: "stone",
  [BlockId.Water]: "water",
  [BlockId.Snow]: "sand",
  [BlockId.Cactus]: "grass",
  [BlockId.Bed]: "wood",
  [BlockId.Farmland]: "grass",
  [BlockId.WheatStage0]: "grass",
  [BlockId.WheatStage1]: "grass",
  [BlockId.WheatStage2]: "grass",
  [BlockId.WheatStage3]: "grass",
  [BlockId.Furnace]: "stone"
};

export function materialGroupFor(block: BlockId): MaterialGroup {
  return GROUP_BY_BLOCK[block] ?? "grass";
}
