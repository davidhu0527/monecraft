import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { EYE_HEIGHT, PET_FIGHT_RANGE, PET_TAMED_HP } from "@/lib/game/config";
import { createEmptySlot, createSlot } from "@/lib/game/items";
import { countsById } from "@/lib/game/inventory";
import type { GameEvent, GameState, MobState } from "@/lib/game/engine/state";
import { tryTameAimedMob, tryToggleSitPet } from "@/lib/game/engine/systems/interact";
import type { InventorySlot, MobKind } from "@/lib/game/types";

function inventory(items: Array<[string, number]>): InventorySlot[] {
  const slots = Array.from({ length: 9 }, () => createEmptySlot());
  items.forEach(([id, count], i) => (slots[i] = createSlot(id, count)));
  return slots;
}

function makeState(slots: InventorySlot[], mob: MobState): GameState {
  return {
    player: { position: new THREE.Vector3(0, 64, 0), velocity: new THREE.Vector3(), yaw: 0, pitch: 0, onGround: true },
    inventory: slots,
    selectedSlot: 0,
    mobs: [mob]
  } as unknown as GameState;
}

/** A mob two blocks ahead (down -Z) at eye height — directly in the aim cone. */
function mobInFront(kind: MobKind, overrides: Partial<MobState> = {}): MobState {
  return {
    kind,
    hp: 8,
    faction: "wild",
    detectRange: 0,
    position: new THREE.Vector3(0, 64 + EYE_HEIGHT, -2),
    direction: new THREE.Vector3(),
    ...overrides
  } as unknown as MobState;
}

describe("tryTameAimedMob", () => {
  test("a successful roll tames a wild wolf: owner/faction/hp/range set, bone consumed, event fired", () => {
    const wolf = mobInFront("wolf");
    const state = makeState(inventory([["bone", 2]]), wolf);
    const events: GameEvent[] = [];

    const consumed = tryTameAimedMob(
      state,
      (e) => events.push(e),
      () => 0
    ); // 0 < TAME_CHANCE → success

    expect(consumed).toBe(true);
    expect(wolf.owner).toBe("player");
    expect(wolf.faction).toBe("ally");
    expect(wolf.hp).toBe(PET_TAMED_HP);
    expect(wolf.detectRange).toBe(PET_FIGHT_RANGE);
    expect(countsById(state.inventory).get("bone") ?? 0).toBe(1); // one bone eaten
    expect(events.some((e) => e.type === "mobTamed" && e.kind === "wolf")).toBe(true);
  });

  test("a failed roll still eats the treat but leaves the mob wild (consumes the click)", () => {
    const wolf = mobInFront("wolf");
    const state = makeState(inventory([["bone", 1]]), wolf);
    const events: GameEvent[] = [];

    const consumed = tryTameAimedMob(
      state,
      (e) => events.push(e),
      () => 0.9
    ); // 0.9 ≥ TAME_CHANCE → fail

    expect(consumed).toBe(true);
    expect(wolf.owner).toBeUndefined();
    expect(countsById(state.inventory).get("bone") ?? 0).toBe(0); // still eaten
    expect(events.some((e) => e.type === "mobTamed")).toBe(false);
  });

  test("declines the wrong treat and an already-owned pet (no consumption)", () => {
    const wolfWrongTreat = mobInFront("wolf");
    const wrong = makeState(inventory([["wheat", 1]]), wolfWrongTreat);
    expect(
      tryTameAimedMob(
        wrong,
        () => {},
        () => 0
      )
    ).toBe(false);
    expect(countsById(wrong.inventory).get("wheat") ?? 0).toBe(1);

    const ownedWolf = mobInFront("wolf", { owner: "player", faction: "ally" });
    const owned = makeState(inventory([["bone", 1]]), ownedWolf);
    expect(
      tryTameAimedMob(
        owned,
        () => {},
        () => 0
      )
    ).toBe(false);
    expect(countsById(owned.inventory).get("bone") ?? 0).toBe(1);
  });
});

describe("tryToggleSitPet", () => {
  test("toggles sit on your own pet and fires the event", () => {
    const pet = mobInFront("wolf", { owner: "player", faction: "ally" });
    const state = makeState(inventory([["diamond_sword", 1]]), pet);
    const events: GameEvent[] = [];

    expect(tryToggleSitPet(state, (e) => events.push(e))).toBe(true);
    expect(pet.sitting).toBe(true);
    expect(events.some((e) => e.type === "petSitToggled" && e.sitting === true)).toBe(true);

    expect(tryToggleSitPet(state, () => {})).toBe(true);
    expect(pet.sitting).toBe(false); // toggles back
  });

  test("declines a mob you don't own", () => {
    const wild = mobInFront("wolf");
    const state = makeState(inventory([["diamond_sword", 1]]), wild);
    expect(tryToggleSitPet(state, () => {})).toBe(false);
    expect(wild.sitting).toBeUndefined();
  });

  test("declines while holding the pet's breeding treat (so a breed attempt doesn't flip sitting)", () => {
    const pet = mobInFront("wolf", { owner: "player", faction: "ally" });
    const state = makeState(inventory([["bone", 1]]), pet); // bone is the wolf's breed/tame treat
    expect(tryToggleSitPet(state, () => {})).toBe(false);
    expect(pet.sitting).toBeUndefined();
  });
});
