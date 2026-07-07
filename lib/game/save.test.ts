import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { CUSTOM_NAME_MAX_LEN, ENCHANT_MAX_LEVEL, INVENTORY_SLOTS, WORLDGEN_VERSION } from "@/lib/game/config";
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
  migrateSaveV13toV14,
  migrateSaveV14toV15,
  migrateSaveV15toV16,
  migrateSaveV16toV17,
  migrateSaveV17toV18,
  applyWorldgenGuard,
  dimensionSectionOf,
  restorePlayerDimension,
  restorePortalArrival,
  isPersistentMob,
  parseSave,
  readContainers,
  readLootedChests,
  readSave,
  restoreMobs,
  serializeMobs,
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
  restoreVehicles,
  restoreXp,
  serializeContainers,
  serializeEffects,
  serializeLootedChests,
  serializeStats,
  serializeVehicles,
  writeSave
} from "@/lib/game/save";
import { createSlot, createEmptySlot } from "@/lib/game/items";
import type {
  DimensionSection,
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
  SaveDataV12,
  SaveDataV13,
  SaveDataV14,
  SaveDataV15,
  SaveDataV16,
  SavedMob,
  SavedPlayer
} from "@/lib/game/types";
import type { MobState } from "@/lib/game/engine/state";

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

/** The flat pre-v17 shape — kept flat so round-trips exercise the v16→v17 players migration. */
function sampleSaveV16(): SaveDataV16 {
  return {
    version: 16,
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

/** The v17 player entry equivalent to sampleSaveV16's flat per-player fields. */
function samplePlayer(): SavedPlayer {
  return {
    id: "local",
    position: { x: 100.5, y: 48, z: 200.25 },
    inventorySlots: [
      { id: "dirt", count: 12 },
      { id: "wood_pickaxe", count: 1, durability: 35 },
      { id: null, count: 0 }
    ],
    equippedArmor: { helmet: { id: "helmet", count: 1 } },
    selectedSlot: 2,
    gameMode: "creative",
    hearts: 14,
    hunger: 9,
    spawnPoint: { x: 10, y: 40, z: 20 },
    stats: [
      { id: "blocks_mined", value: 42 },
      { id: "play_time", value: 123.5 }
    ],
    advancements: ["getting_wood", "stone_age"]
  };
}

/** The current (v18) shape - what sampleSaveV16 migrates to, one version stamp later. */
function sampleSave(): SaveData {
  return {
    version: 18,
    difficulty: "hard",
    seed: 1337,
    changes: [
      [42, 0],
      [99, 3]
    ],
    dayClock: 123.5,
    lootedChests: [100, 200],
    players: [samplePlayer()]
  };
}

/** Persists a flat pre-v17 save so a subsequent readSave has to run the players migration. */
function writeSaveV16(storage: Storage, save: SaveDataV16): void {
  writeSave(KEY, save as unknown as SaveData, storage);
}

describe("save round-trip", () => {
  test("writeSave then readSave preserves every field", () => {
    const storage = memoryStorage();
    writeSave(KEY, sampleSave(), storage);
    expect(readSave(KEY, storage)).toEqual(sampleSave());
  });

  test("a stored flat v16 save reads back as the migrated current shape", () => {
    const storage = memoryStorage();
    writeSaveV16(storage, sampleSaveV16());
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
    expect(parsed!.version).toBe(18);
    expect(parsed!.inventoryCounts).toEqual({ dirt: 30, stone: 5 });
    expect(parsed!.players[0].inventorySlots).toBeUndefined();
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
    expect(parsed!.version).toBe(18); // chained v1 -> v2 -> … -> v17 -> v18
    expect(parsed!.players[0].selectedSlot).toBe(8); // hotbar shrank from 10 to 9 slots
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

  test("readSave migrates a v2 save through to the current version", () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify(v2Save()) });
    const parsed = readSave(KEY, storage);
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(18);
  });

  test("a v3 round-trip preserves the new stat/clock/spawn fields", () => {
    const storage = memoryStorage();
    writeSaveV16(storage, sampleSaveV16());
    const parsed = readSave(KEY, storage)!;
    expect(parsed.dayClock).toBe(123.5);
    expect(parsed.players[0].hearts).toBe(14);
    expect(parsed.players[0].hunger).toBe(9);
    expect(parsed.players[0].spawnPoint).toEqual({ x: 10, y: 40, z: 20 });
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
    expect(parsed.version).toBe(18);
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
    const save: SaveDataV16 = { ...sampleSaveV16(), blockEntities: serializeContainers(new Map([[100, slots]])) };
    const storage = memoryStorage();
    writeSaveV16(storage, save);
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
    expect(parsed.version).toBe(18);
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
    writeSaveV16(storage, sampleSaveV16());
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
    expect(parsed.version).toBe(18);
    expect(restoreEffects(parsed.players[0])).toEqual([]);
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
    expect(parsed.version).toBe(18);
    expect(restoreGameMode(parsed.players[0])).toBe("survival");
  });

  test("restoreGameMode reads a valid mode and rejects garbage", () => {
    expect(restoreGameMode({ ...samplePlayer(), gameMode: "spectator" })).toBe("spectator");
    expect(restoreGameMode({ ...samplePlayer(), gameMode: "bogus" })).toBe("survival");
    expect(restoreGameMode({ ...samplePlayer(), gameMode: undefined })).toBe("survival");
  });

  test("gameMode survives a full save round-trip", () => {
    const storage = memoryStorage();
    writeSaveV16(storage, { ...sampleSaveV16(), gameMode: "adventure" });
    expect(readSave(KEY, storage)!.players[0].gameMode).toBe("adventure");
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
    expect(parsed.version).toBe(18);
    expect(restoreDifficulty(parsed)).toBe("normal");
  });

  test("restoreDifficulty reads a valid level and rejects garbage", () => {
    expect(restoreDifficulty({ ...sampleSave(), difficulty: "peaceful" })).toBe("peaceful");
    expect(restoreDifficulty({ ...sampleSave(), difficulty: "bogus" as never })).toBe("normal");
    expect(restoreDifficulty({ ...sampleSave(), difficulty: undefined })).toBe("normal");
  });

  test("difficulty survives a full save round-trip", () => {
    const storage = memoryStorage();
    writeSaveV16(storage, { ...sampleSaveV16(), difficulty: "easy" });
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
    expect(parsed.version).toBe(18);
    expect(restoreHardcore(parsed)).toBe(false);
    expect(restoreGameOver(parsed, parsed.players[0])).toBe(false);
  });

  test("restoreHardcore/restoreGameOver read true and coerce garbage to false", () => {
    expect(restoreHardcore({ ...sampleSave(), hardcore: true })).toBe(true);
    expect(restoreHardcore({ ...sampleSave(), hardcore: undefined })).toBe(false);
    expect(restoreHardcore({ ...sampleSave(), hardcore: 1 as never })).toBe(false);
    expect(restoreGameOver({ hardcore: true }, { ...samplePlayer(), gameOver: true })).toBe(true);
    expect(restoreGameOver({ hardcore: true }, { ...samplePlayer(), gameOver: undefined })).toBe(false);
    // gameOver only ever lands on a hardcore save — a stray flag on a non-hardcore
    // (corrupt) save must not lock it into spectator.
    expect(restoreGameOver({ hardcore: false }, { ...samplePlayer(), gameOver: true })).toBe(false);
  });

  test("hardcore + gameOver survive a full save round-trip", () => {
    const storage = memoryStorage();
    writeSaveV16(storage, { ...sampleSaveV16(), hardcore: true, gameOver: true });
    const parsed = readSave(KEY, storage)!;
    expect(parsed.hardcore).toBe(true);
    expect(parsed.players[0].gameOver).toBe(true);
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
    const save: SaveDataV16 = {
      ...sampleSaveV16(),
      equippedArmor: { chestplate: { id: "chestplate", count: 1, durability: 100, enchantments: [{ id: "protection", level: 1 }] } }
    };
    writeSaveV16(storage, save);
    const restored = restoreEquippedArmor(readSave(KEY, storage)!.players[0])!;
    expect(restored.chestplate?.durability).toBe(100);
    expect(restored.chestplate?.enchantments).toEqual([{ id: "protection", level: 1 }]);
  });

  test("a custom name survives a full save round-trip on durable gear", () => {
    const storage = memoryStorage();
    const save: SaveDataV16 = {
      ...sampleSaveV16(),
      inventorySlots: [{ id: "diamond_sword", count: 1, durability: 700, customName: "Excalibur" }]
    };
    writeSaveV16(storage, save);
    expect(readSave(KEY, storage)!.players[0].inventorySlots?.[0].customName).toBe("Excalibur");
  });

  test("restoreInventorySlots trims and caps a custom name, drops blanks, and ignores names on non-durable items", () => {
    const dirty: SavedPlayer = {
      ...samplePlayer(),
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
    expect(restoreXp({ ...samplePlayer(), xp: 42.9 })).toBe(42);
    expect(restoreXp({ ...samplePlayer(), xp: -5 })).toBe(0);
    expect(restoreXp({ ...samplePlayer(), xp: Number.NaN })).toBe(0);
    expect(restoreXp({ ...samplePlayer(), xp: undefined })).toBe(0);
  });

  test("xp and per-slot enchantments survive a full save round-trip", () => {
    const storage = memoryStorage();
    const save: SaveDataV16 = {
      ...sampleSaveV16(),
      xp: 57,
      inventorySlots: [{ id: "diamond_sword", count: 1, durability: 700, enchantments: [{ id: "sharpness", level: 2 }] }]
    };
    writeSaveV16(storage, save);
    const parsed = readSave(KEY, storage)!;
    expect(parsed.players[0].xp).toBe(57);
    expect(parsed.players[0].inventorySlots?.[0].enchantments).toEqual([{ id: "sharpness", level: 2 }]);
  });

  test("a bow's Power and Punch enchantments survive a full save round-trip", () => {
    const storage = memoryStorage();
    const save: SaveDataV16 = {
      ...sampleSaveV16(),
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
    writeSaveV16(storage, save);
    const parsed = readSave(KEY, storage)!;
    expect(parsed.players[0].inventorySlots?.[0].enchantments).toEqual([
      { id: "power", level: 3 },
      { id: "punch", level: 1 }
    ]);
  });

  test("restoreInventorySlots drops unknown enchant ids and clamps levels; non-durable items carry none", () => {
    const dirty: SavedPlayer = {
      ...samplePlayer(),
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
    const dirty: SavedPlayer = {
      ...samplePlayer(),
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
    expect(restoreEffects({ ...samplePlayer(), effects: out })).toEqual(out);
  });

  test("restoreEffects drops unknown ids and non-positive / garbage durations", () => {
    const dirty = [
      { id: "speed", remaining: 30 },
      { id: "not_an_effect", remaining: 10 },
      { id: "toString", remaining: 5 }, // a prototype key must not slip through
      { id: "poison", remaining: 0 },
      { id: "strength", remaining: Number.NaN }
    ] as never;
    expect(restoreEffects({ ...samplePlayer(), effects: dirty })).toEqual([{ id: "speed", remaining: 30 }]);
    expect(restoreEffects({ ...samplePlayer(), effects: undefined })).toEqual([]);
  });

  test("active effects survive a full save round-trip", () => {
    const storage = memoryStorage();
    writeSaveV16(storage, { ...sampleSaveV16(), effects: [{ id: "regeneration", remaining: 12 }] });
    expect(readSave(KEY, storage)!.players[0].effects).toEqual([{ id: "regeneration", remaining: 12 }]);
  });

  test("the new haste/resistance/jump_boost effect ids survive a round-trip (additive, no save bump)", () => {
    const storage = memoryStorage();
    const effects = [
      { id: "haste", remaining: 90 },
      { id: "resistance", remaining: 30 },
      { id: "jump_boost", remaining: 45 }
    ] as const;
    writeSaveV16(storage, { ...sampleSaveV16(), effects: [...effects] });
    expect(readSave(KEY, storage)!.players[0].effects).toEqual([...effects]);
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
    expect(parsed.version).toBe(18);
    expect(restoreStats(parsed.players[0])).toEqual([]);
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
    expect(restoreStats({ ...samplePlayer(), stats: out })).toEqual(out);
  });

  test("restoreStats rejects a non-array and drops non-string ids / negative / garbage values", () => {
    expect(restoreStats({ ...samplePlayer(), stats: undefined })).toEqual([]);
    const dirty = [
      { id: "blocks_mined", value: 5 },
      { id: 42, value: 3 }, // non-string id → dropped
      { id: "deaths", value: -1 }, // negative → dropped
      { id: "jumps", value: Number.POSITIVE_INFINITY } // garbage → dropped
    ] as never;
    expect(restoreStats({ ...samplePlayer(), stats: dirty })).toEqual([{ id: "blocks_mined", value: 5 }]);
  });

  test("statistics survive a full save round-trip", () => {
    const storage = memoryStorage();
    writeSaveV16(storage, { ...sampleSaveV16(), stats: [{ id: "fish_caught", value: 9 }] });
    expect(readSave(KEY, storage)!.players[0].stats).toEqual([{ id: "fish_caught", value: 9 }]);
  });

  test("migrateSaveV12toV13 leaves a v12 save with no advancements", () => {
    const chained = migrateSaveV16toV17(migrateSaveV15toV16(migrateSaveV14toV15(migrateSaveV13toV14(migrateSaveV12toV13(v12Save())))));
    expect(restoreAdvancements(chained.players[0])).toEqual([]);
  });

  test("restoreAdvancements rejects a non-array and drops non-string / empty ids, de-duplicating", () => {
    expect(restoreAdvancements({ ...samplePlayer(), advancements: undefined })).toEqual([]);
    const dirty = ["getting_wood", "getting_wood", "", 42, null, "stone_age"] as never;
    expect(restoreAdvancements({ ...samplePlayer(), advancements: dirty })).toEqual(["getting_wood", "stone_age"]);
  });

  test("advancements survive a full save round-trip", () => {
    const storage = memoryStorage();
    writeSaveV16(storage, { ...sampleSaveV16(), advancements: ["diamonds", "dragon_slayer"] });
    expect(readSave(KEY, storage)!.players[0].advancements).toEqual(["diamonds", "dragon_slayer"]);
  });
});

describe("stat restoration helpers", () => {
  const base = samplePlayer();

  test("missing fields restore as null so the engine keeps its defaults", () => {
    const bareWorld: SaveData = { ...sampleSave(), dayClock: undefined };
    const bare: SavedPlayer = { ...base, hearts: undefined, hunger: undefined, spawnPoint: undefined };
    expect(restoreDayClock(bareWorld)).toBeNull();
    expect(restoreHearts(bare)).toBeNull();
    expect(restoreHungerLevel(bare)).toBeNull();
    expect(restoreSpawnPoint(bare)).toBeNull();
  });

  test("out-of-range values are clamped", () => {
    expect(restoreHearts({ ...base, hearts: 999 })).toBe(MAX_HEARTS);
    expect(restoreHearts({ ...base, hearts: 0 })).toBe(1);
    expect(restoreHungerLevel({ ...base, hunger: -5 })).toBe(0);
    expect(restoreHungerLevel({ ...base, hunger: 999 })).toBe(MAX_HUNGER);
    expect(restoreDayClock({ ...sampleSave(), dayClock: -1 })).toBeNull();
    expect(restoreDayClock({ ...sampleSave(), dayClock: Number.NaN })).toBeNull();
  });

  test("spawnPoint floors coordinates and rejects malformed points", () => {
    expect(restoreSpawnPoint({ ...base, spawnPoint: { x: 5.9, y: 40.2, z: 20.7 } })).toEqual({ x: 5, y: 40, z: 20 });
    expect(restoreSpawnPoint({ ...base, spawnPoint: null })).toBeNull();
  });

  test("player position is preserved as floats and rejects non-finite coords", () => {
    // Unlike the floored spawn point, the player position keeps its fractional part.
    expect(restorePlayerPosition(base)).toEqual({ x: 100.5, y: 48, z: 200.25 });
    expect(restorePlayerPosition({ ...base, position: { x: 1, y: Number.NaN, z: 3 } })).toBeNull();
    expect(restorePlayerPosition({ ...base, position: { x: 1, y: Number.POSITIVE_INFINITY, z: 3 } })).toBeNull();
    expect(restorePlayerPosition({ ...base, position: undefined })).toBeNull();
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
    const save = { ...sampleSave(), version: 19 };
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

// parseSave takes the decoded object directly (the IndexedDB path — records
// are stored as structured clones, never as JSON strings).
describe("parseSave on decoded objects", () => {
  test("a current v17 object passes through unchanged", () => {
    expect(parseSave(sampleSave())).toEqual(sampleSave());
  });

  test("a flat v16 object migrates to the v17 shape", () => {
    expect(parseSave(sampleSaveV16())).toEqual(sampleSave());
  });

  test("garbage shapes yield null", () => {
    expect(parseSave(undefined)).toBeNull();
    expect(parseSave(null)).toBeNull();
    expect(parseSave(42)).toBeNull();
    expect(parseSave("not a save")).toBeNull();
    expect(parseSave({})).toBeNull();
  });

  test("missing seed or non-array changes yields null", () => {
    expect(parseSave({ ...sampleSave(), seed: "abc" })).toBeNull();
    expect(parseSave({ ...sampleSave(), changes: {} })).toBeNull();
  });

  test("unknown future version yields null", () => {
    expect(parseSave({ ...sampleSave(), version: 19 })).toBeNull();
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

describe("v13 to v14 migration & mob persistence", () => {
  function v13Save(overrides: Partial<SaveDataV13> = {}): SaveDataV13 {
    return {
      version: 13,
      seed: 1337,
      changes: [[42, 0]],
      inventorySlots: [{ id: "dirt", count: 3 }],
      selectedSlot: 0,
      player: { x: 1, y: 2, z: 3 },
      ...overrides
    };
  }

  // A minimal live MobState; a "pet" is just one carrying owner (kind is irrelevant
  // to the persistence machinery — wolf/cat arrive with companions in the next commit).
  function makeMob(overrides: Partial<MobState> = {}): MobState {
    return {
      id: 1,
      kind: "sheep",
      hostile: false,
      faction: "wild",
      targetId: null,
      retargetTimer: 0,
      hp: 8,
      position: new THREE.Vector3(20.5, 33, 41.25),
      direction: new THREE.Vector3(0, 0, 1),
      yaw: 0,
      turnTimer: 0,
      speed: 1,
      moveSpeed: 1,
      detectRange: 0,
      attackDamage: 0,
      attackCooldown: 0,
      attackTimer: 0,
      halfHeight: 0.5,
      bobSeed: 0,
      fedTimer: 0,
      ageTimer: 0,
      ...overrides
    };
  }

  test("migrateSaveV13toV14 is a pure version bump leaving mobs absent", () => {
    const migrated = migrateSaveV13toV14(v13Save());
    expect(migrated.version).toBe(14);
    expect(migrated.mobs).toBeUndefined();
    expect(migrated.changes).toEqual([[42, 0]]);
  });

  test("a pre-mob (v13) save loads with no persisted mobs", () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify(v13Save()) });
    const parsed = readSave(KEY, storage)!;
    expect(parsed.version).toBe(18);
    expect(restoreMobs(parsed)).toEqual([]);
  });

  test("isPersistentMob keeps owned pets and village residents, not the fungible population", () => {
    expect(isPersistentMob(makeMob({ owner: "player", faction: "ally" }))).toBe(true); // pet
    expect(isPersistentMob(makeMob({ kind: "villager", faction: "villager" }))).toBe(true); // village resident
    expect(isPersistentMob(makeMob({ faction: "wild" }))).toBe(false);
    expect(isPersistentMob(makeMob({ hostile: true, faction: "hostile" }))).toBe(false);
  });

  test("serializeMobs captures only persistent mobs and their state", () => {
    const pet = makeMob({ owner: "player", faction: "ally", sitting: true, hp: 18, position: new THREE.Vector3(5.5, 30, 6.5) });
    const wild = makeMob({ id: 2, faction: "wild" });
    expect(serializeMobs([pet, wild])).toEqual([{ kind: "sheep", x: 5.5, y: 30, z: 6.5, hp: 18, faction: "ally", owner: "player", sitting: true }]);
  });

  test("serializeMobs / restoreMobs round-trip a pet (incl. a baby's ageTimer)", () => {
    const pet = makeMob({ owner: "player", faction: "ally", hp: 12, ageTimer: 45, position: new THREE.Vector3(7, 31, 8) });
    const saved = serializeMobs([pet]);
    expect(restoreMobs({ ...sampleSave(), mobs: saved })).toEqual([
      { kind: "sheep", x: 7, y: 31, z: 8, hp: 12, faction: "ally", owner: "player", ageTimer: 45 }
    ]);
  });

  test("restoreMobs drops unknown kinds, bad coords/hp, and non-pet entries", () => {
    const dirty = [
      { kind: "dragon", x: 1, y: 1, z: 1, hp: 5, faction: "ally", owner: "player" }, // unknown kind
      { kind: "wolf", x: Number.NaN, y: 1, z: 1, hp: 5, faction: "ally", owner: "player" }, // bad coord
      { kind: "wolf", x: 1, y: 1, z: 1, hp: 0, faction: "ally", owner: "player" }, // dead
      { kind: "wolf", x: 1, y: 1, z: 1, hp: 5, faction: "wizard", owner: "player" }, // bad faction
      { kind: "wolf", x: 1, y: 1, z: 1, hp: 5, faction: "wild" }, // owner-less / not a pet → dropped
      { kind: "zombie", x: 1, y: 1, z: 1, hp: 5, faction: "hostile", owner: "player" }, // tampered "pet zombie" → dropped
      { kind: "wolf", x: 2, y: 3, z: 4, hp: 5, faction: "ally", owner: "player" } // valid
    ] as unknown as SavedMob[];
    expect(restoreMobs({ ...sampleSave(), mobs: dirty })).toEqual([{ kind: "wolf", x: 2, y: 3, z: 4, hp: 5, faction: "ally", owner: "player" }]);
  });

  test("persisted pets survive a full save round-trip (legacy owner rewritten to local)", () => {
    const storage = memoryStorage();
    const pet = makeMob({ owner: "player", faction: "ally", hp: 16, position: new THREE.Vector3(9, 30, 9) });
    writeSaveV16(storage, { ...sampleSaveV16(), mobs: serializeMobs([pet]) });
    const parsed = readSave(KEY, storage)!;
    // The v16→v17 migration rewrites the legacy owner literal "player" to "local"…
    expect(parsed.mobs).toEqual([{ kind: "sheep", x: 9, y: 30, z: 9, hp: 16, faction: "ally", owner: "local" }]);
    // …and restoreMobs accepts the player-id owner.
    expect(restoreMobs(parsed)).toEqual([{ kind: "sheep", x: 9, y: 30, z: 9, hp: 16, faction: "ally", owner: "local" }]);
  });
});

describe("v14 to v15 migration & villager professions", () => {
  function v14Save(overrides: Partial<SaveDataV14> = {}): SaveDataV14 {
    return {
      version: 14,
      seed: 1337,
      changes: [[42, 0]],
      inventorySlots: [{ id: "dirt", count: 3 }],
      selectedSlot: 0,
      player: { x: 1, y: 2, z: 3 },
      ...overrides
    };
  }

  function resident(profession: string): MobState {
    return {
      id: 1,
      kind: "villager",
      hostile: false,
      faction: "villager",
      profession,
      targetId: null,
      retargetTimer: 0,
      hp: 20,
      position: new THREE.Vector3(8, 30, 9),
      direction: new THREE.Vector3(0, 0, 1),
      yaw: 0,
      turnTimer: 0,
      speed: 0.6,
      moveSpeed: 0.6,
      detectRange: 0,
      attackDamage: 0,
      attackCooldown: 0,
      attackTimer: 0,
      halfHeight: 0.9,
      bobSeed: 0,
      fedTimer: 0,
      ageTimer: 0
    } as unknown as MobState;
  }

  test("migrateSaveV14toV15 is a pure version bump", () => {
    const migrated = migrateSaveV14toV15(v14Save());
    expect(migrated.version).toBe(15);
    expect(migrated.changes).toEqual([[42, 0]]);
  });

  test("a village resident's profession round-trips through serialize/restore", () => {
    const saved = serializeMobs([resident("librarian")]);
    expect(saved).toEqual([{ kind: "villager", x: 8, y: 30, z: 9, hp: 20, faction: "villager", profession: "librarian" }]);
    expect(restoreMobs({ ...sampleSave(), mobs: saved })).toEqual([
      { kind: "villager", x: 8, y: 30, z: 9, hp: 20, faction: "villager", profession: "librarian" }
    ]);
  });

  test("restoreMobs drops an invalid profession but keeps the resident professionless", () => {
    const dirty = [{ kind: "villager", x: 1, y: 1, z: 1, hp: 20, faction: "villager", profession: "wizard" }] as unknown as SavedMob[];
    expect(restoreMobs({ ...sampleSave(), mobs: dirty })).toEqual([{ kind: "villager", x: 1, y: 1, z: 1, hp: 20, faction: "villager" }]);
  });
});

describe("v15 to v16 migration & vehicles", () => {
  function v15Save(overrides: Partial<SaveDataV15> = {}): SaveDataV15 {
    return {
      version: 15,
      seed: 1337,
      changes: [[42, 0]],
      inventorySlots: [{ id: "dirt", count: 3 }],
      selectedSlot: 0,
      player: { x: 1, y: 2, z: 3 },
      ...overrides
    };
  }

  test("migrateSaveV15toV16 is a pure version bump", () => {
    const migrated = migrateSaveV15toV16(v15Save());
    expect(migrated.version).toBe(16);
    expect(migrated.vehicles).toBeUndefined();
    expect(migrated.changes).toEqual([[42, 0]]);
  });

  test("serializeVehicles / restoreVehicles round-trip placed vehicles", () => {
    const saved = serializeVehicles([
      { kind: "raft", position: new THREE.Vector3(4.5, 10, 7.5), yaw: 1.2 },
      { kind: "minecart", position: new THREE.Vector3(8.5, 12.1, 3.5), yaw: 0 }
    ]);
    expect(saved).toEqual([
      { kind: "raft", x: 4.5, y: 10, z: 7.5, yaw: 1.2 },
      { kind: "minecart", x: 8.5, y: 12.1, z: 3.5, yaw: 0 }
    ]);
    expect(restoreVehicles({ ...sampleSave(), vehicles: saved })).toEqual(saved);
  });

  test("restoreVehicles drops unknown kinds and bad poses", () => {
    const dirty = [
      { kind: "canoe", x: 1, y: 2, z: 3, yaw: 0 },
      { kind: "ship", x: Number.NaN, y: 2, z: 3, yaw: 0 },
      { kind: "raft", x: 1, y: 2, z: 3, yaw: Number.POSITIVE_INFINITY },
      { kind: "ship", x: 4, y: 5, z: 6, yaw: 0.5 }
    ] as never;
    expect(restoreVehicles({ ...sampleSave(), vehicles: dirty })).toEqual([{ kind: "ship", x: 4, y: 5, z: 6, yaw: 0.5 }]);
  });

  test("vehicles survive a full save round-trip", () => {
    const storage = memoryStorage();
    const vehicles = [{ kind: "ship" as const, x: 9.5, y: 20, z: 12.5, yaw: -0.25 }];
    writeSaveV16(storage, { ...sampleSaveV16(), vehicles });
    expect(readSave(KEY, storage)!.vehicles).toEqual(vehicles);
  });
});

describe("v16 to v17 migration & the players array", () => {
  test("migrateSaveV16toV17 wraps every flat player field into players[0], renaming player to position", () => {
    const v16: SaveDataV16 = {
      ...sampleSaveV16(),
      hardcore: true,
      gameOver: true,
      effects: [{ id: "speed", remaining: 30 }],
      xp: 57
    };
    const migrated = migrateSaveV16toV17(v16);
    expect(migrated.version).toBe(17);
    expect(migrated.players).toHaveLength(1);
    const local = migrated.players[0];
    expect(local.id).toBe("local");
    expect(local.position).toEqual({ x: 100.5, y: 48, z: 200.25 }); // the v16 `player` field, renamed
    expect(local.inventorySlots).toEqual(v16.inventorySlots);
    expect(local.equippedArmor).toEqual({ helmet: { id: "helmet", count: 1 } });
    expect(local.selectedSlot).toBe(2);
    expect(local.gameMode).toBe("creative");
    expect(local.gameOver).toBe(true);
    expect(local.hearts).toBe(14);
    expect(local.hunger).toBe(9);
    expect(local.effects).toEqual([{ id: "speed", remaining: 30 }]);
    expect(local.xp).toBe(57);
    expect(local.stats).toEqual([
      { id: "blocks_mined", value: 42 },
      { id: "play_time", value: 123.5 }
    ]);
    expect(local.advancements).toEqual(["getting_wood", "stone_age"]);
    expect(local.spawnPoint).toEqual({ x: 10, y: 40, z: 20 });
    // World-level fields stay at the top level…
    expect(migrated.seed).toBe(1337);
    expect(migrated.difficulty).toBe("hard");
    expect(migrated.hardcore).toBe(true);
    expect(migrated.dayClock).toBe(123.5);
    expect(migrated.lootedChests).toEqual([100, 200]);
    expect(migrated.changes).toEqual([
      [42, 0],
      [99, 3]
    ]);
    // …and the flat per-player fields do not survive as top-level keys.
    expect("player" in migrated).toBe(false);
    expect("inventorySlots" in migrated).toBe(false);
    expect("hearts" in migrated).toBe(false);
    expect("gameOver" in migrated).toBe(false);
  });

  test("migrateSaveV16toV17 rewrites a pet's legacy owner literal player to local, leaving residents alone", () => {
    const v16: SaveDataV16 = {
      ...sampleSaveV16(),
      mobs: [
        { kind: "wolf", x: 2, y: 3, z: 4, hp: 5, faction: "ally", owner: "player", sitting: true },
        { kind: "villager", x: 8, y: 30, z: 9, hp: 20, faction: "villager" }
      ]
    };
    const migrated = migrateSaveV16toV17(v16);
    expect(migrated.mobs).toEqual([
      { kind: "wolf", x: 2, y: 3, z: 4, hp: 5, faction: "ally", owner: "local", sitting: true },
      { kind: "villager", x: 8, y: 30, z: 9, hp: 20, faction: "villager" }
    ]);
  });

  test("readSave chains a stored v15 save all the way to v17", () => {
    const v15: SaveDataV15 = {
      version: 15,
      seed: 1337,
      changes: [[42, 0]],
      inventorySlots: [{ id: "dirt", count: 3 }],
      selectedSlot: 0,
      player: { x: 1, y: 2, z: 3 }
    };
    const storage = memoryStorage({ [KEY]: JSON.stringify(v15) });
    const parsed = readSave(KEY, storage);
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(18);
    expect(parsed!.players).toHaveLength(1);
    expect(parsed!.players[0].id).toBe("local");
    expect(parsed!.players[0].position).toEqual({ x: 1, y: 2, z: 3 });
    expect(parsed!.players[0].inventorySlots).toEqual([{ id: "dirt", count: 3 }]);
    expect(parsed!.players[0].selectedSlot).toBe(0);
  });

  test("readSave rejects a v17 save missing its players array", () => {
    const noPlayers = { ...sampleSave(), players: undefined }; // JSON.stringify drops the key entirely
    expect(readSave(KEY, memoryStorage({ [KEY]: JSON.stringify(noPlayers) }))).toBeNull();
  });
});

describe("save v18 — dimensions & the worldgen guard", () => {
  test("migrateSaveV17toV18 is a pure version bump: no stamp, no dimensions", () => {
    const v17 = { ...sampleSave(), version: 17 } as unknown as Parameters<typeof migrateSaveV17toV18>[0];
    const migrated = migrateSaveV17toV18(v17);
    expect(migrated.version).toBe(18);
    expect(migrated.worldgenVersion).toBeUndefined(); // grandfathered — the guard stays inert
    expect(migrated.dimensions).toBeUndefined();
    expect(migrated.seed).toBe(1337);
    expect(migrated.players).toEqual(v17.players);
  });

  test("applyWorldgenGuard is a no-op without a stamp and with a matching stamp", () => {
    const unstamped = sampleSave();
    expect(applyWorldgenGuard(unstamped)).toBe(unstamped); // same reference — untouched

    const stamped = { ...sampleSave(), worldgenVersion: WORLDGEN_VERSION };
    expect(applyWorldgenGuard(stamped)).toBe(stamped);
  });

  test("applyWorldgenGuard on a mismatched stamp discards every dimension's world half but keeps the players", () => {
    const stale: SaveData = {
      ...sampleSave(),
      worldgenVersion: WORLDGEN_VERSION + 1,
      blockEntities: [{ index: 42, slots: [{ id: "dirt", count: 3 }] }],
      mobs: [{ kind: "wolf", x: 1, y: 2, z: 3, hp: 5, faction: "ally", owner: "local" }],
      vehicles: [{ kind: "raft", x: 1, y: 2, z: 3, yaw: 0 }],
      villagesSeeded: true,
      dimensions: { nether: { changes: [[7, 90]] } }
    };
    const guarded = applyWorldgenGuard(stale);
    expect(guarded.changes).toEqual([]);
    expect(guarded.blockEntities).toBeUndefined();
    expect(guarded.lootedChests).toBeUndefined();
    expect(guarded.mobs).toBeUndefined();
    expect(guarded.vehicles).toBeUndefined();
    expect(guarded.dimensions).toBeUndefined();
    expect(guarded.villagesSeeded).toBeUndefined(); // villages repopulate on the regenerated terrain
    expect(guarded.players).toEqual(stale.players); // inventory/xp/advancements survive
    expect(guarded.seed).toBe(stale.seed); // the world reboots from its own seed
  });

  test("dimensionSectionOf maps the overworld to the top level and other dimensions to their section", () => {
    const nether: DimensionSection = { changes: [[7, 92]], lootedChests: [9] };
    const save: SaveData = { ...sampleSave(), dimensions: { nether } };
    const over = dimensionSectionOf(save, "overworld");
    expect(over.changes).toBe(save.changes);
    expect(over.lootedChests).toBe(save.lootedChests);
    expect(dimensionSectionOf(save, "nether")).toBe(nether);
    // A never-visited dimension reads as an empty section.
    expect(dimensionSectionOf(sampleSave(), "nether")).toEqual({ changes: [] });
  });

  test("restorePlayerDimension defaults to overworld and rejects unknown ids", () => {
    expect(restorePlayerDimension({ id: "local" })).toBe("overworld");
    expect(restorePlayerDimension({ id: "local", dimension: "nether" })).toBe("nether");
    expect(restorePlayerDimension({ id: "local", dimension: "the_end" as never })).toBe("overworld");
  });

  test("restorePortalArrival floors finite coords and rejects garbage", () => {
    expect(restorePortalArrival({ id: "local" })).toBeNull();
    expect(restorePortalArrival({ id: "local", portalArrival: { x: 1.9, y: 40.2, z: -3.5 } })).toEqual({ x: 1, y: 40, z: -4 });
    expect(restorePortalArrival({ id: "local", portalArrival: { x: NaN, y: 1, z: 1 } })).toBeNull();
  });

  test("a v18 save with dimensions round-trips writeSave/readSave verbatim", () => {
    const save: SaveData = {
      ...sampleSave(),
      worldgenVersion: WORLDGEN_VERSION,
      dimensions: { nether: { changes: [[7, 92]], lootedChests: [9] } },
      players: [{ ...samplePlayer(), dimension: "nether", portalArrival: { x: 10, y: 40, z: 12 } }]
    };
    const storage = memoryStorage();
    writeSave(KEY, save, storage);
    expect(readSave(KEY, storage)).toEqual(save);
  });
});
