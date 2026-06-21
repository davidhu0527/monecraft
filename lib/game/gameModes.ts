/**
 * Game modes — the four Minecraft-style ways to play, a single per-player axis
 * the player picks at world creation and can switch in the pause menu:
 *
 * - **survival**  — the original game: gather, craft, fight, take damage.
 * - **creative**  — fly, build with unlimited blocks, invulnerable, instant break.
 * - **adventure** — survival, but terrain can't be broken or placed.
 * - **spectator** — fly through everything, unseen and unable to interact.
 *
 * Difficulty is a separate, orthogonal axis — it lives in lib/game/difficulties.ts
 * (Peaceful/Easy/Normal/Hard). The Hardcore flag remains deferred to a later change.
 *
 * Systems gate on the **predicates** below (intent: "can this mode edit
 * blocks?") rather than comparing the raw id, so a new mode only has to answer
 * the predicates and every call site keeps working.
 */
export type GameMode = "survival" | "creative" | "adventure" | "spectator";

export const GAME_MODE_IDS: readonly GameMode[] = ["survival", "creative", "adventure", "spectator"];

/** Coerces a stored/UI value to a GameMode; unknown values are not game modes. */
export function isGameMode(value: unknown): value is GameMode {
  return typeof value === "string" && (GAME_MODE_IDS as readonly string[]).includes(value);
}

/** UI metadata for the game-mode picker (creation form + pause menu). */
export const GAME_MODE_PRESETS: ReadonlyArray<{ id: GameMode; label: string; blurb: string }> = [
  { id: "survival", label: "Survival", blurb: "Gather, craft, fight, survive" },
  { id: "creative", label: "Creative", blurb: "Fly and build with unlimited blocks" },
  { id: "adventure", label: "Adventure", blurb: "Explore and fight — no terrain editing" },
  { id: "spectator", label: "Spectator", blurb: "Fly through the world, unseen" }
];

// --- Mode predicates: gate systems on intent, never on the raw id. ---

/** Survival/Adventure take environmental + combat damage; Creative/Spectator are invulnerable. */
export function takesDamage(mode: GameMode): boolean {
  return mode === "survival" || mode === "adventure";
}

/** Survival/Creative may break and place blocks; Adventure/Spectator cannot. */
export function canEditBlocks(mode: GameMode): boolean {
  return mode === "survival" || mode === "creative";
}

/** Creative breaks instantly and places without consuming items (no drops, no durability). */
export function freeBuild(mode: GameMode): boolean {
  return mode === "creative";
}

/** Every mode but Spectator can interact with the world (attack, doors, chests, trade, eat, fish). */
export function canInteract(mode: GameMode): boolean {
  return mode !== "spectator";
}

/** Creative and Spectator can fly (Spectator always; Creative on toggle). */
export function canFly(mode: GameMode): boolean {
  return mode === "creative" || mode === "spectator";
}

/** Spectator passes through terrain (no collision). */
export function isNoclip(mode: GameMode): boolean {
  return mode === "spectator";
}

/** Every mode but Spectator carries a usable inventory/hotbar. */
export function usesInventory(mode: GameMode): boolean {
  return mode !== "spectator";
}

/** Hostiles spawn against / aggro / damage the player only in Survival and Adventure. */
export function mobsThreaten(mode: GameMode): boolean {
  return mode === "survival" || mode === "adventure";
}
