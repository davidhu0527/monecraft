import { afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Bun's real network stack, captured BEFORE happy-dom replaces the globals
// with browser-emulating versions that can't reach actual sockets. The
// game-server smoke test (server/server.e2e-smoke.test.ts) talks to a real
// spawned process through these. Never unregister happy-dom mid-run instead:
// React/testing-library capture the registered document at import time, so a
// re-register breaks every component suite that follows.
export const natives = { fetch: globalThis.fetch.bind(globalThis), WebSocket: globalThis.WebSocket };

// Preloaded for every `bun test` run (see bunfig.toml): registers happy-dom
// globals so React component tests work, and unmounts rendered trees between
// tests. Non-DOM tests (engine, world) simply ignore the globals.
GlobalRegistrator.register();

// Imported lazily AFTER registration — @testing-library/react probes the DOM
// at import time.
const { cleanup } = await import("@testing-library/react");

afterEach(() => {
  cleanup();
});
