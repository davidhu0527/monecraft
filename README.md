# Monecraft (Next.js + TypeScript + Three.js + Bun)

[![CI](https://github.com/hutusi/monecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/hutusi/monecraft/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/tag/hutusi/monecraft?label=release&sort=semver)](https://github.com/hutusi/monecraft/tags)

A playable, Minecraft-inspired voxel game that runs entirely in your browser. Explore procedural terrain across five biomes and dig into **dark caves** — lit only by the torches you craft and place, where lava pools and mobs lurk. Mine ores, raid **underground dungeons** for loot, build and farm, breed animals, craft through seven gear tiers up to a **bow** and throwable **spears**, and take on an **endgame boss** for a true win condition — all across a day-night cycle with hunger, drowning, and lava hazards.

The twist: **everything is procedural — zero binary assets.** Block textures and item sprites are painted from pixel code, all sound and music is synthesized at runtime, and lighting is computed per voxel. Single-player and client-only: keep **multiple worlds** under **multiple player profiles**, all saved to localStorage.

## Run

```bash
bun install
bun run dev
```

Then open `http://localhost:3000`.

The game opens to a menu: pick or create a **profile** (your name and look), then create or choose a **world** to play. New worlds let you pick a **type** — Default, Superflat, Amplified, or Islands — and a seed. Each profile keeps its own list of worlds, so several players can share one browser. Inside the game, **Esc → Save & Quit to Worlds** returns to the world list.

## Controls

- `W A S D`: Move · `Space`: Jump · `C`: Crouch
- `W + CapsLock`: Sprint (drains hunger)
- Double-tap `Space`: Toggle flight (Creative / Spectator); then `Space` / `C` to rise / descend
- `Mouse`: Look around (double-click the game first to lock the pointer)
- `Left click` (hold): Break block / attack mobs
- `Right click` or `E`: Place/interact, or throw a selected spear
- `1..9`: Select hotbar slot
- `I`: Inventory & crafting · `F`: Eat food · `Shift+U`: Emergency unstuck
- `V`: Camera view (first-person → third-person rear → third-person front)
- `Esc`: Pause menu (save / load / reset, **Save & Quit to Worlds**, the **Game Mode** switcher, sound/music volume sliders, and the Appearance skin picker live there) · `F3`: Debug overlay

New here? The [player manual](docs/manual.md) walks through your first day, survival, crafting, farming, mobs, and more.

## Development

```bash
bun run lint        # ESLint
bun run typecheck   # tsc --noEmit
bun test            # unit + integration + component tests
bun run build       # production build
bun run test:e2e    # Playwright browser smoke tests
bun run format      # Prettier
```

All of these are enforced by CI on every PR. The game simulation is a headless engine (no DOM), so gameplay logic is covered by real simulation tests, and a Playwright smoke suite exercises the browser layers — see [docs/testing.md](docs/testing.md).

## Docs

- [docs/manual.md](docs/manual.md) — player guide: getting started, survival, crafting, mobs, farming
- [docs/reference.md](docs/reference.md) — scannable tables: recipes, blocks, mobs, and item stats
- [docs/architecture.md](docs/architecture.md) — engine/renderer/shell layering and invariants
- [docs/adding-content.md](docs/adding-content.md) — add a block, item, recipe, mob, or mechanic
- [docs/save-format.md](docs/save-format.md) — save schema and compatibility rules
- [CONTRIBUTING.md](CONTRIBUTING.md) — workflow and verification baseline
