import { MAX_HEARTS } from "@/lib/game/config";

/**
 * Game difficulty — an orthogonal axis to the game mode (lib/game/gameModes.ts).
 * The mode decides *how* you play (survival/creative/…); the difficulty decides
 * *how hard* the survival experience is. Like the mode, it is picked at world
 * creation and switchable in the pause menu.
 *
 * - **peaceful** — no hostiles spawn (and existing ones despawn on switch), health
 *   regenerates twice as fast, and hunger never starves you. Building in peace.
 * - **easy**     — hostiles spawn lightly and hit at half strength; starvation only
 *   bruises you down to 10 HP.
 * - **normal**   — the balanced baseline; starvation floors at 1 HP (half a heart).
 * - **hard**     — hostiles spawn thick and hit hard; starvation can kill.
 *
 * Systems gate on the **accessors** below (intent: "do hostiles spawn?", "what's
 * the mob-damage multiplier?") rather than comparing the raw id, so a new level
 * only has to answer the accessors and every call site keeps working. This mirrors
 * the predicate convention in gameModes.ts.
 */
export type Difficulty = "peaceful" | "easy" | "normal" | "hard";

export const DIFFICULTY_IDS: readonly Difficulty[] = ["peaceful", "easy", "normal", "hard"];

/** Coerces a stored/UI value to a Difficulty; unknown values are not difficulties. */
export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === "string" && (DIFFICULTY_IDS as readonly string[]).includes(value);
}

/** UI metadata for the difficulty picker (creation form + pause menu). */
export const DIFFICULTY_PRESETS: ReadonlyArray<{ id: Difficulty; label: string; blurb: string }> = [
  { id: "peaceful", label: "Peaceful", blurb: "No monsters, no starving — build in peace" },
  { id: "easy", label: "Easy", blurb: "Fewer, weaker foes; hunger only bruises" },
  { id: "normal", label: "Normal", blurb: "The balanced challenge" },
  { id: "hard", label: "Hard", blurb: "Relentless hordes — and hunger can kill" }
];

// --- Difficulty accessors: gate systems on intent, never on the raw id. ---

/** Hostiles spawn at all only above Peaceful. (Peaceful also despawns existing hostiles on switch.) */
export function hostilesSpawn(difficulty: Difficulty): boolean {
  return difficulty !== "peaceful";
}

/** ×mob attack/arrow damage. Peaceful never reaches a damage site (no hostiles), but is kept total. */
export function mobDamageMultiplier(difficulty: Difficulty): number {
  switch (difficulty) {
    case "peaceful":
      return 0;
    case "easy":
      return 0.5;
    case "normal":
      return 1;
    case "hard":
      return 1.5;
  }
}

/** ×hostile-spawn interval: <1 spawns faster, >1 slower. (Peaceful unused — no spawns.) */
export function hostileSpawnIntervalScale(difficulty: Difficulty): number {
  switch (difficulty) {
    case "peaceful":
      return 1;
    case "easy":
      return 1.5; // 10s → 15s between waves
    case "normal":
      return 1; // 10s baseline
    case "hard":
      return 0.6; // 10s → 6s, thicker pressure
  }
}

/** ×concurrent hostile cap (applied to HOSTILE_CAP). Peaceful caps at zero. */
export function hostileCapScale(difficulty: Difficulty): number {
  switch (difficulty) {
    case "peaceful":
      return 0;
    case "easy":
      return 0.5; // 16 → 8
    case "normal":
      return 1; // 16
    case "hard":
      return 1.5; // 16 → 24
  }
}

/** ×health-regen cadence: <1 regenerates faster. Peaceful heals twice as fast as a mercy. */
export function regenIntervalScale(difficulty: Difficulty): number {
  return difficulty === "peaceful" ? 0.5 : 1;
}

/** Whether this difficulty starves the player at all (Peaceful never does). */
export function starves(difficulty: Difficulty): boolean {
  return difficulty !== "peaceful";
}

/**
 * The HP floor that hunger starvation can never drop the player below (starvation
 * only fires at hunger 0). Peaceful returns full health, so even if the gate were
 * bypassed it could never bite; Easy bruises to 10 HP (5 hearts), Normal to 1 HP
 * (half a heart), and Hard to 0 — a kill.
 */
export function starvationFloorHp(difficulty: Difficulty): number {
  switch (difficulty) {
    case "peaceful":
      return MAX_HEARTS;
    case "easy":
      return 10;
    case "normal":
      return 1;
    case "hard":
      return 0;
  }
}
