import { describe, expect, test } from "bun:test";
import { INVENTORY_SLOTS } from "@/lib/game/config";
import { inventorySlotsSnapshot, migrateSaveV1toV2, readSave, writeSave } from "@/lib/game/save";
import { createSlot, createEmptySlot } from "@/lib/game/items";
import type { SaveData, SaveDataV1 } from "@/lib/game/types";

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
    version: 2,
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
    player: { x: 100.5, y: 48, z: 200.25 }
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
    expect(parsed!.version).toBe(2);
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
    expect(parsed!.version).toBe(2);
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

describe("readSave rejects corrupt data", () => {
  test("missing key", () => {
    expect(readSave(KEY, memoryStorage())).toBeNull();
  });

  test("malformed JSON", () => {
    expect(readSave(KEY, memoryStorage({ [KEY]: "{not json" }))).toBeNull();
  });

  test("unknown future version", () => {
    const save = { ...sampleSave(), version: 3 };
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
