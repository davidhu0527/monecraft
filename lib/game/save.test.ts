import { describe, expect, test } from "bun:test";
import { INVENTORY_SLOTS } from "@/lib/game/config";
import { MAX_HEARTS, MAX_HUNGER } from "@/lib/game/config";
import {
  inventorySlotsSnapshot,
  migrateSaveV1toV2,
  migrateSaveV2toV3,
  readSave,
  restoreDayClock,
  restoreHearts,
  restoreHungerLevel,
  restoreSpawnPoint,
  writeSave
} from "@/lib/game/save";
import { createSlot, createEmptySlot } from "@/lib/game/items";
import type { SaveData, SaveDataV1, SaveDataV2 } from "@/lib/game/types";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value)
  };
}

const KEY = "test_save";

function sampleSave(): SaveData {
  return {
    version: 3,
    seed: 1337,
    changes: [
      [42, 0],
      [99, 3]
    ],
    inventorySlots: [
      { id: "dirt", count: 12 },
      { id: "wood_pickaxe", count: 1, durability: 35 },
      { id: null, count: 0 }
    ],
    equippedArmor: { helmet: "helmet" },
    selectedSlot: 2,
    player: { x: 100.5, y: 48, z: 200.25 },
    dayClock: 123.5,
    hearts: 14,
    hunger: 9,
    spawnPoint: { x: 10, y: 40, z: 20 }
  };
}

describe("save round-trip", () => {
  test("writeSave then readSave preserves every field", () => {
    const storage = memoryStorage();
    writeSave(KEY, sampleSave(), storage);
    expect(readSave(KEY, storage)).toEqual(sampleSave());
  });

  test("legacy saves with inventoryCounts instead of inventorySlots still parse", () => {
    const legacy = {
      version: 1,
      seed: 7,
      changes: [],
      inventoryCounts: { dirt: 30, stone: 5 },
      selectedSlot: 0,
      player: { x: 1, y: 2, z: 3 }
    };
    const storage = memoryStorage({ [KEY]: JSON.stringify(legacy) });
    const parsed = readSave(KEY, storage);
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(3);
    expect(parsed!.inventoryCounts).toEqual({ dirt: 30, stone: 5 });
    expect(parsed!.inventorySlots).toBeUndefined();
  });
});

describe("v1 to v2 migration", () => {
  function v1Save(overrides: Partial<SaveDataV1> = {}): SaveDataV1 {
    return {
      version: 1,
      seed: 1337,
      changes: [[42, 0]],
      selectedSlot: 0,
      player: { x: 1, y: 2, z: 3 },
      ...overrides
    };
  }

  test("readSave accepts a v1 save and migrates it to v2", () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify(v1Save({ selectedSlot: 9 })) });
    const parsed = readSave(KEY, storage);
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(3); // chained v1 -> v2 -> v3
    expect(parsed!.selectedSlot).toBe(8); // hotbar shrank from 10 to 9 slots
    expect(parsed!.seed).toBe(1337);
    expect(parsed!.changes).toEqual([[42, 0]]);
  });

  test("packs non-empty slots and merges stackable items", () => {
    const migrated = migrateSaveV1toV2(
      v1Save({
        inventorySlots: [
          { id: "dirt", count: 90 },
          { id: null, count: 0 },
          { id: "wood_pickaxe", count: 1, durability: 35 },
          { id: "dirt", count: 30 }
        ]
      })
    );
    expect(migrated.inventorySlots).toEqual([
      { id: "dirt", count: 99 },
      { id: "wood_pickaxe", count: 1, durability: 35 },
      { id: "dirt", count: 21, durability: undefined }
    ]);
  });

  test("normalizes a non-finite or fractional selectedSlot", () => {
    expect(migrateSaveV1toV2(v1Save({ selectedSlot: Number.NaN })).selectedSlot).toBe(0);
    expect(migrateSaveV1toV2(v1Save({ selectedSlot: 3.9 })).selectedSlot).toBe(3);
    expect(migrateSaveV1toV2(v1Save({ selectedSlot: 99 })).selectedSlot).toBe(8);
    expect(migrateSaveV1toV2(v1Save({ selectedSlot: -4 })).selectedSlot).toBe(0);
  });

  test("tools never merge even when sharing an id", () => {
    const migrated = migrateSaveV1toV2(
      v1Save({
        inventorySlots: [
          { id: "wood_pickaxe", count: 1, durability: 35 },
          { id: "wood_pickaxe", count: 1, durability: 70 }
        ]
      })
    );
    expect(migrated.inventorySlots).toHaveLength(2);
  });

  test("items overflowing the smaller inventory are dropped", () => {
    const slots = Array.from({ length: 40 }, (_, i) => ({ id: i % 2 === 0 ? "dirt" : "wood_pickaxe", count: 1 }));
    const migrated = migrateSaveV1toV2(v1Save({ inventorySlots: slots }));
    // 20 dirt merge into one stack; 20 pickaxes stay separate = 21 ≤ 36 kept.
    expect(migrated.inventorySlots!.length).toBeLessThanOrEqual(INVENTORY_SLOTS);
    const pickaxes = Array.from({ length: 40 }, () => ({ id: "wood_pickaxe", count: 1 }));
    const overflowing = migrateSaveV1toV2(v1Save({ inventorySlots: pickaxes }));
    expect(overflowing.inventorySlots!.length).toBe(INVENTORY_SLOTS);
  });
});

describe("v2 to v3 migration", () => {
  function v2Save(overrides: Partial<SaveDataV2> = {}): SaveDataV2 {
    return {
      version: 2,
      seed: 1337,
      changes: [[42, 0]],
      inventorySlots: [{ id: "dirt", count: 3 }],
      selectedSlot: 0,
      player: { x: 1, y: 2, z: 3 },
      ...overrides
    };
  }

  test("migrateSaveV2toV3 is a pure version bump leaving new fields absent", () => {
    const migrated = migrateSaveV2toV3(v2Save());
    expect(migrated.version).toBe(3);
    expect(migrated.dayClock).toBeUndefined();
    expect(migrated.hearts).toBeUndefined();
    expect(migrated.spawnPoint).toBeUndefined();
    expect(migrated.changes).toEqual([[42, 0]]);
  });

  test("readSave migrates a v2 save to v3", () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify(v2Save()) });
    const parsed = readSave(KEY, storage);
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(3);
  });

  test("a v3 round-trip preserves the new stat/clock/spawn fields", () => {
    const storage = memoryStorage();
    writeSave(KEY, sampleSave(), storage);
    const parsed = readSave(KEY, storage)!;
    expect(parsed.dayClock).toBe(123.5);
    expect(parsed.hearts).toBe(14);
    expect(parsed.hunger).toBe(9);
    expect(parsed.spawnPoint).toEqual({ x: 10, y: 40, z: 20 });
  });
});

describe("stat restoration helpers", () => {
  const base = sampleSave();

  test("missing fields restore as null so the engine keeps its defaults", () => {
    const bare: SaveData = { ...base, dayClock: undefined, hearts: undefined, hunger: undefined, spawnPoint: undefined };
    expect(restoreDayClock(bare)).toBeNull();
    expect(restoreHearts(bare)).toBeNull();
    expect(restoreHungerLevel(bare)).toBeNull();
    expect(restoreSpawnPoint(bare)).toBeNull();
  });

  test("out-of-range values are clamped", () => {
    expect(restoreHearts({ ...base, hearts: 999 })).toBe(MAX_HEARTS);
    expect(restoreHearts({ ...base, hearts: 0 })).toBe(1);
    expect(restoreHungerLevel({ ...base, hunger: -5 })).toBe(0);
    expect(restoreHungerLevel({ ...base, hunger: 999 })).toBe(MAX_HUNGER);
    expect(restoreDayClock({ ...base, dayClock: -1 })).toBeNull();
    expect(restoreDayClock({ ...base, dayClock: Number.NaN })).toBeNull();
  });

  test("spawnPoint floors coordinates and rejects malformed points", () => {
    expect(restoreSpawnPoint({ ...base, spawnPoint: { x: 5.9, y: 40.2, z: 20.7 } })).toEqual({ x: 5, y: 40, z: 20 });
    expect(restoreSpawnPoint({ ...base, spawnPoint: null })).toBeNull();
  });
});

describe("readSave rejects corrupt data", () => {
  test("missing key", () => {
    expect(readSave(KEY, memoryStorage())).toBeNull();
  });

  test("malformed JSON", () => {
    expect(readSave(KEY, memoryStorage({ [KEY]: "{not json" }))).toBeNull();
  });

  test("unknown future version", () => {
    const save = { ...sampleSave(), version: 4 };
    expect(readSave(KEY, memoryStorage({ [KEY]: JSON.stringify(save) }))).toBeNull();
  });

  test("non-numeric seed", () => {
    const save = { ...sampleSave(), seed: "abc" };
    expect(readSave(KEY, memoryStorage({ [KEY]: JSON.stringify(save) }))).toBeNull();
  });

  test("changes is not an array", () => {
    const save = { ...sampleSave(), changes: {} };
    expect(readSave(KEY, memoryStorage({ [KEY]: JSON.stringify(save) }))).toBeNull();
  });

  test("JSON null and primitives", () => {
    expect(readSave(KEY, memoryStorage({ [KEY]: "null" }))).toBeNull();
    expect(readSave(KEY, memoryStorage({ [KEY]: "42" }))).toBeNull();
  });
});

describe("inventorySlotsSnapshot", () => {
  test("keeps only the persisted fields", () => {
    const snapshot = inventorySlotsSnapshot([createSlot("wood_pickaxe", 1), createSlot("dirt", 9), createEmptySlot()]);
    expect(snapshot).toEqual([
      { id: "wood_pickaxe", count: 1, durability: 70 },
      { id: "dirt", count: 9, durability: undefined },
      { id: null, count: 0, durability: undefined }
    ]);
    // Definition-derived fields (label, attack, minePower…) must not be persisted.
    expect(Object.keys(snapshot[0]).sort()).toEqual(["count", "durability", "id"]);
  });
});
