import { expect, test } from "@playwright/test";

/**
 * Profile/world menu flow. Unlike the gameplay smoke suite (which seeds a world
 * and enters it via a fixture), these start from empty storage and drive the
 * real menus. A fresh install runs the legacy migration, which seeds a default
 * "Player" profile with no worlds.
 */

test("create worlds, play them, and switch between them without a reload", async ({ page }) => {
  await page.goto("/");

  // Enter the migration-created default profile.
  await page.getByText("Player", { exact: true }).click();
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

test("reloading resumes the world being played", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Player", { exact: true }).click();
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

  // Create a second profile; it lands in its own empty world list.
  await page.getByTestId("new-profile").click();
  await page.getByLabel("Profile name").fill("Alice");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText(/No worlds yet/i)).toBeVisible();

  // Back at the profile list, both the default and the new profile are present.
  await page.getByTestId("back-to-profiles").click();
  await expect(page.getByText("Player", { exact: true })).toBeVisible();
  await expect(page.getByText("Alice", { exact: true })).toBeVisible();
});
