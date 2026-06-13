# Monecraft (Next.js + TypeScript + Three.js + Bun)

[![CI](https://github.com/hutusi/monecraft/actions/workflows/ci.yml/badge.svg)](https://github.com/hutusi/monecraft/actions/workflows/ci.yml)

A playable Minecraft-inspired voxel game: procedural terrain with biomes, caves and ores, first-person movement, mining and building, crafting, armor, mobs, a day-night cycle, procedural sound and music (no audio files — everything is synthesized), and localStorage saves. Single-player, browser-only.

## Controls

- `W A S D`: Move · `Space`: Jump · `C`: Crouch
- `W + CapsLock`: Sprint (drains hunger)
- `Mouse`: Look around (click the game first to lock the pointer)
- `Left click` (hold): Break block / attack mobs
- `Right click` or `E`: Place selected block
- `1..9`: Select hotbar slot
- `I`: Inventory & crafting · `F`: Eat food · `U`: Emergency unstuck
- `V`: Camera view (first-person → third-person rear → third-person front)
- `Esc`: Pause menu (save / load / reset, sound/music volume sliders, and the Appearance skin picker live there) · `F3`: Debug overlay

## Run

```bash
bun install
bun run dev
```

Then open `http://localhost:3000`.

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

- [docs/architecture.md](docs/architecture.md) — engine/renderer/shell layering and invariants
- [docs/adding-content.md](docs/adding-content.md) — add a block, item, recipe, mob, or mechanic
- [docs/save-format.md](docs/save-format.md) — save schema and compatibility rules
- [CONTRIBUTING.md](CONTRIBUTING.md) — workflow and verification baseline
