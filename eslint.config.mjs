import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  globalIgnores([".next/**", "node_modules/**", "next-env.d.ts"]),
  ...nextVitals,
  {
    rules: {
      // The game engine intentionally bridges React state with refs read by the
      // imperative rAF loop (see docs/architecture.md "Refs-vs-state bridge"),
      // which the React Hooks v6 compiler rules reject wholesale.
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);
