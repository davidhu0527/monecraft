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
    ...react.configs["recommended-typescript"],
  },
  reactHooks.configs.flat.recommended,
  {
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },
  {
    rules: {
      // The game engine intentionally bridges React state with refs read by the
      // imperative rAF loop (see docs/architecture.md "Refs-vs-state bridge"),
      // which the React Hooks v6+ compiler rules reject wholesale.
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "@eslint-react/set-state-in-effect": "off",
      // Duplicate of react-hooks/exhaustive-deps — keep the canonical one only.
      "@eslint-react/exhaustive-deps": "off",
    },
  },
]);
