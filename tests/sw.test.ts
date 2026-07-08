import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Unit coverage for the service worker's pure helpers (public/sw.js). The
 * worker is plain JS outside the TS program, so it's evaluated here with a
 * stub `self` and asserted through its `self.__sw` test hook. The classify
 * cases pin the contract that matters: /api, cross-origin, non-GET, RSC
 * payloads, and /join navigations are NEVER touched by the cache.
 */

const ORIGIN = "http://localhost:3000";

type StubRequest = {
  method: string;
  mode: string;
  url: string;
  headers: { get(name: string): string | null };
};

type SwHooks = {
  classify: (request: StubRequest, origin: string) => "bypass" | "navigation" | "asset" | "shell-extra";
  extractShellAssets: (html: string) => string[];
  SHELL_EXTRA_PATHS: Set<string>;
  MAX_ASSETS: number;
};

function loadSw(): SwHooks {
  const source = readFileSync(join(import.meta.dir, "..", "public", "sw.js"), "utf8");
  const self: { __sw?: SwHooks; addEventListener: () => void; location: { origin: string } } = {
    addEventListener: () => {},
    location: { origin: ORIGIN }
  };
  // caches/fetch are only referenced inside handlers, never during evaluation.
  new Function("self", source)(self);
  if (!self.__sw) throw new Error("sw.js did not expose self.__sw");
  return self.__sw;
}

const sw = loadSw();

function req(url: string, init: { method?: string; mode?: string; headers?: Record<string, string> } = {}): StubRequest {
  const headers = new Headers(init.headers ?? {});
  return {
    method: init.method ?? "GET",
    mode: init.mode ?? "no-cors",
    url: url.startsWith("http") ? url : ORIGIN + url,
    headers
  };
}

describe("classify", () => {
  test("navigations to the shell are the only cached navigations", () => {
    expect(sw.classify(req("/", { mode: "navigate" }), ORIGIN)).toBe("navigation");
    expect(sw.classify(req("/join/abc123", { mode: "navigate" }), ORIGIN)).toBe("bypass");
    expect(sw.classify(req("/anything-else", { mode: "navigate" }), ORIGIN)).toBe("bypass");
  });

  test("non-GET requests are never touched", () => {
    expect(sw.classify(req("/", { method: "POST", mode: "navigate" }), ORIGIN)).toBe("bypass");
    expect(sw.classify(req("/api/worlds", { method: "POST" }), ORIGIN)).toBe("bypass");
    expect(sw.classify(req("/_next/static/chunks/x.js", { method: "HEAD" }), ORIGIN)).toBe("bypass");
  });

  test("the /api tree is never touched, whatever the method", () => {
    expect(sw.classify(req("/api/auth/session"), ORIGIN)).toBe("bypass");
    expect(sw.classify(req("/api/worlds/42/ticket"), ORIGIN)).toBe("bypass");
    expect(sw.classify(req("/api/invite/tok"), ORIGIN)).toBe("bypass");
  });

  test("cross-origin is never touched, even static-looking paths", () => {
    expect(sw.classify(req("https://game-server.fly.dev/rooms"), ORIGIN)).toBe("bypass");
    expect(sw.classify(req("https://cdn.example.com/_next/static/chunks/x.js"), ORIGIN)).toBe("bypass");
  });

  test("RSC and prefetch payloads bypass even on the shell URL", () => {
    expect(sw.classify(req("/?_rsc=abc"), ORIGIN)).toBe("bypass");
    expect(sw.classify(req("/", { headers: { RSC: "1" } }), ORIGIN)).toBe("bypass");
    expect(sw.classify(req("/", { headers: { "next-router-prefetch": "1" } }), ORIGIN)).toBe("bypass");
  });

  test("hashed immutable assets are cache-first", () => {
    expect(sw.classify(req("/_next/static/chunks/abc123.js"), ORIGIN)).toBe("asset");
    expect(sw.classify(req("/_next/static/media/font.woff2"), ORIGIN)).toBe("asset");
  });

  test("manifest and icons are shell extras, queries included", () => {
    expect(sw.classify(req("/manifest.webmanifest"), ORIGIN)).toBe("shell-extra");
    expect(sw.classify(req("/icons/192"), ORIGIN)).toBe("shell-extra");
    expect(sw.classify(req("/icons/maskable"), ORIGIN)).toBe("shell-extra");
    expect(sw.classify(req("/icon?abc123"), ORIGIN)).toBe("shell-extra");
    expect(sw.classify(req("/apple-icon?abc123"), ORIGIN)).toBe("shell-extra");
  });

  test("everything unrecognized bypasses — the conservative default", () => {
    expect(sw.classify(req("/sw.js"), ORIGIN)).toBe("bypass");
    expect(sw.classify(req("/_next/image?url=%2Ffoo"), ORIGIN)).toBe("bypass");
    expect(sw.classify(req("/random.png"), ORIGIN)).toBe("bypass");
  });
});

describe("extractShellAssets", () => {
  test("collects scripts, stylesheets, and preloads, deduped and unescaped", () => {
    const html = [
      '<script src="/_next/static/chunks/main-abc.js" async></script>',
      '<link rel="stylesheet" href="/_next/static/chunks/style-def.css" />',
      '<link rel="preload" href="/_next/static/media/font.woff2" as="font" />',
      '<script src="/_next/static/chunks/main-abc.js"></script>',
      '<script src="/_next/static/chunks/q.js?dpl=1&amp;x=2"></script>',
      '<script src="https://evil.example.com/_next/static/hijack.js"></script>',
      '<img src="/icons/192" />'
    ].join("\n");
    const urls = sw.extractShellAssets(html);
    expect(urls).toEqual([
      "/_next/static/chunks/main-abc.js",
      "/_next/static/chunks/style-def.css",
      "/_next/static/media/font.woff2",
      "/_next/static/chunks/q.js?dpl=1&x=2"
    ]);
  });

  test("returns nothing for HTML without static refs", () => {
    expect(sw.extractShellAssets("<html><body>hi</body></html>")).toEqual([]);
  });
});
