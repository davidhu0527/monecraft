import type { FrameInput } from "./state";

/**
 * Test-only FrameInput builder. Accepts the familiar DOM key-code names for
 * movement (the vocabulary the old FrameInput used and the docs still speak),
 * translating them to the abstract intents the engine consumes — so a test
 * reads "hold KeyW" while the engine sees `move.forward`.
 *
 * Not a .test.ts file (bun test would collect it); imported by tests only.
 */
export function frameInput(overrides: Partial<{ keys: string[]; sprint: boolean; mineHeld: boolean }> = {}): FrameInput {
  const keys = new Set(overrides.keys ?? []);
  return {
    move: {
      forward: keys.has("KeyW"),
      back: keys.has("KeyS"),
      left: keys.has("KeyA"),
      right: keys.has("KeyD"),
      jump: keys.has("Space"),
      crouch: keys.has("KeyC"),
      sprint: overrides.sprint ?? false
    },
    mineHeld: overrides.mineHeld ?? false
  };
}
