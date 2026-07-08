import { expect, test } from "@playwright/test";
import { WORLDGEN_VERSION } from "@/lib/game/config";

/**
 * PWA coverage: installable identity (manifest/icons) and the offline app
 * shell. Raw Playwright tests rather than the gamePage fixture — the offline
 * flow needs its own navigation choreography (online warm-up → offline →
 * reload), and going offline makes the browser log fetch failures for
 * legitimately bypassed requests, so the fixture's console-error assertion
 * doesn't apply. Non-interference with online play is pinned by the sw.js
 * classifier unit tests (tests/sw.test.ts) plus the existing e2e suites,
 * which now run with the service worker registering by design.
 */

test("serves the manifest, icons, and an uncacheable service worker", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.status()).toBe(200);
  const body = await manifest.json();
  expect(body.name).toBe("Monecraft");
  expect(body.display).toBe("standalone");
  expect(body.start_url).toBe("/");
  expect(body.icons.map((icon: { src: string }) => icon.src)).toEqual(["/icons/192", "/icons/512", "/icons/maskable"]);
  expect(body.icons.some((icon: { purpose?: string }) => icon.purpose === "maskable")).toBe(true);

  for (const path of ["/icons/192", "/icons/512", "/icons/maskable", "/icon", "/apple-icon"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"], path).toContain("image/png");
  }

  const sw = await request.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(sw.headers()["cache-control"]).toContain("no-cache");
});

test("plays single-player fully offline after one online visit", async ({ page, context }) => {
  // Seed a known profile + world (same shape as the gamePage fixture).
  await page.addInitScript((worldgenVersion) => {
    if (!localStorage.getItem("minecraft_profiles_v1")) {
      localStorage.setItem(
        "minecraft_profiles_v1",
        JSON.stringify({ version: 1, profiles: [{ id: "e2e-profile", name: "Tester", skinId: "default", createdAt: 1 }], activeProfileId: "e2e-profile" })
      );
    }
    if (!localStorage.getItem("minecraft_worlds_v1")) {
      localStorage.setItem(
        "minecraft_worlds_v1",
        JSON.stringify({
          version: 1,
          worlds: [{ id: "e2e-world", profileId: "e2e-profile", name: "Test World", seed: 1337, worldgenVersion, createdAt: 1, lastPlayedAt: 1 }]
        })
      );
    }
  }, WORLDGEN_VERSION);

  // Online warm-up: register the worker and wait for the install precache.
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(
    async () => {
      const names = await caches.keys();
      const shellName = names.find((name) => name.startsWith("monecraft-shell-"));
      const assetName = names.find((name) => name.startsWith("monecraft-assets-"));
      if (!shellName || !assetName) return false;
      const shell = await caches.open(shellName);
      if (!(await shell.match("/"))) return false;
      const assets = await caches.open(assetName);
      return (await assets.keys()).length > 0;
    },
    undefined,
    { timeout: 30000 }
  );

  // Reload once so the page itself is worker-controlled, then cut the network.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 30000 });
  await context.setOffline(true);

  // Guard: the emulation really is offline for page-initiated fetches.
  expect(
    await page.evaluate(() =>
      fetch("/api/worlds").then(
        () => true,
        () => false
      )
    )
  ).toBe(false);

  await page.reload();
  // The navigation must have been served by the worker's cache, not a network
  // leak around the offline emulation (transferSize is 0 for cache-served).
  expect(await page.evaluate(() => (performance.getEntriesByType("navigation")[0] as PerformanceResourceTiming).transferSize)).toBe(0);

  // The welcome gate renders and a seeded local world boots and draws.
  await page.getByRole("button", { name: "Play locally" }).click();
  await page.getByTestId("profile-e2e-profile").click();
  await page.getByTestId("world-e2e-world").click();
  await page.waitForFunction(() => window.__monecraft !== undefined, undefined, { timeout: 30000 });
  await page.waitForFunction(() => window.__monecraft!.renderer.renderedTriangles() > 0, undefined, { timeout: 30000 });

  // The cache never picked up an /api entry, online or offline.
  const cachedApiUrls = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) {
        if (new URL(request.url).pathname.startsWith("/api/")) urls.push(request.url);
      }
    }
    return urls;
  });
  expect(cachedApiUrls).toEqual([]);
});
