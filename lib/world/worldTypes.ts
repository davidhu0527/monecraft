/**
 * World types — generation presets the player picks at world creation. Each is
 * a terrain-config variant over the same biome map; `"default"` is the original
 * generator (byte-identical to before this feature). The chosen type is part of
 * the save contract for non-default worlds: the engine must regenerate with the
 * same type the block-diffs were recorded against.
 *
 * This module is intentionally free of the generation `GEN` constants so the
 * game/UI layer can import the type without pulling in the worldgen module; the
 * actual per-type terrain config lives in `terrainConfigFor` (generation.ts).
 */
export type WorldType = "default" | "flat" | "amplified" | "islands";

export const WORLD_TYPE_IDS: readonly WorldType[] = ["default", "flat", "amplified", "islands"];

/** Coerces a stored/UI value to a WorldType; unknown values are not world types. */
export function isWorldType(value: unknown): value is WorldType {
  return typeof value === "string" && (WORLD_TYPE_IDS as readonly string[]).includes(value);
}
