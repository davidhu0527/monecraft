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
  [BlockId.Furnace]: "stone",
  [BlockId.Chest]: "wood",
  [BlockId.MossyCobblestone]: "stone",
  [BlockId.Spawner]: "stone",
  [BlockId.DoorNorthLower]: "wood",
  [BlockId.DoorNorthUpper]: "wood",
  [BlockId.DoorEastLower]: "wood",
  [BlockId.DoorEastUpper]: "wood",
  [BlockId.DoorSouthLower]: "wood",
  [BlockId.DoorSouthUpper]: "wood",
  [BlockId.DoorWestLower]: "wood",
  [BlockId.DoorWestUpper]: "wood",
  [BlockId.DoorNorthOpenLower]: "wood",
  [BlockId.DoorNorthOpenUpper]: "wood",
  [BlockId.DoorEastOpenLower]: "wood",
  [BlockId.DoorEastOpenUpper]: "wood",
  [BlockId.DoorSouthOpenLower]: "wood",
  [BlockId.DoorSouthOpenUpper]: "wood",
  [BlockId.DoorWestOpenLower]: "wood",
  [BlockId.DoorWestOpenUpper]: "wood",
  [BlockId.Torch]: "wood"
};

export function materialGroupFor(block: BlockId): MaterialGroup {
  return GROUP_BY_BLOCK[block] ?? "grass";
}
