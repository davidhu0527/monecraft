import { describe, expect, test } from "bun:test";
import { MOB_TEMPLATES } from "@/lib/game/mobs";
import type { MobKind } from "@/lib/game/types";
import { MATERIAL_GROUPS } from "./materials";
import {
  BREAK_SOUNDS,
  DEATH_SOUND,
  EAT_SOUND,
  FOOTSTEP_SOUNDS,
  HIT_TICK_SOUNDS,
  HURT_SOUND,
  JUMP_SOUND,
  LAND_SOUND,
  MOB_AMBIENT_SOUNDS,
  MOB_ATTACK_SOUNDS,
  MOB_HIT_SOUND,
  PLACE_SOUNDS,
  RESPAWN_SOUND,
  type SoundDef
} from "./soundParams";

const MOB_KINDS = Object.keys(MOB_TEMPLATES) as MobKind[];

const SINGLES: Record<string, SoundDef> = {
  jump: JUMP_SOUND,
  land: LAND_SOUND,
  hurt: HURT_SOUND,
  eat: EAT_SOUND,
  mobHit: MOB_HIT_SOUND,
  death: DEATH_SOUND,
  respawn: RESPAWN_SOUND
};

function expectWellFormed(name: string, def: SoundDef): void {
  expect(def.params.length).toBe(21);
  for (const value of def.params) {
    if (value !== undefined) expect(Number.isFinite(value)).toBe(true);
  }
  const volume = def.params[0];
  expect(volume).toBeGreaterThan(0);
  expect(volume).toBeLessThanOrEqual(1.5);
  if (def.minRetriggerMs !== undefined) expect(def.minRetriggerMs).toBeGreaterThan(0);
}

describe("sound tables", () => {
  test("every material group has break, place, footstep, and hit-tick sounds", () => {
    for (const group of MATERIAL_GROUPS) {
      expectWellFormed(`break:${group}`, BREAK_SOUNDS[group]);
      expectWellFormed(`place:${group}`, PLACE_SOUNDS[group]);
      expectWellFormed(`footstep:${group}`, FOOTSTEP_SOUNDS[group]);
      expectWellFormed(`tick:${group}`, HIT_TICK_SOUNDS[group]);
    }
  });

  test("every mob kind has ambient and attack sounds", () => {
    expect(MOB_KINDS.length).toBeGreaterThan(0);
    for (const kind of MOB_KINDS) {
      expectWellFormed(`ambient:${kind}`, MOB_AMBIENT_SOUNDS[kind]);
      expectWellFormed(`attack:${kind}`, MOB_ATTACK_SOUNDS[kind]);
    }
  });

  test("player one-shots are well formed", () => {
    for (const [name, def] of Object.entries(SINGLES)) expectWellFormed(name, def);
  });
});
