import { test as base, expect, type Page } from "@playwright/test";
import { WORLDGEN_VERSION } from "@/lib/game/config";

/**
 * Shared E2E plumbing. Tests assert against the live simulation through the
 * window.__monecraft debug handle rather than pixels — see docs/testing.md.
 */

export const test = base.extend<{ gamePage: Page; touchMode: "on" | "off"; pauseOnBoot: boolean }>({
  // Seeds the persisted touch preference before boot: "on" forces the touch
  // controller regardless of device detection (Playwright's hasTouch does not
  // flip `pointer: coarse`, so auto-detection can't be exercised here — it's
  // unit-tested in touchSettings.test.ts instead).
  touchMode: ["off", { option: true }],
  // Pauses the engine before its very first step. Worldgen legitimately leaves
  // random-tickable blocks near spawn (growable kelp, cave-exposed dirt), and
  // tickRandomBlocks rides Math.random — so any unpaused boot frame can write a
  // block edit. Tests that need the world byte-identical to fresh generation
  // (determinism.e2e.ts) opt in. The pause menu overlays the scene, but the
  // canvas keeps rendering beneath it, so the fixture's triangle wait still
  // passes and __monecraft evaluates work as usual.
  pauseOnBoot: [false, { option: true }],
  // A page that has booted the game, with console errors treated as failures.
  // (The fixture continuation is named `runTest`, not Playwright's
  // conventional `use`, to avoid colliding with React's rules-of-hooks lint.)
  gamePage: async ({ page, touchMode, pauseOnBoot }, runTest) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      errors.push(`${message.text()} (${message.location().url})`);
    });
    page.on("pageerror", (error) => errors.push(String(error)));

    // Seed a known profile + world so the menu has something to enter. Runs on
    // every navigation (including reloads), but only fills the manifests when
    // absent so a test's own writes survive a reload.
    await page.addInitScript(
      ({ worldgenVersion, touch, pause }) => {
        // Trap the debug-handle assignment so the pause lands synchronously,
        // before useMinecraftGame registers the rAF loop — i.e. before the
        // engine can step even once. Pausing from the test body instead would
        // leave the whole menu-to-first-frame boot window simulating live.
        if (pause) {
          let handle: typeof window.__monecraft;
          Object.defineProperty(window, "__monecraft", {
            configurable: true,
            get: () => handle,
            set: (value: typeof window.__monecraft) => {
              handle = value;
              value?.engine.dispatch({ type: "pause" });
            }
          });
        }
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
        if (touch) localStorage.setItem("minecraft_touch_v1", JSON.stringify({ mode: "on" }));
      },
      { worldgenVersion: WORLDGEN_VERSION, touch: touchMode === "on", pause: pauseOnBoot }
    );

    await page.goto("/");
    // Enter the world through the menus (first load only; reloads auto-resume
    // the tab's world, skipping the welcome gate entirely).
    await page.getByRole("button", { name: "Play locally" }).click();
    await page.getByTestId("profile-e2e-profile").click();
    await page.getByTestId("world-e2e-world").click();
    await page.waitForFunction(() => window.__monecraft !== undefined, undefined, { timeout: 30000 });
    // Wait for the first frames so the engine has stepped and the scene drew.
    await page.waitForFunction(() => window.__monecraft!.renderer.renderedTriangles() > 0, undefined, { timeout: 30000 });

    await runTest(page);

    expect(errors, "no console/page errors during the test").toEqual([]);
  }
});

export { expect };

/**
 * The game boots at dawn with aggro hostiles near the spawn; interactive
 * tests clear them and move to midday so knockback can't disrupt input.
 */
export async function calmDaytime(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__monecraft!.engine.state;
    state.mobs = state.mobs.filter((mob) => !mob.hostile);
    state.dayClock = 60;
  });
}

export async function playerPosition(page: Page): Promise<{ x: number; y: number; z: number }> {
  return page.evaluate(() => {
    const { position } = window.__monecraft!.engine.state.player;
    return { x: position.x, y: position.y, z: position.z };
  });
}

/**
 * Double-clicks the canvas to request pointer lock; if the browser refuses
 * (headless Chromium cannot engage pointer lock at all), forces the input
 * controller's lock flag so everything downstream — keys → engine, held mouse
 * → mining — is still exercised for real. The acquisition UX itself stays in
 * the manual gameplay pass.
 */
export async function acquirePointerLock(page: Page): Promise<void> {
  const canvas = page.locator(".game-canvas-wrap canvas");
  await canvas.dblclick();
  try {
    await page.waitForFunction(() => document.pointerLockElement !== null, undefined, { timeout: 2000 });
  } catch {
    await page.evaluate(() => {
      window.__monecraft!.input.forcePointerLock(true);
    });
  }
}

export async function itemCount(page: Page, itemId: string): Promise<number> {
  return page.evaluate((id) => window.__monecraft!.engine.state.inventory.filter((slot) => slot.id === id).reduce((sum, slot) => sum + slot.count, 0), itemId);
}

/**
 * Reads the active session's world save straight out of IndexedDB (database
 * `monecraft`, store `worldSaves` — see lib/game/saveStore.ts), or null when
 * no record exists. World saves no longer live in localStorage.
 */
export async function readWorldSave(page: Page): Promise<{ seed: number; version: number } | null> {
  return page.evaluate(() => {
    const session = JSON.parse(sessionStorage.getItem("monecraft_active_session")!) as { worldId: string };
    return new Promise<{ seed: number; version: number } | null>((resolve, reject) => {
      const open = indexedDB.open("monecraft");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        // Settle on every path (incl. a missing store throwing from
        // transaction()) so a broken DB fails the assertion instead of
        // hanging the test until the Playwright timeout.
        try {
          const request = db.transaction("worldSaves", "readonly").objectStore("worldSaves").get(session.worldId);
          request.onerror = () => {
            db.close();
            reject(request.error);
          };
          request.onsuccess = () => {
            db.close();
            resolve((request.result as { seed: number; version: number } | undefined) ?? null);
          };
        } catch (error) {
          db.close();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };
    });
  });
}

/** Saves through the pause menu and waits for the "Saved" toast — which, with
 *  the IndexedDB store, fires only once the write has durably committed. */
export async function saveViaPauseMenu(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Save Game" }).click();
  await expect(page.locator(".pause-save-message")).toHaveText("Saved");
}
