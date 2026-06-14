import { expect, test } from "@playwright/test";

/**
 * Profile/world menu flow. Unlike the gameplay smoke suite (which seeds a world
 * and enters it via a fixture), these start from empty storage and drive the
 * real menus. A fresh install has no profiles, so the shell opens straight into
 * the create-profile form.
 */

/** Fresh install → create a profile through the first-run form, landing on its world list. */
async function createProfile(page: import("@playwright/test").Page, name: string): Promise<void> {
  await page.getByLabel("Profile name").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
}

test("create worlds, play them, and switch between them without a reload", async ({ page }) => {
  await page.goto("/");

  await createProfile(page, "Tester");
  await expect(page.getByText(/No worlds yet/i)).toBeVisible();

  // Create the first world with a fixed seed and play it.
  await page.getByTestId("new-world").click();
  await page.getByLabel("World name").fill("Alpha");
  await page.getByLabel("World seed").fill("100");
  await page.getByRole("button", { name: "Create World" }).click();

  await page.waitForFunction(() => window.__monecraft !== undefined, undefined, { timeout: 30000 });
  expect(await page.evaluate(() => window.__monecraft!.engine.state.world.seed)).toBe(100);

  // A marker on window survives a React remount but not a real page navigation,
  // so it proves the upcoming world switch happens in-app with no reload.
  await page.evaluate(() => ((window as unknown as { __noReload?: boolean }).__noReload = true));

  // Quit back to the world list and create a second world with a different seed.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Save & Quit to Worlds" }).click();
  await expect(page.getByText("Alpha")).toBeVisible();

  await page.getByTestId("new-world").click();
  await page.getByLabel("World name").fill("Beta");
  await page.getByLabel("World seed").fill("200");
  await page.getByRole("button", { name: "Create World" }).click();

  await page.waitForFunction(() => window.__monecraft?.engine.state.world.seed === 200, undefined, { timeout: 30000 });
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
});

test("a Superflat world generates level terrain near spawn", async ({ page }) => {
  await page.goto("/");
  await createProfile(page, "Builder");

  await page.getByTestId("new-world").click();
  await page.getByLabel("World name").fill("Flats");
  await page.getByRole("button", { name: "Superflat world type" }).click();
  await page.getByLabel("World seed").fill("1337");
  await page.getByRole("button", { name: "Create World" }).click();
  await page.waitForFunction(() => window.__monecraft !== undefined, undefined, { timeout: 30000 });

  // Sample surface heights around spawn; on flat terrain they cluster tightly
  // (occasional trees/caves are the only outliers).
  const within = await page.evaluate(() => {
    const world = window.__monecraft!.engine.state.world;
    const p = window.__monecraft!.engine.state.player.position;
    const cx = Math.floor(p.x);
    const cz = Math.floor(p.z);
    const heights: number[] = [];
    for (let dx = -15; dx <= 15; dx += 3) {
      for (let dz = -15; dz <= 15; dz += 3) heights.push(world.highestSolidY(cx + dx, cz + dz));
    }
    heights.sort((a, b) => a - b);
    const median = heights[Math.floor(heights.length / 2)];
    return heights.filter((h) => Math.abs(h - median) <= 1).length / heights.length;
  });
  expect(within).toBeGreaterThan(0.6);
});

test("reloading resumes the world being played", async ({ page }) => {
  await page.goto("/");
  await createProfile(page, "Tester");
  await page.getByTestId("new-world").click();
  await page.getByLabel("World name").fill("Persistent");
  await page.getByLabel("World seed").fill("777");
  await page.getByRole("button", { name: "Create World" }).click();
  await page.waitForFunction(() => window.__monecraft?.engine.state.world.seed === 777, undefined, { timeout: 30000 });

  await page.reload();
  // No menu click needed — the tab resumes straight back into the same world.
  await page.waitForFunction(() => window.__monecraft?.engine.state.world.seed === 777, undefined, { timeout: 30000 });
});

test("profiles own separate world lists", async ({ page }) => {
  await page.goto("/");

  // The first profile is created through the forced first-run form.
  await createProfile(page, "Bob");
  await expect(page.getByText(/No worlds yet/i)).toBeVisible();
  await page.getByTestId("back-to-profiles").click();

  // A second profile is added from the list and lands in its own empty world list.
  await page.getByTestId("new-profile").click();
  await createProfile(page, "Alice");
  await expect(page.getByText(/No worlds yet/i)).toBeVisible();

  // Back at the profile list, both profiles are present.
  await page.getByTestId("back-to-profiles").click();
  await expect(page.getByText("Bob", { exact: true })).toBeVisible();
  await expect(page.getByText("Alice", { exact: true })).toBeVisible();
});
