import { afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

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
