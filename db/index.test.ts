import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { resolveDatabaseUrl } from "./index";

// The decision logic only — actually constructing PGlite here would trip on
// happy-dom's URL polyfill (the pglite:// connection branch itself is proven
// by the Playwright suite, which runs the real Next server on it).
// Next's typegen marks NODE_ENV readonly; tests mutate it through this view.
const env = process.env as Record<string, string | undefined>;
const savedUrl = env.DATABASE_URL;
const savedNodeEnv = env.NODE_ENV;

afterEach(() => {
  env.NODE_ENV = savedNodeEnv;
});

afterAll(() => {
  if (savedUrl === undefined) delete env.DATABASE_URL;
  else env.DATABASE_URL = savedUrl;
});

describe("resolveDatabaseUrl", () => {
  test("a configured DATABASE_URL is used verbatim, silently", () => {
    env.DATABASE_URL = "postgres://example/db";
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(resolveDatabaseUrl()).toBe("postgres://example/db");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("unset in production keeps the hard error", () => {
    delete env.DATABASE_URL;
    env.NODE_ENV = "production";
    expect(() => resolveDatabaseUrl()).toThrow(/DATABASE_URL is not set/);
  });

  test("unset outside production falls back to in-memory PGlite with a warning", () => {
    delete env.DATABASE_URL;
    env.NODE_ENV = "development";
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(resolveDatabaseUrl()).toBe("pglite://memory");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("in-memory PGlite");
    } finally {
      warn.mockRestore();
    }
  });
});
