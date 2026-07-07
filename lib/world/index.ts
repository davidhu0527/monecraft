// Public API of the voxel world domain. Consumers import from "@/lib/world".
export { BLOCK_COLORS, BiomeId, BlockId, HELD_BLOCK_COLORS, HELD_BLOCK_FALLBACK_COLOR, WORLD_SIZE_X, WORLD_SIZE_Y, WORLD_SIZE_Z } from "./blocks";
export { VoxelWorld } from "./voxelWorld";
export { DOOR_BLOCK_IDS, doorBlock, doorBounds, doorFacingFromYaw, doorState, isDoorBlock, type DoorFacing, type DoorState } from "./doors";
export { isDetectorRail, isPoweredRail, isRailBlock, railAxis, railBounds, type RailAxis } from "./rails";
export {
  isPartialBlock,
  isSlabBlock,
  isStairBlock,
  orientStair,
  shapeBoxes,
  stairBlock,
  stairFacing,
  type ShapeBox,
  type SlabMaterial,
  type StairFacing
} from "./slabs";
export {
  isLever,
  isPressurePlate,
  isRedstoneBlock,
  isRedstoneButton,
  isRedstoneLamp,
  isRedstoneOn,
  isRedstoneOverlay,
  isRedstoneTorch,
  isRedstoneWire,
  redstoneBounds,
  redstoneOff,
  redstoneOn,
  type RedstoneBounds
} from "./redstone";
export {
  generateWorld,
  collectDungeonSites,
  collectShipwreckSites,
  collectTreasureSites,
  collectVillageSites,
  terrainConfigFor,
  type DungeonSites,
  type ShipwreckSites,
  type TerrainConfig,
  type TreasureSites,
  type VillageSites
} from "./generation";
export { generateNetherWorld } from "./netherGeneration";
export { isWorldType, WORLD_TYPE_IDS, type WorldType } from "./worldTypes";
export { buildGeometryLayersRegion, buildGeometryRegion, type GeometryLayers } from "./meshing";
export { applyEdit, blockLightAt, computeFullLight, emission, isLightBlocker, MAX_LIGHT, opacity, skyLightAt } from "./lighting";
export { createBlockAtlasTexture } from "./atlas";
export { collidesAt, hasSupportUnderPlayer, voxelRaycast, waterSurfaceRaycast, type RaycastResult } from "./queries";
