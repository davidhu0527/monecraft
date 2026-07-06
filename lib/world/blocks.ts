export const WORLD_SIZE_X = 512;
export const WORLD_SIZE_Y = 150;
export const WORLD_SIZE_Z = 512;

export const enum BlockId {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Wood = 4,
  Leaves = 5,
  Bedrock = 6,
  Planks = 7,
  Cobblestone = 8,
  Sand = 9,
  Brick = 10,
  Glass = 11,
  SliverOre = 12,
  RubyOre = 13,
  GoldOre = 14,
  SapphireOre = 15,
  DiamondOre = 16,
  Water = 17,
  Snow = 18,
  Cactus = 19,
  Bed = 20,
  Farmland = 21,
  // Wheat growth stages — consecutive ids so a crop advances by +1 (see randomTicks.ts).
  WheatStage0 = 22,
  WheatStage1 = 23,
  WheatStage2 = 24,
  WheatStage3 = 25,
  Furnace = 26,
  Chest = 27,
  // Dungeon blocks (worldgen-only flavor + the spawner block-entity marker).
  MossyCobblestone = 28,
  Spawner = 29,
  // Wood doors — 16 contiguous ids (4 facings × open/closed × lower/upper).
  // doors.ts derives state by offset from DoorNorthLower, so keep them in order.
  DoorNorthLower = 30,
  DoorNorthUpper = 31,
  DoorEastLower = 32,
  DoorEastUpper = 33,
  DoorSouthLower = 34,
  DoorSouthUpper = 35,
  DoorWestLower = 36,
  DoorWestUpper = 37,
  DoorNorthOpenLower = 38,
  DoorNorthOpenUpper = 39,
  DoorEastOpenLower = 40,
  DoorEastOpenUpper = 41,
  DoorSouthOpenLower = 42,
  DoorSouthOpenUpper = 43,
  DoorWestOpenLower = 44,
  DoorWestOpenUpper = 45,
  // A placeable light source: a solid block that emits block light (see lighting.ts).
  Torch = 46,
  // A worldgen-only hazard: a solid, unmineable block that emits max block light
  // and burns the player on contact (see lighting.ts, playerStats.ts).
  Lava = 47,
  // A shallow, common ore: mineable with a wood pickaxe, drops coal (furnace fuel).
  CoalOre = 48,
  // A placeable explosive: right-click with a torch to ignite a fuse, then it blows.
  Tnt = 49,
  // A young tree: plant on grass/dirt, grows into a tree over time (random ticks)
  // or instantly with bone meal. A solid cube like wheat (see atlas.ts).
  Sapling = 50,
  // A crafted station: right-click to open its brewing recipes (potions). Like
  // the furnace, it gates `station: "brewing"` recipes (see interact.ts).
  BrewingStand = 51,
  // A crafted station: right-click to open the enchanting panel, where XP levels
  // are spent to enchant the held tool/weapon/armor (see interact.ts).
  EnchantingTable = 52,
  // A crafted station: right-click to open the anvil panel, where XP levels are
  // spent to repair, combine, or rename the held gear (see interact.ts).
  Anvil = 53,
  // A crafted station: right-click to open the grindstone panel, which strips a
  // held item's enchantments and refunds some XP (see interact.ts).
  Grindstone = 54,
  // Ocean flora. Kelp is a solid cube painted to read as a plant (like wheat)
  // that generates in stalks on the ocean floor and grows upward through water
  // via random ticks; breaking one cell breaks the stalk above it (mining.ts).
  Kelp = 55,
  // Decorative reef blocks scattered on the ocean floor (worldgen only).
  CoralPink = 56,
  CoralBlue = 57,
  // Redstone-lite (see redstone.ts). Power state is id PARITY — even = off,
  // odd = on (`b | 1` / `b & ~1`) — so toggles ride the save diff like doors.
  // Ids 58-67 are floor-mounted "overlays": non-cube, non-colliding shapes
  // meshed via redstoneBounds. The lamp pair is a plain full cube.
  RedstoneWire = 58,
  RedstoneWireOn = 59,
  Lever = 60,
  LeverOn = 61,
  RedstoneButton = 62,
  RedstoneButtonOn = 63,
  PressurePlate = 64,
  PressurePlateOn = 65,
  // The torch item places the LIT variant; the power pass turns it off when
  // its support block is powered (the inverter rule).
  RedstoneTorchOff = 66,
  RedstoneTorch = 67,
  RedstoneLamp = 68,
  RedstoneLampOn = 69,
  // Rails (see rails.ts): flat floor overlays like wire, ridden by minecarts.
  // The powered/detector pairs join the redstone family — power is id PARITY,
  // so each pair MUST start on an even id. Plain Rail carries no power state
  // and must never pass through the redstoneOn/redstoneOff parity math.
  PoweredRail = 70,
  PoweredRailOn = 71,
  DetectorRail = 72,
  DetectorRailOn = 73,
  Rail = 74,
  // Partial building blocks (see slabs.ts). Slabs fill the bottom half of the
  // cell; stairs add a half-height back on the side they FACE, encoded as 4
  // contiguous ids per material (the doors offset-math precedent) in
  // north/east/south/west order — keep them contiguous and in order.
  PlankSlab = 75,
  StoneSlab = 76,
  CobbleSlab = 77,
  PlankStairsNorth = 78,
  PlankStairsEast = 79,
  PlankStairsSouth = 80,
  PlankStairsWest = 81,
  StoneStairsNorth = 82,
  StoneStairsEast = 83,
  StoneStairsSouth = 84,
  StoneStairsWest = 85,
  CobbleStairsNorth = 86,
  CobbleStairsEast = 87,
  CobbleStairsSouth = 88,
  CobbleStairsWest = 89,
  // Volcanic glass, created by quenching lava with a water bucket (interact.ts).
  // The hardest mineable block — diamond-pickaxe-gated (mining.ts) — and the
  // only material a nether portal frame can be built from (portal.ts).
  Obsidian = 90,
  // The lit portal surface filling an obsidian frame (portal.ts). Non-solid
  // (walked into, never collided with), unmineable (the solid raycast passes
  // through it — break the frame instead), emits light, and has no item.
  NetherPortal = 91
}

export enum BiomeId {
  Plains = 0,
  Desert = 1,
  Ocean = 2,
  Forest = 3,
  Mountains = 4
}

// Hex palette tinting the first-person held-item block model. Deliberately a
// different (brighter) palette than BLOCK_COLORS below, which feeds the atlas.
export const HELD_BLOCK_COLORS: Partial<Record<BlockId, number>> = {
  [BlockId.Grass]: 0x5ea74a,
  [BlockId.Dirt]: 0x7f5d3d,
  [BlockId.Stone]: 0x8f9296,
  [BlockId.Wood]: 0x8d653d,
  [BlockId.Planks]: 0xbe965d,
  [BlockId.Cobblestone]: 0x787c82,
  [BlockId.Sand]: 0xd8ca84,
  [BlockId.Brick]: 0xb65448,
  [BlockId.Glass]: 0xaed4dc,
  [BlockId.CoalOre]: 0x4a4a52,
  [BlockId.SliverOre]: 0x9fa3aa,
  [BlockId.RubyOre]: 0xa26464,
  [BlockId.GoldOre]: 0xd9b33b,
  [BlockId.SapphireOre]: 0x3f92d6,
  [BlockId.DiamondOre]: 0x85e9f4,
  [BlockId.Snow]: 0xf2f5fa,
  [BlockId.Cactus]: 0x6aa850,
  [BlockId.Bed]: 0xc0392b,
  [BlockId.Furnace]: 0x63666a,
  [BlockId.Chest]: 0x9c6a3c,
  [BlockId.MossyCobblestone]: 0x6a7a55,
  [BlockId.DoorNorthLower]: 0xa8753f,
  [BlockId.Torch]: 0xffab40,
  [BlockId.Tnt]: 0xc0392b,
  [BlockId.Sapling]: 0x5ea74a,
  [BlockId.BrewingStand]: 0x9a86b6,
  [BlockId.EnchantingTable]: 0x3a2a6a,
  [BlockId.Anvil]: 0x4a4a52,
  [BlockId.Grindstone]: 0x8a7a5c,
  [BlockId.Kelp]: 0x3f7a4a,
  [BlockId.CoralPink]: 0xd9739c,
  [BlockId.CoralBlue]: 0x4f86c8,
  [BlockId.RedstoneWire]: 0xb03a2a,
  [BlockId.Lever]: 0x8a8f96,
  [BlockId.RedstoneButton]: 0x8f9296,
  [BlockId.PressurePlate]: 0xbe965d,
  [BlockId.RedstoneTorch]: 0xe0503a,
  [BlockId.RedstoneLamp]: 0xc9a24a,
  [BlockId.Rail]: 0x8a8f96,
  [BlockId.PoweredRail]: 0xc9a24a,
  [BlockId.DetectorRail]: 0x9fa3aa,
  [BlockId.PlankSlab]: 0xbe965d,
  [BlockId.StoneSlab]: 0x8f9296,
  [BlockId.CobbleSlab]: 0x787c82,
  [BlockId.PlankStairsNorth]: 0xbe965d,
  [BlockId.StoneStairsNorth]: 0x8f9296,
  [BlockId.CobbleStairsNorth]: 0x787c82,
  [BlockId.Obsidian]: 0x241c38
};

export const HELD_BLOCK_FALLBACK_COLOR = 0xbababa;

// Float RGB palette used to paint the procedural texture atlas (see atlas.ts).
// Not to be confused with the hex palette tinting the held-item model.
export const BLOCK_COLORS: Record<number, [number, number, number]> = {
  [BlockId.Grass]: [0.35, 0.68, 0.22],
  [BlockId.Dirt]: [0.46, 0.33, 0.2],
  [BlockId.Stone]: [0.54, 0.56, 0.58],
  [BlockId.Wood]: [0.51, 0.37, 0.19],
  [BlockId.Leaves]: [0.22, 0.5, 0.2],
  [BlockId.Bedrock]: [0.14, 0.14, 0.14],
  [BlockId.Planks]: [0.76, 0.61, 0.38],
  [BlockId.Cobblestone]: [0.42, 0.43, 0.45],
  [BlockId.Sand]: [0.86, 0.8, 0.5],
  [BlockId.Brick]: [0.68, 0.28, 0.2],
  [BlockId.Glass]: [0.73, 0.9, 0.95],
  // Ores share the stone-gray base; their sparkle is painted in the atlas (atlas.ts).
  [BlockId.CoalOre]: [0.54, 0.56, 0.58],
  [BlockId.SliverOre]: [0.54, 0.56, 0.58],
  [BlockId.RubyOre]: [0.54, 0.56, 0.58],
  [BlockId.GoldOre]: [0.54, 0.56, 0.58],
  [BlockId.SapphireOre]: [0.54, 0.56, 0.58],
  [BlockId.DiamondOre]: [0.54, 0.56, 0.58],
  [BlockId.Water]: [0.26, 0.45, 0.78],
  [BlockId.Snow]: [0.92, 0.94, 0.97],
  [BlockId.Cactus]: [0.33, 0.55, 0.27],
  [BlockId.Bed]: [0.72, 0.2, 0.22],
  [BlockId.Farmland]: [0.36, 0.25, 0.16],
  // Wheat ripens green -> gold across the four stages.
  [BlockId.WheatStage0]: [0.4, 0.62, 0.25],
  [BlockId.WheatStage1]: [0.55, 0.66, 0.27],
  [BlockId.WheatStage2]: [0.7, 0.69, 0.29],
  [BlockId.WheatStage3]: [0.82, 0.72, 0.3],
  [BlockId.Furnace]: [0.38, 0.39, 0.41],
  [BlockId.Chest]: [0.58, 0.41, 0.22],
  // Cobble tinted with patches of moss; the spawner is a near-black iron cage.
  [BlockId.MossyCobblestone]: [0.34, 0.42, 0.3],
  [BlockId.Spawner]: [0.18, 0.19, 0.22],
  [BlockId.DoorNorthLower]: [0.62, 0.4, 0.2],
  [BlockId.DoorNorthUpper]: [0.62, 0.4, 0.2],
  [BlockId.DoorEastLower]: [0.62, 0.4, 0.2],
  [BlockId.DoorEastUpper]: [0.62, 0.4, 0.2],
  [BlockId.DoorSouthLower]: [0.62, 0.4, 0.2],
  [BlockId.DoorSouthUpper]: [0.62, 0.4, 0.2],
  [BlockId.DoorWestLower]: [0.62, 0.4, 0.2],
  [BlockId.DoorWestUpper]: [0.62, 0.4, 0.2],
  [BlockId.DoorNorthOpenLower]: [0.62, 0.4, 0.2],
  [BlockId.DoorNorthOpenUpper]: [0.62, 0.4, 0.2],
  [BlockId.DoorEastOpenLower]: [0.62, 0.4, 0.2],
  [BlockId.DoorEastOpenUpper]: [0.62, 0.4, 0.2],
  [BlockId.DoorSouthOpenLower]: [0.62, 0.4, 0.2],
  [BlockId.DoorSouthOpenUpper]: [0.62, 0.4, 0.2],
  [BlockId.DoorWestOpenLower]: [0.62, 0.4, 0.2],
  [BlockId.DoorWestOpenUpper]: [0.62, 0.4, 0.2],
  [BlockId.Torch]: [0.9, 0.6, 0.25],
  [BlockId.Lava]: [0.85, 0.3, 0.08],
  [BlockId.Tnt]: [0.8, 0.22, 0.16],
  // A leafy green sprout with a hint of stem (painted in atlas.ts).
  [BlockId.Sapling]: [0.28, 0.52, 0.22],
  // A purple-grey stone base with a glowing rod (painted in atlas.ts).
  [BlockId.BrewingStand]: [0.5, 0.46, 0.58],
  // An obsidian-dark base topped with a glowing arcane book (painted in atlas.ts).
  [BlockId.EnchantingTable]: [0.16, 0.12, 0.26],
  // A dark iron block with a lighter worktop face (painted in atlas.ts).
  [BlockId.Anvil]: [0.27, 0.28, 0.31],
  // A stone wheel on a wooden frame (painted in atlas.ts).
  [BlockId.Grindstone]: [0.5, 0.43, 0.32],
  // A dark sea-green stalk with paler fronds (painted in atlas.ts).
  [BlockId.Kelp]: [0.16, 0.4, 0.24],
  // Reef corals: a branching pattern over the base color (painted in atlas.ts).
  [BlockId.CoralPink]: [0.8, 0.42, 0.58],
  [BlockId.CoralBlue]: [0.28, 0.5, 0.76],
  // Redstone components (painted in atlas.ts); the on variants glow brighter.
  [BlockId.RedstoneWire]: [0.35, 0.1, 0.08],
  [BlockId.RedstoneWireOn]: [0.75, 0.16, 0.1],
  [BlockId.Lever]: [0.45, 0.46, 0.48],
  [BlockId.LeverOn]: [0.45, 0.46, 0.48],
  [BlockId.RedstoneButton]: [0.5, 0.52, 0.54],
  [BlockId.RedstoneButtonOn]: [0.44, 0.46, 0.48],
  [BlockId.PressurePlate]: [0.7, 0.56, 0.35],
  [BlockId.PressurePlateOn]: [0.62, 0.5, 0.31],
  [BlockId.RedstoneTorchOff]: [0.3, 0.12, 0.1],
  [BlockId.RedstoneTorch]: [0.8, 0.22, 0.14],
  [BlockId.RedstoneLamp]: [0.45, 0.35, 0.2],
  [BlockId.RedstoneLampOn]: [0.95, 0.78, 0.4],
  // Rails (painted in atlas.ts): steel strips over wooden ties; the powered
  // pair glows warm when on, the detector carries a center sensor plate.
  [BlockId.PoweredRail]: [0.4, 0.28, 0.16],
  [BlockId.PoweredRailOn]: [0.5, 0.3, 0.15],
  [BlockId.DetectorRail]: [0.38, 0.32, 0.24],
  [BlockId.DetectorRailOn]: [0.42, 0.34, 0.24],
  [BlockId.Rail]: [0.35, 0.28, 0.18],
  // Slabs and stairs reuse their material's tone (atlas.ts extends the plank
  // grain / stone speckle accents to them).
  [BlockId.PlankSlab]: [0.76, 0.61, 0.38],
  [BlockId.StoneSlab]: [0.54, 0.56, 0.58],
  [BlockId.CobbleSlab]: [0.42, 0.43, 0.45],
  [BlockId.PlankStairsNorth]: [0.76, 0.61, 0.38],
  [BlockId.PlankStairsEast]: [0.76, 0.61, 0.38],
  [BlockId.PlankStairsSouth]: [0.76, 0.61, 0.38],
  [BlockId.PlankStairsWest]: [0.76, 0.61, 0.38],
  [BlockId.StoneStairsNorth]: [0.54, 0.56, 0.58],
  [BlockId.StoneStairsEast]: [0.54, 0.56, 0.58],
  [BlockId.StoneStairsSouth]: [0.54, 0.56, 0.58],
  [BlockId.StoneStairsWest]: [0.54, 0.56, 0.58],
  [BlockId.CobbleStairsNorth]: [0.42, 0.43, 0.45],
  [BlockId.CobbleStairsEast]: [0.42, 0.43, 0.45],
  [BlockId.CobbleStairsSouth]: [0.42, 0.43, 0.45],
  [BlockId.CobbleStairsWest]: [0.42, 0.43, 0.45],
  // Near-black volcanic glass with violet flecks (painted in atlas.ts).
  [BlockId.Obsidian]: [0.09, 0.07, 0.14],
  // A swirling violet portal surface (painted in atlas.ts; emits block light).
  [BlockId.NetherPortal]: [0.45, 0.18, 0.68]
};
