import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "@eslint-react/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";

export default defineConfig([
  globalIgnores([".next/**", "node_modules/**", "next-env.d.ts"]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    ...react.configs["recommended-typescript"]
  },
  reactHooks.configs.flat.recommended,
  {
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules
    }
  },
  {
    rules: {
      // Duplicate of react-hooks/exhaustive-deps — keep the canonical one only.
      "@eslint-react/exhaustive-deps": "off"
    }
  },
  {
    // The game server is headless: importing anything render/audio/DOM-bound
    // would drag three.js GPU code or React into a Bun server process. The
    // engine and world modules are fair game — that's the whole point.
    files: ["server/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@/components/*", "@/app/*"], message: "The game server has no UI." },
            {
              group: ["@/lib/game/render/*", "@/lib/game/audio/*", "@/lib/game/input/*", "@/lib/ui/*"],
              message: "Render/audio/input/ui are browser-only layers."
            }
          ]
        }
      ]
    }
  },
  {
    // Engine systems must address players explicitly: the flat GameState
    // fields (state.player, state.inventory, …) are accessor aliases onto the
    // PRIMARY player — kept for the single-player shell, tests, and
    // window.__monecraft — and reading one inside a system silently acts on
    // "whoever is primary", which is wrong on a multiplayer server. Take the
    // acting PlayerState as a parameter instead (see lib/game/engine/players.ts).
    files: ["lib/game/engine/systems/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'MemberExpression[object.name="state"][property.name=/^(player|inventory|equippedArmor|selectedSlot|hearts|hunger|oxygen|effects|xp|stats|advancements|isDead|respawnTimer|spawnPoint|mining|fishing|mountedVehicleId|inventoryOpen|advancementsOpen|craftingStation|activeVillagerProfession|openContainerIndex|isFlying|gameOver|gameMode)$/]',
          message: "Primary-player alias — engine systems take the acting PlayerState explicitly (lib/game/engine/players.ts)."
        }
      ]
    }
  }
]);
