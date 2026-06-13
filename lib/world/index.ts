// Public API of the voxel world domain. Consumers import from "@/lib/world".
export { BLOCK_COLORS, BiomeId, BlockId, HELD_BLOCK_COLORS, HELD_BLOCK_FALLBACK_COLOR, WORLD_SIZE_X, WORLD_SIZE_Y, WORLD_SIZE_Z } from "./blocks";
export { VoxelWorld } from "./voxelWorld";
export { DOOR_BLOCK_IDS, doorBlock, doorBounds, doorFacingFromYaw, doorState, isDoorBlock, type DoorFacing, type DoorState } from "./doors";
export { generateWorld } from "./generation";
export { buildGeometryLayersRegion, buildGeometryRegion, type GeometryLayers } from "./meshing";
export { createBlockAtlasTexture } from "./atlas";
export { collidesAt, hasSupportUnderPlayer, voxelRaycast, type RaycastResult } from "./queries";
