// Public API of the voxel world domain. Consumers import from "@/lib/world".
export { BLOCK_COLORS, BiomeId, BlockId, HELD_BLOCK_COLORS, HELD_BLOCK_FALLBACK_COLOR, WORLD_SIZE_X, WORLD_SIZE_Y, WORLD_SIZE_Z } from "./blocks";
export { VoxelWorld } from "./voxelWorld";
export { generateWorld, collectDungeonSites, type DungeonSites } from "./generation";
export { buildGeometryRegion } from "./meshing";
export { createBlockAtlasTexture } from "./atlas";
export { collidesAt, hasSupportUnderPlayer, voxelRaycast, type RaycastResult } from "./queries";
