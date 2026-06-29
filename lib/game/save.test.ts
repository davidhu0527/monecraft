import { describe, expect, test } from "bun:test";
import { CUSTOM_NAME_MAX_LEN, ENCHANT_MAX_LEVEL, INVENTORY_SLOTS } from "@/lib/game/config";
import { MAX_HEARTS, MAX_HUNGER } from "@/lib/game/config";
import {
  inventorySlotsSnapshot,
  migrateSaveV1toV2,
  migrateSaveV2toV3,
  migrateSaveV3toV4,
  migrateSaveV4toV5,
  migrateSaveV5toV6,
  migrateSaveV6toV7,
  migrateSaveV7toV8,
  migrateSaveV8toV9,
  migrateSaveV9toV10,
  migrateSaveV10toV11,
  migrateSaveV11toV12,
  migrateSaveV12toV13,
  readContainers,
  readLootedChests,
  readSave,
  restoreDayClock,
  restoreEquippedArmor,
  restoreDifficulty,
  restoreEffects,
  restoreGameMode,
  restoreGameOver,
  restoreHardcore,
  restoreHearts,
  restoreHungerLevel,
  restoreInventorySlots,
  restorePlayerPosition,
  restoreAdvancements,
  restoreSpawnPoint,
  restoreStats,
  restoreXp,
  serializeContainers,
  serializeEffects,
  serializeLootedChests,
  serializeStats,
  writeSave
} from "@/lib/game/save";
import { createSlot, createEmptySlot } from "@/lib/game/items";
import type {
  InventorySlot,
  SaveData,
  SaveDataV1,
  SaveDataV2,
  SaveDataV3,
  SaveDataV4,
  SaveDataV5,
  SaveDataV6,
  SaveDataV7,
  SaveDataV8,
  SaveDataV9,
  SaveDataV10,
  SaveDataV11,
  SaveDataV12
} from "@/lib/game/types";

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
    version: 13,
    gameMode: "creative",
    difficulty: "hard",
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
    equippedArmor: { helmet: { id: "helmet", count: 1 } },
    selectedSlot: 2,
    player: { x: 100.5, y: 48, z: 200.25 },
    dayClock: 123.5,
    hearts: 14,
    hunger: 9,
    spawnPoint: { x: 10, y: 40, z: 20 },
    lootedChests: [100, 200],
    stats: [
      { id: "blocks_mined", value: 42 },
      { id: "play_time", value: 123.5 }
    ],
    advancements: ["getting_wood", "stone_age"]
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
    expect(parsed!.version).toBe(13);
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
    expect(parsed!.version).toBe(13); // chained v1 -> v2 -> … -> v12 -> v13
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

  test("splits legacy stacked durable gear into one item per slot", () => {
    const migrated = migrateSaveV1toV2(
      v1Save({
        inventorySlots: [{ id: "diamond_sword", count: 3, durability: 200 }]
      })
    );
    expect(migrated.inventorySlots).toEqual([
      { id: "diamond_sword", count: 1, durability: 200 },
      { id: "diamond_sword", count: 1, durability: 200 },
      { id: "diamond_sword", count: 1, durability: 200 }
    ]);
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

  test("readSave migrates a v2 save through to v13", () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify(v2Save()) });
    const parsed = readSave(KEY, storage);
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(13);
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

describe("v3 to v4 migration & chest containers", () => {
  function v3Save(overrides: Partial<SaveDataV3> = {}): SaveDataV3 {
    return {
      version: 3,
      seed: 1337,
      changes: [[42, 0]],
      inventorySlots: [{ id: "dirt", count: 3 }],
      selectedSlot: 0,
      player: { x: 1, y: 2, z: 3 },
      ...overrides
    };
  }

  test("migrateSaveV3toV4 is a pure version bump leaving blockEntities absent", () => {
    const migrated = migrateSaveV3toV4(v3Save());
    expect(migrated.version).toBe(4);
    expect(migrated.blockEntities).toBeUndefined();
    expect(migrated.changes).toEqual([[42, 0]]);
  });

  test("a pre-chest (v3) save loads with no containers", () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify(v3Save()) });
    const parsed = readSave(KEY, storage)!;
    expect(parsed.version).toBe(13);
    expect(readContainers(parsed)).toEqual([]);
  });

  test("serializeContainers keeps only non-empty chests and snapshots their slots", () => {
    const full = [createSlot("dirt", 5), createEmptySlot()];
    const empty = [createEmptySlot(), createEmptySlot()];
    const out = serializeContainers(
      new Map<number, InventorySlot[]>([
        [100, full],
        [200, empty]
      ])
    );
    expect(out).toHaveLength(1);
    expect(out[0].index).toBe(100);
    expect(out[0].slots[0]).toEqual({ id: "dirt", count: 5, durability: undefined });
  });

  test("a chest round-trips through save with durability preserved", () => {
    const slots = [createSlot("dirt", 5), { ...createSlot("diamond_sword", 1), durability: 200 }];
    const save: SaveData = { ...sampleSave(), blockEntities: serializeContainers(new Map([[100, slots]])) };
    const storage = memoryStorage();
    writeSave(KEY, save, storage);
    const restored = readContainers(readSave(KEY, storage)!);
    expect(restored).toHaveLength(1);
    expect(restored[0].index).toBe(100);
    expect(restored[0].slots).toHaveLength(27); // padded to CHEST_SLOTS
    expect(restored[0].slots[0].id).toBe("dirt");
    expect(restored[0].slots[1].durability).toBe(200);
  });

  test("readContainers drops unknown ids and malformed entries", () => {
    const save: SaveData = {
      ...sampleSave(),
      blockEntities: [
        {
          index: 100,
          slots: [
            { id: "no_such_item", count: 3 },
            { id: "stone", count: 2 }
          ]
        },
        { index: Number.NaN, slots: [] }
      ]
    };
    const restored = readContainers(save);
    expect(restored).toHaveLength(1); // NaN index dropped
    expect(restored[0].slots[0].id).toBeNull(); // unknown id -> empty
    expect(restored[0].slots[1].id).toBe("stone");
  });
});

describe("v4 to v5 migration & dungeon looted chests", () => {
  function v4Save(overrides: Partial<SaveDataV4> = {}): SaveDataV4 {
    return {
      version: 4,
      seed: 1337,
      changes: [[42, 0]],
      inventorySlots: [{ id: "dirt", count: 3 }],
      selectedSlot: 0,
      player: { x: 1, y: 2, z: 3 },
      ...overrides
    };
  }

  test("migrateSaveV4toV5 is a pure version bump leaving lootedChests absent", () => {
    const migrated = migrateSaveV4toV5(v4Save());
    expect(migrated.version).toBe(5);
    expect(migrated.lootedChests).toBeUndefined();
    expect(migrated.changes).toEqual([[42, 0]]);
  });

  test("a pre-dungeon (v4) save loads with no looted chests", () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify(v4Save()) });
    const parsed = readSave(KEY, storage)!;
    expect(parsed.version).toBe(13);
    expect(readLootedChests(parsed)).toEqual([]);
  });

  test("serializeLootedChests / readLootedChests round-trip the index set", () => {
    const out = serializeLootedChests(new Set([7, 42, 1000]));
    expect(out.sort((a, b) => a - b)).toEqual([7, 42, 1000]);
    expect(readLootedChests({ ...sampleSave(), lootedChests: out })).toEqual(out);
  });

  test("readLootedChests rejects non-array and filters non-finite indices", () => {
    expect(readLootedChests({ ...sampleSave(), lootedChests: undefined })).toEqual([]);
    expect(readLootedChests({ ...sampleSave(), lootedChests: [1, Number.NaN, 3, Infinity] })).toEqual([1, 3]);
  });

  test("lootedChests survive a full save round-trip", () => {
    const storage = memoryStorage();
    writeSave(KEY, sampleSave(), storage);
    expect(readSave(KEY, storage)!.lootedChests).toEqual([100, 200]);
  });
});

describe("v5 to v6 migration & status effects", () => {
  function v5Save(overrides: Partial<SaveDataV5> = {}): SaveDataV5 {
    return {
      version: 5,
      seed: 1337,
      changes: [[42, 0]],
      inventorySlots: [{ id: "dirt", count: 3 }],
      selectedSlot: 0,
      player: { x: 1, y: 2, z: 3 },
      ...overrides
    };
  }

  test("migrateSaveV5toV6 is a pure version bump leaving effects absent", () => {
    const migrated = migrateSaveV5toV6(v5Save());
    expect(migrated.version).toBe(6);
    expect(migrated.effects).toBeUndefined();
    expect(migrated.changes).toEqual([[42, 0]]);
  });

  test("a pre-effect (v5) save loads with no active effects", () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify(v5Save()) });
    const parsed = readSave(KEY, storage)!;
    expect(parsed.version).toBe(13);
    expect(restoreEffects(parsed)).toEqual([]);
  });

  test("migrateSaveV6toV7 is a pure version bump leaving xp absent", () => {
    const v6: SaveDataV6 = { ...v5Save(), version: 6 };
    const migrated = migrateSaveV6toV7(v6);
    expect(migrated.version).toBe(7);
    expect(migrated.xp).toBeUndefined();
  });

  test("migrateSaveV7toV8 is a pure version bump leaving gameMode absent", () => {
    const v7: SaveDataV7 = { ...v5Save(), version: 7 };
    const migrated = migrateSaveV7toV8(v7);
    expect(migrated.version).toBe(8);
    expect(migrated.gameMode).toBeUndefined();
  });

  test("a pre-mode (v7) save loads as survival", () => {
    const v7: SaveDataV7 = { ...v5Save(), version: 7 };
    const storage = memoryStorage({ [KEY]: JSON.stringify(v7) });
    const parsed = readSave(KEY, storage)!;
    expect(parsed.version).toBe(13);
    expect(restoreGameMode(parsed)).toBe("survival");
  });

  test("restoreGameMode reads a valid mode and rejects garbage", () => {
    expect(restoreGameMode({ ...sampleSave(), gameMode: "spectator" })).toBe("spectator");
    expect(restoreGameMode({ ...sampleSave(), gameMode: "bogus" as never })).toBe("survival");
    expect(restoreGameMode({ ...sampleSave(), gameMode: undefined })).toBe("survival");
  });

  test("gameMode survives a full save round-trip", () => {
    const storage = memoryStorage();
    writeSave(KEY, { ...sampleSave(), gameMode: "adventure" }, storage);
    expect(readSave(KEY, storage)!.gameMode).toBe("adventure");
  });

  test("migrateSaveV8toV9 is a pure version bump leaving difficulty absent", () => {
    const v8: SaveDataV8 = { ...v5Save(), version: 8 };
    const migrated = migrateSaveV8toV9(v8);
    expect(migrated.version).toBe(9);
    expect(migrated.difficulty).toBeUndefined();
  });

  test("a pre-difficulty (v8) save loads as normal", () => {
    const v8: SaveDataV8 = { ...v5Save(), version: 8 };
    const storage = memoryStorage({ [KEY]: JSON.stringify(v8) });
    const parsed = readSave(KEY, storage)!;
    expect(parsed.version).toBe(13);
    expect(restoreDifficulty(parsed)).toBe("normal");
  });

  test("restoreDifficulty reads a valid level and rejects garbage", () => {
    expect(restoreDifficulty({ ...sampleSave(), difficulty: "peaceful" })).toBe("peaceful");
    expect(restoreDifficulty({ ...sampleSave(), difficulty: "bogus" as never })).toBe("normal");
    expect(restoreDifficulty({ ...sampleSave(), difficulty: undefined })).toBe("normal");
  });

  test("difficulty survives a full save round-trip", () => {
    const storage = memoryStorage();
    writeSave(KEY, { ...sampleSave(), difficulty: "easy" }, storage);
    expect(readSave(KEY, storage)!.difficulty).toBe("easy");
  });

  test("migrateSaveV9toV10 is a pure version bump leaving hardcore/gameOver absent", () => {
    const v9: SaveDataV9 = { ...v5Save(), version: 9 };
    const migrated = migrateSaveV9toV10(v9);
    expect(migrated.version).toBe(10);
    expect(migrated.hardcore).toBeUndefined();
    expect(migrated.gameOver).toBeUndefined();
  });

  test("a pre-Hardcore (v9) save loads as a normal, non-hardcore world", () => {
    const v9: SaveDataV9 = { ...v5Save(), version: 9 };
    const storage = memoryStorage({ [KEY]: JSON.stringify(v9) });
    const parsed = readSave(KEY, storage)!;
    expect(parsed.version).toBe(13);
    expect(restoreHardcore(parsed)).toBe(false);
    expect(restoreGameOver(parsed)).toBe(false);
  });

  test("restoreHardcore/restoreGameOver read true and coerce garbage to false", () => {
    expect(restoreHardcore({ ...sampleSave(), hardcore: true })).toBe(true);
    expect(restoreHardcore({ ...sampleSave(), hardcore: undefined })).toBe(false);
    expect(restoreHardcore({ ...sampleSave(), hardcore: 1 as never })).toBe(false);
    expect(restoreGameOver({ ...sampleSave(), hardcore: true, gameOver: true })).toBe(true);
    expect(restoreGameOver({ ...sampleSave(), gameOver: undefined })).toBe(false);
    // gameOver only ever lands on a hardcore save — a stray flag on a non-hardcore
    // (corrupt) save must not lock it into spectator.
    expect(restoreGameOver({ ...sampleSave(), hardcore: false, gameOver: true })).toBe(false);
  });

  test("hardcore + gameOver survive a full save round-trip", () => {
    const storage = memoryStorage();
    writeSave(KEY, { ...sampleSave(), hardcore: true, gameOver: true }, storage);
    const parsed = readSave(KEY, storage)!;
    expect(parsed.hardcore).toBe(true);
    expect(parsed.gameOver).toBe(true);
  });

  test("migrateSaveV10toV11 is a pure version bump leaving custom names absent", () => {
    const v10: SaveDataV10 = { ...v5Save(), version: 10 };
    const migrated = migrateSaveV10toV11(v10);
    expect(migrated.version).toBe(11);
    expect(migrated.inventorySlots).toEqual(v10.inventorySlots); // unchanged
  });

  test("migrateSaveV11toV12 moves a by-id equip out of the inventory into the armor record", () => {
    const v11: SaveDataV11 = {
      ...v5Save(),
      version: 11,
      inventorySlots: [
        { id: "helmet", count: 1, durability: 200, enchantments: [{ id: "protection", level: 2 }] },
        { id: "dirt", count: 5 }
      ],
      equippedArmor: { helmet: "helmet" }
    };
    const migrated = migrateSaveV11toV12(v11);
    expect(migrated.version).toBe(12);
    // The worn helmet (with its durability/enchants) moves into the record…
    expect(migrated.equippedArmor?.helmet).toEqual({ id: "helmet", count: 1, durability: 200, enchantments: [{ id: "protection", level: 2 }] });
    // …and is removed from the inventory (no more double-occupancy).
    expect(migrated.inventorySlots?.[0]).toEqual({ id: null, count: 0 });
    expect(migrated.inventorySlots?.[1]).toEqual({ id: "dirt", count: 5 });
  });

  test("migrateSaveV11toV12 drops an equip whose item isn't in the inventory", () => {
    const v11: SaveDataV11 = { ...v5Save(), version: 11, inventorySlots: [{ id: "dirt", count: 5 }], equippedArmor: { helmet: "helmet" } };
    expect(migrateSaveV11toV12(v11).equippedArmor?.helmet).toBeUndefined();
  });

  test("worn armor survives a full save round-trip with durability + enchantments", () => {
    const storage = memoryStorage();
    const save: SaveData = {
      ...sampleSave(),
      equippedArmor: { chestplate: { id: "chestplate", count: 1, durability: 100, enchantments: [{ id: "protection", level: 1 }] } }
    };
    writeSave(KEY, save, storage);
    const restored = restoreEquippedArmor(readSave(KEY, storage)!)!;
    expect(restored.chestplate?.durability).toBe(100);
    expect(restored.chestplate?.enchantments).toEqual([{ id: "protection", level: 1 }]);
  });

  test("a custom name survives a full save round-trip on durable gear", () => {
    const storage = memoryStorage();
    const save: SaveData = {
      ...sampleSave(),
      inventorySlots: [{ id: "diamond_sword", count: 1, durability: 700, customName: "Excalibur" }]
    };
    writeSave(KEY, save, storage);
    expect(readSave(KEY, storage)!.inventorySlots?.[0].customName).toBe("Excalibur");
  });

  test("restoreInventorySlots trims and caps a custom name, drops blanks, and ignores names on non-durable items", () => {
    const dirty: SaveData = {
      ...sampleSave(),
      inventorySlots: [
        { id: "diamond_sword", count: 1, durability: 700, customName: `  ${"x".repeat(50)}  ` }, // trimmed + capped
        { id: "ruby_sword", count: 1, durability: 360, customName: "   " }, // blank → dropped
        { id: "dirt", count: 5, customName: "Dirty" } // non-durable → no name
      ]
    };
    const slots = restoreInventorySlots(dirty)!;
    expect(slots[0].customName).toBe("x".repeat(CUSTOM_NAME_MAX_LEN));
    expect(slots[1].customName).toBeUndefined();
    expect(slots[2].customName).toBeUndefined();
  });

  test("restoreXp clamps to a non-negative integer; absent/garbage → 0", () => {
    expect(restoreXp({ ...sampleSave(), xp: 42.9 })).toBe(42);
    expect(restoreXp({ ...sampleSave(), xp: -5 })).toBe(0);
    expect(restoreXp({ ...sampleSave(), xp: Number.NaN })).toBe(0);
    expect(restoreXp({ ...sampleSave(), xp: undefined })).toBe(0);
  });

  test("xp and per-slot enchantments survive a full save round-trip", () => {
    const storage = memoryStorage();
    const save: SaveData = {
      ...sampleSave(),
      xp: 57,
      inventorySlots: [{ id: "diamond_sword", count: 1, durability: 700, enchantments: [{ id: "sharpness", level: 2 }] }]
    };
    writeSave(KEY, save, storage);
    const parsed = readSave(KEY, storage)!;
    expect(parsed.xp).toBe(57);
    expect(parsed.inventorySlots?.[0].enchantments).toEqual([{ id: "sharpness", level: 2 }]);
  });

  test("a bow's Power and Punch enchantments survive a full save round-trip", () => {
    const storage = memoryStorage();
    const save: SaveData = {
      ...sampleSave(),
      inventorySlots: [
        {
          id: "bow",
          count: 1,
          durability: 200,
          enchantments: [
            { id: "power", level: 3 },
            { id: "punch", level: 1 }
          ]
        }
      ]
    };
    writeSave(KEY, save, storage);
    const parsed = readSave(KEY, storage)!;
    expect(parsed.inventorySlots?.[0].enchantments).toEqual([
      { id: "power", level: 3 },
      { id: "punch", level: 1 }
    ]);
  });

  test("restoreInventorySlots drops unknown enchant ids and clamps levels; non-durable items carry none", () => {
    const dirty: SaveData = {
      ...sampleSave(),
      inventorySlots: [
        {
          id: "diamond_sword",
          count: 1,
          durability: 700,
          enchantments: [
            { id: "sharpness", level: 9 }, // over the cap → clamped
            { id: "not_real", level: 1 }, // unknown → dropped
            { id: "efficiency", level: 0 } // non-positive → dropped
          ] as never
        }
      ]
    };
    const slots = restoreInventorySlots(dirty)!;
    expect(slots[0].enchantments).toEqual([{ id: "sharpness", level: ENCHANT_MAX_LEVEL }]);
  });

  test("restoreInventorySlots clamps each enchant to its own cap (a tampered mending:3 loads as 1)", () => {
    const dirty: SaveData = {
      ...sampleSave(),
      inventorySlots: [{ id: "diamond_sword", count: 1, durability: 700, enchantments: [{ id: "mending", level: 3 }] as never }]
    };
    const slots = restoreInventorySlots(dirty)!;
    expect(slots[0].enchantments).toEqual([{ id: "mending", level: 1 }]); // Mending is binary
  });

  test("serializeEffects / restoreEffects round-trip the active effects", () => {
    const effects = new Map([
      ["speed", 30],
      ["poison", 4.5]
    ] as const);
    const out = serializeEffects(effects);
    expect(out).toEqual([
      { id: "speed", remaining: 30 },
      { id: "poison", remaining: 4.5 }
    ]);
    expect(restoreEffects({ ...sampleSave(), effects: out })).toEqual(out);
  });

  test("restoreEffects drops unknown ids and non-positive / garbage durations", () => {
    const dirty = [
      { id: "speed", remaining: 30 },
      { id: "not_an_effect", remaining: 10 },
      { id: "toString", remaining: 5 }, // a prototype key must not slip through
      { id: "poison", remaining: 0 },
      { id: "strength", remaining: Number.NaN }
    ] as never;
    expect(restoreEffects({ ...sampleSave(), effects: dirty })).toEqual([{ id: "speed", remaining: 30 }]);
    expect(restoreEffects({ ...sampleSave(), effects: undefined })).toEqual([]);
  });

  test("active effects survive a full save round-trip", () => {
    const storage = memoryStorage();
    writeSave(KEY, { ...sampleSave(), effects: [{ id: "regeneration", remaining: 12 }] }, storage);
    expect(readSave(KEY, storage)!.effects).toEqual([{ id: "regeneration", remaining: 12 }]);
  });

  test("the new haste/resistance/jump_boost effect ids survive a round-trip (additive, no save bump)", () => {
    const storage = memoryStorage();
    const effects = [
      { id: "haste", remaining: 90 },
      { id: "resistance", remaining: 30 },
      { id: "jump_boost", remaining: 45 }
    ] as const;
    writeSave(KEY, { ...sampleSave(), effects: [...effects] }, storage);
    expect(readSave(KEY, storage)!.effects).toEqual([...effects]);
  });
});

describe("v12 to v13 migration & statistics", () => {
  function v12Save(overrides: Partial<SaveDataV12> = {}): SaveDataV12 {
    return {
      version: 12,
      seed: 1337,
      changes: [[42, 0]],
      inventorySlots: [{ id: "dirt", count: 3 }],
      selectedSlot: 0,
      player: { x: 1, y: 2, z: 3 },
      ...overrides
    };
  }

  test("migrateSaveV12toV13 is a pure version bump leaving stats/advancements absent", () => {
    const migrated = migrateSaveV12toV13(v12Save());
    expect(migrated.version).toBe(13);
    expect(migrated.stats).toBeUndefined();
    expect(migrated.advancements).toBeUndefined();
    expect(migrated.changes).toEqual([[42, 0]]);
  });

  test("a pre-progression (v12) save loads with no statistics", () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify(v12Save()) });
    const parsed = readSave(KEY, storage)!;
    expect(parsed.version).toBe(13);
    expect(restoreStats(parsed)).toEqual([]);
  });

  test("serializeStats keeps only positive, finite counters", () => {
    const out = serializeStats(
      new Map([
        ["blocks_mined", 42],
        ["deaths", 0], // zero reads as absent — dropped
        ["play_time", 123.5],
        ["bogus", Number.NaN] // garbage — dropped
      ])
    );
    expect(out).toEqual([
      { id: "blocks_mined", value: 42 },
      { id: "play_time", value: 123.5 }
    ]);
  });

  test("serializeStats / restoreStats round-trip the counters (fractional values preserved)", () => {
    const out = serializeStats(new Map([["distance_walked", 17.25]]));
    expect(restoreStats({ ...sampleSave(), stats: out })).toEqual(out);
  });

  test("restoreStats rejects a non-array and drops non-string ids / negative / garbage values", () => {
    expect(restoreStats({ ...sampleSave(), stats: undefined })).toEqual([]);
    const dirty = [
      { id: "blocks_mined", value: 5 },
      { id: 42, value: 3 }, // non-string id → dropped
      { id: "deaths", value: -1 }, // negative → dropped
      { id: "jumps", value: Number.POSITIVE_INFINITY } // garbage → dropped
    ] as never;
    expect(restoreStats({ ...sampleSave(), stats: dirty })).toEqual([{ id: "blocks_mined", value: 5 }]);
  });

  test("statistics survive a full save round-trip", () => {
    const storage = memoryStorage();
    writeSave(KEY, { ...sampleSave(), stats: [{ id: "fish_caught", value: 9 }] }, storage);
    expect(readSave(KEY, storage)!.stats).toEqual([{ id: "fish_caught", value: 9 }]);
  });

  test("migrateSaveV12toV13 leaves a v12 save with no advancements", () => {
    expect(restoreAdvancements(migrateSaveV12toV13(v12Save()))).toEqual([]);
  });

  test("restoreAdvancements rejects a non-array and drops non-string / empty ids, de-duplicating", () => {
    expect(restoreAdvancements({ ...sampleSave(), advancements: undefined })).toEqual([]);
    const dirty = ["getting_wood", "getting_wood", "", 42, null, "stone_age"] as never;
    expect(restoreAdvancements({ ...sampleSave(), advancements: dirty })).toEqual(["getting_wood", "stone_age"]);
  });

  test("advancements survive a full save round-trip", () => {
    const storage = memoryStorage();
    writeSave(KEY, { ...sampleSave(), advancements: ["diamonds", "dragon_slayer"] }, storage);
    expect(readSave(KEY, storage)!.advancements).toEqual(["diamonds", "dragon_slayer"]);
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

  test("player position is preserved as floats and rejects non-finite coords", () => {
    // Unlike the floored spawn point, the player position keeps its fractional part.
    expect(restorePlayerPosition(base)).toEqual({ x: 100.5, y: 48, z: 200.25 });
    expect(restorePlayerPosition({ ...base, player: { x: 1, y: Number.NaN, z: 3 } })).toBeNull();
    expect(restorePlayerPosition({ ...base, player: { x: 1, y: Number.POSITIVE_INFINITY, z: 3 } })).toBeNull();
    expect(restorePlayerPosition({ ...base, player: undefined as unknown as SaveData["player"] })).toBeNull();
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
    const save = { ...sampleSave(), version: 14 };
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
      { id: "wood_pickaxe", count: 1, durability: 70, enchantments: undefined, customName: undefined },
      { id: "dirt", count: 9, durability: undefined, enchantments: undefined, customName: undefined },
      { id: null, count: 0, durability: undefined, enchantments: undefined, customName: undefined }
    ]);
    // Definition-derived fields (label, attack, minePower…) must not be persisted.
    expect(Object.keys(snapshot[0]).sort()).toEqual(["count", "customName", "durability", "enchantments", "id"]);
  });
});
