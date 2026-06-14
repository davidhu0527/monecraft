# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.9.0] - 2026-06-14

### Added

- **Villagers & trading**: a passive NPC you can barter with gives gathering an economy, all on **zero new assets** (procedural model + a recolored gem sprite)
  - **Villager** mob: passive like the animals but **doesn't flee** — walk up and **right-click to trade**. It drops nothing if killed (don't murder your shopkeeper) and spawns into the day-one passive population near you
  - **Trading**: the currency is the **emerald**. Right-clicking a villager opens its offers in the inventory's recipe book (re-titled **Trading**). The economy is two-sided — **sell** gathered materials (wheat, coal, leather, gold ore) for emeralds, then **spend** them on goods (bread, torches, arrows, a stone pickaxe, sliver/ruby ore). No use caps; trading is bounded only by what you can gather
  - **Architecture**: a trade is simply a **`station: "villager"` recipe** (`lib/game/trades.ts`, spread into `RECIPES`), so it reuses the entire crafting pipeline and recipe-book UI — opening a villager just sets `craftingStation = "villager"`, and the existing `craft` command runs the trade. The new `"villager"` `MobKind` fills all five exhaustive `Record<MobKind>` tables. **No save-format or worldgen change**: villagers are transient, the open trade station is session-only, there are no per-trade use caps to persist, and emerald/traded items save by string id. (Village _structures_ are a possible future addition — villagers currently wander the world among the existing houses rather than spawning in generated settlements, which keeps this change off the worldgen-determinism baseline.)
- **Creepers, TNT & explosions**: the game gains its first explosion system — a sneaking mob that detonates and a craftable demolition charge — all on **zero new assets** (procedural model/atlas + synthesized boom)
  - **Explosion primitive** (`lib/game/engine/systems/explosion.ts`): `explode()` destroys blocks in a power-radius sphere (distance falloff vs each block's blast resistance, sparing bedrock/spawner/lava), then damages the player and mobs out to twice that radius with the same falloff, applies knockback, and emits one `explosion` event. It is **not a new subsystem** — it batches over the existing `blockChanges.set` chokepoint (each cell relights locally, records the save delta) and sets `worldMeshDirty` **once**, so a whole crater costs a single remesh. It only lowers mob hp (never splices), so it is safe to run mid mob-tick; the caller sweeps the dead
  - **Creeper**: a hostile mob that chases silently, then lights a ~1.5 s fuse within ~2.6 blocks (hissing and swelling white), and **explodes** — dying in its own blast and dropping **gunpowder**. Walk past it while primed and the fuse aborts; kill it first to take the gunpowder safely. Burns in daylight like a zombie
  - **TNT**: craft it (4 gunpowder + 1 sand), place it like a block, and **right-click it with a torch** to light a fuse (the torch isn't consumed). It detonates after a delay and **chains** adjacent TNT. Lit fuses are session-only (`state.primedTnt`); a save written mid-fuse reloads with the TNT inert
  - **Minimum hostile spawn distance** (`HOSTILE_SPAWN_MIN_RADIUS`, 16): every hostile spawn (initial + night trickle) now keeps a standoff from the player, so nothing — least of all a creeper — can materialize point-blank
  - The new `"creeper"` `MobKind` fills all five exhaustive `Record<MobKind>` tables. Explosions drive a procedural fireball + smoke burst and a synthesized boom; a primed creeper swells and flashes via its `MobState.fuseTimer`. **No save-format or worldgen change**: creepers are spawned, TNT is crafted, fuses are transient, and the new items save by string id
- **Coal & a fuel economy**: a new shallow ore deepens the early game and gives the furnace a real fuel. **Coal ore** is the most common ore (large veins reaching near the surface, mineable with a wood pickaxe) and drops the **coal** fuel item directly. **Charcoal** smelts from a single log as a coal substitute, so a player who hasn't struck coal can still cook. Both fuel the furnace's cooking recipes (chicken/mutton/beef/porkchop) and **torches now cost coal + wood** instead of wood alone. All procedural, **zero new assets** (a dark-flecked atlas tile + a recolored sprite lump)
  - Coal is placed in its own pass (`placeCoal`) on a **dedicated PRNG**, so it never consumes from the shared worldgen `rand` stream — every other ore, tree, and structure stays **byte-identical** to a coal-free world, exactly as deep-cave lava did. Only underground coal cells differ; the meshing and structural-probe tests stay green and only the byte hashes were re-rolled
  - **Worldgen re-baseline**: the new ore changes the deterministic terrain baseline, so **`WORLDGEN_VERSION` is bumped `7` → `8`** — a world whose recorded version differs discards its stale block-diffs and reboots from its seed. The save **schema** stays version 5 (coal/charcoal are additive items, coal ore persists in the block diff). `canMineBlock` gates coal behind a wood pickaxe (tier 1, like stone); `GEN.coalConfig` holds its vein tunables
- **Cow & pig farm animals**: two new passive mobs join sheep/chicken/horse, following the same template. **Cows** drop leather + raw beef, **pigs** drop raw porkchop; both raw meats smelt to a cooked form (hunger 8) at a furnace and breed like the others — feed a cow **wheat**, a pig **seeds**. Procedural box models + synthesized moo/grunt calls, **zero new assets**. Mobs and breeding are session-only, the new foods save by string id, so **no save-format or worldgen change**
- **World types**: when creating a world you now pick a generation preset, not just a seed — **Default**, **Superflat** (level builder's canvas), **Amplified** (towering, dramatic relief), or **Islands** (scattered land in a raised sea). Each generates genuinely different terrain over the same biome map; **zero new assets** (the picker reuses the menu chrome)
  - `generateWorld(world, worldType)` forks on the type before any block write via `terrainConfigFor` (`lib/world/generation.ts`), varying only sea level and per-biome surface height; caves, ores, lava, trees, structures, and dungeons are unchanged. The **Default path is byte-identical** to before — existing worlds and the determinism hashes are untouched, so **no `WORLDGEN_VERSION` bump**. Each new type is pinned by its own SHA-256 baseline plus structural probes (flat is level, amplified spans a wider band, islands floods more of the map while still leaving a dry spawn)
  - The chosen type is stored on `WorldMeta` and in the `SaveData` blob (like `seed`), so a world always regenerates with the type its block-diffs were recorded against. `WorldType` lives in `lib/world/worldTypes.ts`; the schema stays at version 5 (the field is optional, absent ⇒ default)
- **Multiple worlds & player profiles**: the game now opens to a menu instead of dropping straight into one fixed world. A **profile** (name + skin) owns a list of named **worlds**, like user accounts on a shared console — pick a profile, then pick or create a world to play. All client-side in localStorage; **zero new assets** (the menus reuse the existing Minecraft-style chrome and generated skin portraits)
  - **Two-level save hierarchy** (`lib/game/profiles.ts`, `lib/game/worlds.ts`): a versioned `minecraft_profiles_v1` manifest (`{ id, name, skinId, createdAt }` + `activeProfileId`) and a `minecraft_worlds_v1` index (`{ id, profileId, name, seed, worldgenVersion, createdAt, lastPlayedAt }`), with each world's `SaveData` in its own `minecraft_world_save_<id>` key. Readers are total — malformed entries are dropped and a dangling active profile is repaired. New-world seeds are resolved once at creation (blank → random, numeric → clamped, other text → stable FNV hash). The skin moved off the old global `minecraft_skin_v1` key onto the profile; **audio settings stay global**
  - **Menu shell** (`components/GameShell.tsx`, `components/menu/*`): a profile-select → world-select → play state machine with create / rename / delete on both levels (deleting a profile cascades its worlds and their save blobs). Switching worlds, Load, or Reset remounts the game subtree via a React `key`, so the engine/renderer are disposed and re-created **without a page reload**. The tab remembers its active world in `sessionStorage`, so a reload resumes straight back into play while a fresh tab cold-starts at the menu. The pause menu gains **Save & Quit to Worlds**
  - **Per-world worldgen versioning**: each world records the `WORLDGEN_VERSION` it was generated under (`lib/game/config.ts`). A future worldgen change bumps that constant and discards only the affected worlds' stale block-diffs (rebooting them from their seed) — replacing the old whole-store `SAVE_KEY` rename, which reset every world. The save _schema_ is unchanged (still version 5)
  - **First run & migration** (`lib/game/legacyMigration.ts`): a brand-new player is greeted by the create-profile form (name + skin) — their first act is making a profile. An existing single-world save is instead folded into a default "Player" profile (carrying the old skin) plus one "My World"; the legacy blob is copied before the old key is removed, so a failure can't lose data

### Changed

- **Recipe book grouped by category**: the crafting panel's recipe list is no longer one long flat scroll. Recipes are now organized into labeled sections — **Tools, Weapons, Armor, Building, Food, Materials**, then the station-gated **Smelting** and **Trades** — and within each section the recipes you can make right now are listed first, so what's craftable rises to the top. Categories are **derived** from each result item's existing `kind` (station recipes group by station), so adding a recipe needs no extra metadata. Pure presentation: no save-format, worldgen, or recipe-data change (`recipeCategory`/`groupRecipes` in `lib/game/recipes.ts`)

## [0.8.0] - 2026-06-14

### Changed

- Starting play now requires a double-click to acquire pointer lock, preventing an accidental single click from immediately capturing the mouse. No save-format or worldgen impact.
- Emergency unstuck now requires **`Shift` + `U`** instead of a bare `U`, so a stray keypress can no longer teleport the player mid-play. The automatic unstuck safeguard (which fires when wedged in terrain or falling below the world) is unchanged. No save-format or worldgen impact.
- Placed glass now renders as a clear, low-reflection transparent layer. Internal faces between adjacent glass blocks are culled, while neighboring opaque block faces remain visible through it. No save-format or worldgen impact.

### Added

- **Caves & lighting**: caves are no longer lit like the surface — a real per-voxel light system makes underground dark, with torches, deep-cave lava, and drowning as new hazards. All procedural, **zero new assets**
  - **Per-voxel light propagation** (`lib/world/lighting.ts`): each voxel carries packed sky + block light (0–15 each), baked from the blocks at load (top-down sunlight column pass + flood) and patched locally on every edit with a Minecraft-style remove/refill flood. It is a **derived cache, never serialized** (a pure function of `world.blocks`). The mesher emits a per-vertex `aLight` attribute and the world material's shader gates scene-lit terrain by sky exposure (caves go dark) while adding block light back as a glow — so **day/night needs no re-mesh** (the scene sun/hemisphere already scale with daylight)
  - **Torches**: craft four from one wood and place them to light the dark; a torch is a solid block emitting block light 14, so its warm glow floods the surrounding air and survives the night
  - **Lava**: pools in the deepest caves (carved air at or below `lavaLevel`), glowing and emitting max block light. Touching it burns **immediately** for 3 hearts every half-second with no grace period, bypassing armor, and keeps burning briefly after you escape. Worldgen-only — no item, can't be mined
  - **Drowning**: a bubble meter (above the hunger bar) drains over ~15 s while your head is underwater, then deals 1 heart/second until you surface; it refills quickly. Distinct from the existing 60 s body-immersion damage — wading chest-deep never drowns you
  - **Worldgen re-baseline**: the deep-cave lava changes the deterministic terrain baseline, so the worldgen/meshing hashes were re-rolled and **`SAVE_KEY` bumped `minecraft_save_v6` → `minecraft_save_v7`** — existing worlds reset. The save _schema_ is unchanged (lighting is derived, lava is worldgen; neither is persisted), so the payload version stays 5. `placeLava` runs after `placeOres` and before `placeDungeons`, keeping the surface byte-identical (structural probes stay green)
- **Spears and non-stackable gear**: seven craftable spear tiers (wood, stone,
  sliver, ruby, sapphire, gold, diamond) have 7-block left-click melee reach and
  can be thrown with right-click/`E`. Throws use procedural projectile meshes,
  gravity, swept mob collision, terrain collision, a cooldown, tiered damage,
  and one durability per throw. Missed throws remain visibly embedded in terrain
  for two seconds, and the faster, flatter trajectory travels farther. All
  durable armor, tools, knives, swords, and spears now occupy one slot across
  drops, crafting, saves, and chests; legacy stacked durable gear is split
  during migration. No save-format or worldgen impact.
- **Wood doors**: craft one from 6 planks and place it on a solid floor to create a thin, two-block-tall panel. Right-click either half to open or close the whole door; open doors rotate onto their hinge edge, while closed doors block players and mobs. Door facing, open state, and both halves persist through the existing block-diff save, and breaking either half removes the whole door and returns one item. Only the player interaction path toggles doors; mobs stop at closed doors and cannot operate them. No save-format or worldgen impact.
- **Water building and exposure damage**: block placement may now replace water cells, so underwater structures can be built against submerged terrain. Remaining continuously immersed for more than 60 seconds starts dealing 3 HP (1.5 hearts) of armor-bypassing damage every second; leaving water fully resets both timers. Exposure is session-only and is not serialized. No save-format or worldgen impact.
- **Endgame & ranged combat**: the game gains its first ranged weapon, ranged enemies, and a true win condition — all on one new transient projectile system, with **no save-format or worldgen change** and **zero new assets** (procedural pixel sprites + synthesized sounds)
  - **Projectile system** (`lib/game/engine/projectiles.ts`, `engine/systems/projectileAI.ts`): arrows are session-only entities (like mobs, never serialized) that integrate under gravity and despawn on a hit, a TTL, or leaving the world. Block collision reuses the world DDA (`voxelRaycast`), which already sweeps the whole segment, so even a very fast arrow can't tunnel a 1-block wall; the entity test is substepped too so a fast arrow can't skip a thin mob between frames. A `fromPlayer` flag is the hit filter — player arrows hit mobs (with knockback), mob arrows hit the player (armor-mitigated) — so a mob's arrow can never hit the firer or another mob. `tickProjectiles` runs right after `tickMobs` in both the live and dead step branches
  - **Bow & arrows**: craft a **bow** (3 wood + 3 string) and **arrows** (1 stone + 1 wood + 1 feather → 4). Holding a bow makes the attack input fire instead of melee — **instant click-to-fire** (no draw-charge; holding left-click already means mine) at a fixed damage on a short cooldown, spending one arrow and a point of bow durability per shot. The swing animation still plays
  - **Ranged skeletons**: a `ranged` flag on the mob template makes skeletons **kite** — backing off inside a standoff band, holding in the middle, approaching only when far — and loose arrows from across their detect range (leading a moving target) instead of meleeing. Finally distinct from zombies, which stay melee
  - **Endgame boss & victory**: craft a **Cursed Totem** (1 diamond ore + 2 bone + 2 gold ore — the diamond grind's first real goal) and right-click to summon a towering boss nearby (refused if one already walks). It bears down on the player, bites for heavy damage up close, looses a 3-arrow spread at range, periodically conjures minions (capped, under the global hostile cap), and is immune to the daylight burn. Defeating it drops a **Dragon Heart** that crafts the best-in-game **Dragon Sword** (60 attack), fires a one-shot **victory screen**, and shows a top-center **boss health bar** while it lives
  - New `"boss"` `MobKind` touches all five exhaustive `Record<MobKind>` tables (templates, drops, ambience intervals, ambient + attack sounds). New events (`arrowHit`, `bowFired`, `bossSummoned`, `bossDefeated`, `summonFailed`) drive procedural impact sparks, a conjuring column, a victory burst, and synthesized bow-twang / arrow-tick / boss-roar / victory-fanfare sounds. In-flight arrows render as a pooled extruded-sprite mesh (one shared geometry/material) oriented along their velocity
  - **No version bump**: the boss, its minions, projectiles, and the victory flag are all transient; the new items (bow, arrow, Cursed Totem, Dragon Heart, Dragon Sword) are additive, saved by string id. New tunables live in the `config.ts` "Ranged combat & endgame" group

## [0.7.0] - 2026-06-14

### Added

- **Dungeons & loot**: digging underground now turns up small cobblestone rooms (speckled with mossy cobble) sealed in the rock, well clear of spawn — the game's first real exploration payoff, and a found-loot purpose for chests. All procedural, **zero new assets**
  - Each dungeon holds 1–2 **pre-filled loot chests** and a central **mob spawner**. Loot is tiered (`lib/game/dungeonLoot.ts`): common chests carry food, low ores, and the occasional stone pickaxe (bone always drops, so a chest is never empty); a 25% rare roll adds the payoff — diamond/sapphire ore, a ruby/sapphire sword, helmet/chestplate, or a rare diamond pickaxe
  - **Spawners** drip a hostile (zombie/skeleton/spider) onto the room floor every ~8 s while you're within ~16 blocks, up to 6 clustered nearby (under the global hostile cap). They're time-independent (dungeons are dark); **mining the spawner block out** stops it for good (it's hard and drops nothing). New `mobSpawned` event drives a synthesized low whoosh and a dark conjuring smoke puff
  - New **MossyCobblestone** (mineable into a `mossy_cobble` item, found-only) and **Spawner** blocks, both with procedurally-painted atlas tiles
  - **The lazy-loot design** solves an infinite-loot trap: dungeon chests are placed by deterministic worldgen, so their contents can't live in the block-diff save. Filling them eagerly would let a player empty a chest, reload (the empty chest is dropped from the save), and find fresh loot. Instead the engine fills each chest lazily on **first open or break** — loot seeded from `world.seed ^ voxelIndex` so it's reproducible until you reach it — and records the index in a persisted `lootedChests` set. Gating on "has this been accessed", not "is it currently empty", closes the re-roll. The set of _which_ indices are dungeon chests/spawners is session-only, re-derived from the seed each load via `collectDungeonSites` (which replays the placement math against a dedicated seed-only PRNG and seed-pure terrain estimates, never `highestSolidY`, so it can't diverge from generation)
  - **Save format v5** (additive `lootedChests` field; `migrateSaveV4toV5` is a pure version bump) and **`SAVE_KEY` bumped `minecraft_save_v5` → `minecraft_save_v6`**: the dungeon worldgen changes the deterministic terrain baseline, so **existing saved worlds are discarded** (a deliberate, documented re-baseline — worldgen SHA-256 digests and the in-region meshing snapshot were re-rolled; the structural probes confirm the surface is untouched since dungeons are wholly underground)

## [0.6.0] - 2026-06-13

### Added

- **Chests & persistent storage**: craft a chest (8 planks), place it, and right-click it to open a **27-slot** storage grid above your inventory — the long-standing "everything rides in 36 slots on your person" gap is closed
  - Introduces the game's first **block-entity** layer: a chest's contents live in `state.containers` (a `Map` keyed by the block's voxel index, the same space as the block diff). The right-click opens it via the existing interact precedence (after bed/furnace), and the same click-one-slot-then-another interaction now spans both grids through a new `moveStack` command (chest slots offset by `CONTAINER_SLOT_BASE`); pure cross-array `moveStack`/`tryInsertSlots` helpers join `lib/game/inventory.ts`
  - **Breaking a chest spills its contents** back into your inventory (tool/armor durability preserved) and returns the chest item; if there isn't room for everything the break is refused (a `breakBlocked` toast) so nothing is lost — consistent with the game's no-ground-item loot model
  - **Save format v4** (additive — `SAVE_KEY` unchanged, v1/v2/v3 saves still load): a new optional `blockEntities` field persists non-empty chests; `migrateSaveV3toV4` is a pure version bump and `readSave` chains v1→v2→v3→v4. **No worldgen impact** (chests are never generated). New `chest` block/item, an 8-planks recipe, a `CHEST_SLOTS` tunable, a generated chest atlas tile, and a synthesized open-creak sound
- **Juice & atmosphere pass**: the world now reacts and breathes, all via procedural rendering/audio (zero new assets) with **no save-format or worldgen impact**
  - **Particles**: a pure, unit-tested structure-of-arrays particle pool (`lib/game/render/particlePool.ts`) wrapped by a single `THREE.Points` draw call (`particleSystem.ts`) whose attributes refill each frame; a small shader draws each particle as a soft round sprite that fades over its life (no texture). The renderer gained `handleEvent(event, state)`, wired into the event drain beside `audio.handleEvent`: breaking a block throws shards tinted from `BLOCK_COLORS`, placing puffs, mob death bursts in the mob's body color, eating drops crumbs, and jumping/landing kick dust (landing scales with impact). Footstep dust spawns from a stride-distance accumulator. The three positioned events (`blockBroken`/`blockPlaced`/`mobDied`) gained additive `x,y,z` fields so bursts land correctly
  - **Night sky**: a deterministic 800-point star field that fades in at dusk, sprite discs for the moon and a now-visible sun riding opposite ends of the sun arc, and a drifting cloud sheet from a seamlessly tiling canvas-noise mask (`starField.ts`, `skyView.ts`). All camera-following and fog-exempt; opacities ramp off `daylight`
  - **Weather**: a pure, deterministic system (`engine/systems/weather.ts`) sets a **transient** `state.weather` (never serialized) — time splits into windows, a seeded hash decides precipitation, and biome picks snow (mountains) / clear (desert, ocean) / rain. It drives a camera-following precipitation field (`precipitation.ts`), an overcast sky tint + dimmed light + nearer fog in `syncDayNight`, and a synthesized looping rain bed on the audio graph (`rainLoop.ts`). Strictly cosmetic — spawn/daylight balance is untouched. New `WEATHER_CYCLE_SECONDS` / `WEATHER_RAIN_FRACTION` tunables
- **UI polish pass for a more authentic Minecraft look**: the interface now reads closer to real Minecraft across five fronts
  - **Pixel font**: UI text switches from the generic monospace stack to **Monocraft**, an open-source Minecraft-style face (SIL OFL 1.1) self-hosted via `next/font/local` from a committed woff2 in `app/fonts/` and exposed as the `--mc-font` CSS variable. Its coding ligatures are disabled so UI text stays literal. The monospace stack stays as the fallback and is pinned on the F3 debug readout, which relies on column alignment. This bundled font file is a deliberate, documented exception to the zero-binary-asset rule (the only one)
  - **Textured GUI chrome**: panels, inventory slots, recipe entries, and buttons gain a faint generated grain instead of flat fills. A new `grayGrainTileUrl` generator in `lib/ui/chromeTiles.ts` installs `--mc-tile-panel/well/button` as CSS variables (sunken bias on the slot well); the CSS layers each tile over the existing flat color, so bevels are untouched and SSR/pre-install falls back to the solid color
  - **Item tooltips**: hovering hotbar, inventory, and recipe entries now shows a cursor-following, near-black tooltip with a violet gradient border (new `useItemTooltip` hook in `components/game/ItemTooltip.tsx`) instead of the browser's native `title=`. Durable items show a gray "Durability x / y" line and locked recipes show "Requires <station>". The tooltip is `pointer-events:none` and `aria-hidden`, so it never blocks the pointer-lock click and accessible names (the `aria-label`s) are unchanged
  - **Depth**: a shared `.menu-backdrop` dims the frozen world behind the inventory and pause menu (the dimming moved off `.pause-overlay` so it no longer double-darkens), plus an always-on screen-edge `.vignette` over the 3D view (tunable via `--mc-vignette`)
  - **Motion**: a centered pop-in for the inventory panel, a fade-in for the pause overlay, quick hover/press feedback on slots and buttons, and a small rise on the hotbar item-name pop — all disabled under `prefers-reduced-motion`
  - No save-format or worldgen impact
- **Pickup & status toasts**: because mob loot drops straight into inventory storage (no ground item), kills could feel like they paid out nothing. A kill now shows a brief on-screen toast just above the hotbar (e.g. "+2 Wool, +1 Raw Mutton"). The same in-game toast also surfaces the sleep-denied messages ("You can only sleep at night" / "Monsters are nearby"), which previously only rendered inside the pause menu and so were invisible during play
- **Animal breeding**: right-click a sheep or horse with wheat (or a chicken with seeds) to put it "in love"; two in-love adults of the same kind standing close together spawn a baby that follows the parents, can't be farmed for drops, and grows to full size after ~90 seconds. This makes mob drops renewable, closing the loop back to combat loot. The passive population is capped (24) and feeding costs crops, so it stays bounded
  - New `MobState.fedTimer`/`ageTimer`, a `breeding` system ticked after mob AI, and a shared `findAimedMobIndex` so feeding and attacking use the same "what's in my crosshair" rule. Feeding joins the right-click precedence ahead of block interaction. New fed/bred sounds; babies render at 55% scale. Breeding state is session-only (mobs are never saved). No save-format or worldgen impact
- **Furnace & cooking**: craft a furnace (8 cobble) and right-click it to open the crafting panel in furnace mode, which unlocks smelting recipes — raw chicken or mutton + 1 planks (the fuel) cook into the cooked version, restoring 8 hunger versus 3 raw. Smelting recipes show as locked ("Requires Furnace") until a furnace is open
  - Reuses the Phase 2 interact system and the existing crafting panel — no separate furnace UI. Recipes gained an optional `station` field; the gate is enforced engine-side in the `craft` command (UI gating alone is spoofable). New `Furnace` block with a glowing-mouth atlas tile, `cooked_chicken`/`cooked_mutton` items, and a smelt sound. No save-format or worldgen impact
- **Farming & food**: craft a wood hoe (2 planks + 1 wood), right-click grass or dirt to till it into farmland, then right-click farmland with seeds to plant wheat. Crops grow through four stages over ~2.5 minutes and, when mature, harvest into wheat plus 1–2 seeds; an immature crop just returns its seed. Craft 3 wheat into bread (restores 6 hunger)
  - Seeds come from breaking grass (20% chance per block) — `addBlockDrop` now rolls a per-block `rollBlockDrops` table (`lib/game/items.ts`) instead of a single fixed drop
  - New **random-tick system** (`lib/game/engine/systems/randomTicks.ts`): each interval samples columns near the player and runs per-block handlers — the extensible basis for crop growth (and future saplings / grass spread). Crops are solid full-cube blocks (so they can be targeted and harvested) with each growth stage its own `BlockId`, which means they persist through the existing block-diff save with **no save-format change**
  - New `Farmland` + `WheatStage0..3` blocks, `wood_hoe`/`seeds`/`wheat`/`bread` items with generated sprites, and till/plant sounds. The right-click "use held item" step joins the interact precedence (after block interaction, before placement). No worldgen changes
- **Beds & sleeping**: craft a bed (3 wool + 3 planks), place it, and right-click it at night to skip to morning — the screen fades to black, the day clock jumps to a fresh dawn, and the bed becomes your respawn point (respawn falls back to a random land point if the bed is gone). Sleeping is refused during the day or with a hostile within 12 blocks, with an on-screen reason
  - New **right-click interact system** (`lib/game/engine/systems/interact.ts`): a fixed precedence in the `placeBlock` command runs block interaction before placement, so interactive blocks (beds now; furnaces later) take the click instead of getting a block placed on them. New `Bed` block + `bed` item, synthesized sleep/wake sounds, and a `SleepOverlay` fade component
  - **Save format v3** (additive — `SAVE_KEY` unchanged, v1/v2 saves still load): time of day (`dayClock`), `hearts`, `hunger`, and the bed `spawnPoint` now persist. Previously all four reset on reload, so sleeping through the night wouldn't have survived a reload. `readSave` chains the migrations v1 → v2 → v3
- **Mob loot & drops**: mobs now drop kind-specific items when they die instead of the old flat "cobble for hostiles, food for everything else" rule. Sheep drop wool + raw mutton, chickens feather + raw chicken, horses leather, zombies rotten flesh, skeletons bone, spiders string — counts are randomized per the engine's RNG (`lib/game/mobLoot.ts`). A new `mobDied` engine event plays a synthesized death thud
  - New items: `wool`, `feather`, `bone`, `leather`, `string` (crafting materials) and `rotten_flesh`, `raw_chicken`, `raw_mutton` (edible food), each with a generated 16×16 sprite (zero-asset)
  - **Per-food hunger**: food now restores a value carried on the item itself rather than one global constant. The generic `food` item still restores 7; raw meats restore 3, rotten flesh 2. New `food` and `material` item kinds; the legacy `food` item is reinterpreted (old saves load unchanged — saves store only item id + count)
  - New recipe: 4 string → 1 wool, so spider drops feed the wool supply (and, later, beds)
  - No save-format or worldgen impact
  - Selection recolors the body live (material color swap, no rebuild) and persists as a player preference under its own localStorage key (`minecraft_skin_v1`), separate from the world save — it survives world resets. No save-format or worldgen impact
- **Camera view toggle (V)**: cycles first-person → third-person rear → third-person front, like Minecraft's F5 (V instead, because F5 reloads the page in browsers)
  - New humanoid player body (head, torso, two arms, two legs) in the zero-asset box-mesh style, visible only in third person — walk gait scaled by speed, a chop animation on attacks and while mining, the look pitch on the head, and the held hotbar item rendered in the right hand via the shared item-model builder
  - The third-person camera boom raycasts against terrain and clamps so walls never occlude the player; the front view flips the heading and inverts the tilt while mouse control of the player stays unchanged
  - Gameplay is intentionally eye-relative in every mode (mining/placing reach, combat aim, audio panning are unaffected); the crosshair stays centered, matching Minecraft
  - The view mode is session-only (resets to first-person on reload). No save-format or worldgen impact

### Documentation

- **Added `docs/manual.md`**, a player-facing guide: getting started / your first day, the full control map, survival (health, hunger gates, combat, armor, death), the day-night thresholds, mining with tool-tier gating, crafting and smelting, the mob roster and breeding, farming, beds and sleeping, the procedural audio, and saving. Linked from the README and AGENTS.md
- **Added `docs/reference.md`**, scannable tables cross-checked against the code: all 31 recipes, the 26 block types (hardness + tool gate), the 6 mobs (stats + drop ranges), and item stats for tools, weapons, armor, and food
- **Added `docs/tuning.md`**, a contributor balance guide that groups the `config.ts` tunables by gameplay effect (player feel, survival pressure, danger, progression, farming/breeding, persistence/rendering), names the system that reads each, and flags the save-sensitive ones (`SAVE_KEY`, inventory layout)
- **Refreshed `docs/architecture.md`** to match the shipped engine: the per-frame step order now lists the random-tick (crop growth) and animal-breeding systems, the right-click precedence documents the full feed → interact → use-held → place chain, the mob/block drop tables (`rollMobDrops`/`rollBlockDrops`) are described, and the `window.__monecraft` debug handle the Playwright `e2e/` suite drives through is noted

## [0.5.0] - 2026-06-13

### Added

- **Animated first-person held item**: a one-shot swing on attack clicks (hit or miss, via a new `attackSwung` engine event), a looping swing while mining, a walk bob scaled by movement speed, an equip dip when switching slots, and a faint idle sway
- Held tools, weapons, and food are now built by extruding their 16×16 inventory sprites into pixel-thick voxel meshes (one geometry, vertex colors), so the in-hand model always matches the icon; held blocks remain cubes
- Redesigned knife sprite: a single-edged drop-point blade with a bright cutting edge, dark spine, and riveted handle — clearly distinct from the swords (no crossguard). No save-format or worldgen impact
- **Procedural audio** — the game has sound, with zero audio assets (everything is synthesized at runtime, like the sprite system):
  - Block interaction SFX by material (stone/wood/grass/sand/glass/water): break, place, and staged mining hit ticks
  - Player feedback: surface-aware footsteps, jump and impact-scaled landing, hurt, eating, death/respawn stingers
  - Mob sounds: idle calls (sheep, chicken, horse, zombie, skeleton, spider) with distance falloff and look-relative stereo pan inside a 24-block earshot, plus attack and melee-hit sounds
  - Generative background music: a pentatonic ambient pad that brightens and quickens by day, darkens at night, and shifts with the biome (5 s hysteresis at borders); ducks behind the pause menu
  - Pause-menu Sound section: master and music sliders plus mute, persisted under a separate localStorage key (`minecraft_audio_v1`)
  - One-shot SFX ride on new engine `GameEvent`s (block broken/placed, hurt, ate, jumped, landed, mob attacked/hit); continuous sound derives from state, mirroring the renderer
  - New dependency: [zzfx](https://github.com/KilledByAPixel/ZzFX) (~1 KB, MIT) for SFX synthesis; the AudioContext is created only on the first user gesture (autoplay policy)
  - No save-format or worldgen impact

## [0.4.0] - 2026-06-12

### Added

- Snow and Cactus blocks (mineable, placeable; cactus deals no contact damage). Snow caps mountain tops above y=68; cacti scatter across dry desert sand
- Sand beaches where low land meets the sea (shoreline band around sea level)

- **Minecraft-style UI overhaul**: pixel-art hotbar with white selection outline and fading item-name popup, heart/hunger/armor icon rows, survival-layout inventory (armor column, 9×3 storage grid, hotbar row) with a visual recipe book (ingredient icons → result), pause menu (Esc) with Save/Load/Reset and a controls reference, red-tinted "You Died!" death screen with a Respawn button, and a toggleable F3 debug overlay (position, daylight, mob counts, FPS)
- Procedural pixel-art sprite system (`lib/ui/`): 16×16 item icons (isometric block cubes from `BLOCK_COLORS`, shape×material-palette tools/weapons/armor), HUD icons (hearts, drumsticks, armor), and UI noise tiles — all generated in code, no image assets, covered by integrity tests
- Top-right minimap rendered from world block data (north-up, height-shaded, player arrow, refreshes on block edits)
- Engine commands: `pause`/`resume` (freezes the whole simulation behind the menu), `toggleDebug`, and `respawn` (skips the death countdown)

### Fixed

- On slow machines the simulation ran in slow motion: the frame loop clamped each frame to one 50 ms step, so at low FPS game time fell behind wall time. The loop now catches up with bounded substeps

### Changed

- **Fewer, better-spread animals**: the day-one passive population drops from 34 to 14 (6 sheep, 5 chickens, 3 horses) and scatters over a wider ring than hostiles, so the spawn area no longer feels crowded. Initial hostiles and night spawning are unchanged. Mobs and the respawn point also no longer place on flooded columns
- **Worldgen rebalanced — `SAVE_KEY` bumped to `minecraft_save_v5`, existing saves are discarded.** The biome noise field was degenerate (whole maps collapsed to 1–2 biomes; forests effectively never generated, leaving some worlds nearly woodless). Maps now contain coherent patches of all five biomes (forest ~19–31%, measured across seeds). Tree canopies no longer overwrite trunk tops (trees were losing 2 wood blocks each and looked like bushes), tree density roughly doubled, and forests grow taller trunks. Worldgen hash tests re-baselined per the documented policy
- **Stats rebalanced to Minecraft ranges** — health 50 → 20 (10 hearts), energy renamed to hunger and rescaled 100 → 20 (10 drumsticks) with total drain ranges preserved (sprint 100 blocks / walk 300 / 50 jumps per point), food restores 7; health regen now requires hunger ≥ 12 and sprinting needs hunger > 6; hunger refills on respawn; fall/void damage rescaled to the new HP range
- **Hostile mobs hit harder**: zombie/skeleton damage 1 → 3, spider 1 → 2 (the old values were ~2% of max HP per hit; this is a real difficulty increase)
- **Inventory shrunk to 36 slots (9-slot hotbar + 27 storage)** to match the Minecraft layout; the `Digit0` hotbar binding is gone (1–9 only)
- **Save format bumped to version 2** (same `SAVE_KEY`, no worldgen impact): v1 saves are migrated on load — slots are compacted 40 → 36 with stackables merged, `selectedSlot` clamped to 0–8; items that genuinely overflow the smaller inventory are dropped
- Save/Load/Reset buttons moved from the top-left HUD (now removed) into the pause menu; the old top-left info lives in the F3 overlay
- Escape now opens the pause menu (pointer-lock loss during gameplay pauses the game; Esc also closes the inventory)

## [0.3.0] - 2026-06-11

### Added

- Playwright E2E smoke suite (`bun run test:e2e`, also a CI job): boots the production build in headless Chromium and verifies rendering, input → movement, crafting via UI, mining, and save persistence through a `window.__monecraft` debug handle (also usable from the browser console)
- React component tests for InventoryPanel and Hotbar, and Three.js-only unit tests for mob visuals and the held item, all under `bun test` via a happy-dom preload
- Test suite (`bun test`): worldgen determinism hash tests (save-compat guard), meshing snapshots, raycast/collision/save round-trip/item-recipe integrity tests, pure inventory unit tests, and headless engine simulation tests (movement, energy, regen, mining, crafting, death/respawn, night spawning, save round-trips)
- Quality tooling: `bun run typecheck` (tsc), Prettier + `.editorconfig`, GitHub Actions CI (lint, typecheck, format, test, build on pinned Bun)
- WebGL failure handling: a fallback panel replaces a crash when the renderer cannot start
- `CONTRIBUTING.md`

### Changed

- **Engine rewrite**: gameplay simulation moved out of the 1,100-line React hook into a headless, framework-agnostic `GameEngine` (`lib/game/engine/`) with one system module per mechanic and a single `Command` entry point for all UI/input intents. Rendering is isolated in `GameRenderer` (`lib/game/render/`), DOM input in `lib/game/input/`, and the hook is now a thin shell using `useSyncExternalStore`. The mirrored refs-vs-state bridge and its ESLint rule disables are gone. No save-format or worldgen impact — verified by hash tests and save round-trip tests.
- Split `lib/world.ts` into `lib/world/` modules (blocks, voxelWorld, generation, meshing, atlas, queries) behind an index barrel; worldgen constants named in a frozen `GEN` object. No save-format or worldgen impact — output verified byte-identical by hash tests.
- Split `lib/game/config.ts` into `config.ts` (named tunables), `items.ts`, and `recipes.ts`; inventory slot math extracted to pure `lib/game/inventory.ts`
- Held-item block palette moved next to the atlas palette in `lib/world/blocks.ts` (same values)
- Per-frame `Vector3` allocations in mob AI, combat, and player motion replaced with module-scope scratch vectors
- Upgraded dependencies: Next.js 14.2 → 16.2 (Turbopack), React 18.3 → 19.2, Three.js r168 → r184, TypeScript 5.6 → 6.0, ESLint 8 → 10 with flat config (`next lint` was removed upstream; `bun run lint` now runs `eslint .`)
- Replaced `eslint-config-next` (blocked on ESLint 10 by `eslint-plugin-react`) with a hand-rolled flat config: `@eslint/js`, `typescript-eslint`, `@eslint-react/eslint-plugin`, `eslint-plugin-react-hooks` v7, `@next/eslint-plugin-next`
- Removed dead code in world generation flagged by the new lint stack (`seededHash`, useless biome-height initializers)

### Fixed

- Unhandled `requestPointerLock()` rejection (surfaced by the E2E suite): clicking any UI button triggered a lock attempt whose failure logged an uncaught error in some environments; the game now stays unlocked silently
- Crafting with a full inventory no longer consumes the cost while silently destroying the crafted result; the recipe is refused instead (the craft button was already disabled in this case, so this was only reachable programmatically)

## [0.2.0] - 2026-06-11

### Added

- Survival systems: health regen, energy bar with distance/jump-based drain, food mechanics, hotbar hearts and health progress bar
- Day-night cycle with hostile mob behavior — night spawning, twilight-only spider aggression, daylight burn for zombies/skeletons
- Durability system for tools, weapons, and armor, persisted in saves
- Equipped armor slots with damage reduction
- Ore/gear progression: gold, sliver, ruby, sapphire, and diamond tiers with crafting recipes
- Biome-based terrain (oceans, forests, deserts, mountains) with caves, chambers, and tuned ore distribution
- Block breaking crack overlay (8-stage, hardness-scaled)
- Save system with block-diff persistence, autosave, and Reset World button
- Inventory expansion: 99-stack system, hotbar slot swapping, held item view, scrollable crafting list
- Emergency unstuck (auto safeguard + `U` key)
- Shared 16×16 per-face block texture atlas with multi-layer terrain shading and ambient occlusion

### Changed

- World deepened to 150 blocks with wider cave generation
- Water rendered from both sides; players can stay submerged without unstuck teleport
- Game runtime refactored into modular systems (`lib/game/runtime/`) with split UI/styles
- Smooth terrain noise (fixes tall column artifacts); Plains-biome spawn priority
- Mob combat tightened: no hitting through blocks, vertical melee reach check, knockback

### Fixed

- Map persistence and player-stuck bugs (collision depenetration, load-time relocation safety)
- Startup freeze from world generation load
- Dark block undersides via brighter tiles and bounce lighting

## [0.1.0]

Initial Minecraft-like prototype: procedural voxel terrain, first-person movement with gravity and collisions, block breaking/placing, hotbar, and basic mobs. Built with Next.js, TypeScript, Three.js, and Bun.
