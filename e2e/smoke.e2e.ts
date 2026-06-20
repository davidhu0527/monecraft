import { acquirePointerLock, calmDaytime, expect, itemCount, playerPosition, test } from "./helpers";

test("boots without errors and renders the world", async ({ gamePage: page }) => {
  await expect(page.locator(".game-canvas-wrap canvas")).toBeVisible();
  await expect(page.getByTestId("hotbar")).toBeVisible();
  const triangles = await page.evaluate(() => window.__monecraft!.renderer.renderedTriangles());
  expect(triangles).toBeGreaterThan(0);

  // The audio director is wired up (still locked pre-gesture — the shared
  // console-error fixture proves boot stays clean without any unlock).
  expect(await page.evaluate(() => Boolean(window.__monecraft!.audio))).toBe(true);

  // The engine is alive: the day clock advances between frames.
  const clock1 = await page.evaluate(() => window.__monecraft!.engine.state.dayClock);
  await page.waitForTimeout(200);
  const clock2 = await page.evaluate(() => window.__monecraft!.engine.state.dayClock);
  expect(clock2).toBeGreaterThan(clock1);
});

test("the Dragon Lord HUD points toward the boss and shows its distance", async ({ gamePage: page }) => {
  await page.evaluate(() => {
    const state = window.__monecraft!.engine.state;
    const boss = state.mobs[0];
    boss.kind = "boss";
    boss.hostile = true;
    boss.hp = 1000;
    boss.speed = 0;
    boss.detectRange = 0;
    boss.position.set(state.player.position.x + 20, state.player.position.y, state.player.position.z);
    state.player.yaw = 0;
  });

  const hud = page.locator(".boss-bar");
  await expect(hud).toBeVisible();
  await expect(hud).toContainText("20 blocks");
  await expect(page.locator(".boss-pointer")).toHaveCSS("transform", "matrix(0, 1, -1, 0, 0, 0)");
});

test("pointer-lock flow enables WASD movement", async ({ gamePage: page }) => {
  await calmDaytime(page);
  await acquirePointerLock(page);

  await page.waitForTimeout(500); // settle onto the ground
  const before = await playerPosition(page);
  await page.keyboard.down("w");
  await page.waitForTimeout(700);
  await page.keyboard.up("w");
  const after = await playerPosition(page);

  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  expect(moved).toBeGreaterThan(0.5);
});

test("inventory opens and crafting works end to end", async ({ gamePage: page }) => {
  await calmDaytime(page);
  await page.keyboard.press("i");
  const panel = page.locator(".inventory-panel");
  await expect(panel).toBeVisible();

  const planksBefore = await itemCount(page, "planks"); // starter loadout: 20
  await panel.getByRole("button", { name: "2 Wood -> 4 Planks" }).click();

  expect(await itemCount(page, "planks")).toBe(planksBefore + 4);
  expect(await itemCount(page, "wood")).toBe(62);
  // The UI re-rendered from the new snapshot: the planks stack count updated.
  // Slots carry the item in their aria-label ("Slot N: Planks") — the old
  // native `title` was replaced by the custom hover tooltip.
  await expect(panel.locator('.inv-slot[aria-label$=": Planks"]').first()).toContainText(`${planksBefore + 4}`);

  await page.keyboard.press("i");
  await expect(panel).not.toBeVisible();
});

test("holding the mouse mines the block underfoot", async ({ gamePage: page }) => {
  await calmDaytime(page);
  await acquirePointerLock(page);
  await page.waitForTimeout(1000); // settle (slow CI renderers need the margin)

  // Aim straight down from the center of the cell (a ray origin exactly on a
  // cell boundary may target the diagonal neighbor — see docs/testing.md).
  await page.evaluate(() => {
    const { player } = window.__monecraft!.engine.state;
    player.pitch = -Math.PI / 2 + 0.02;
    player.position.x = Math.floor(player.position.x) + 0.5;
    player.position.z = Math.floor(player.position.z) + 0.5;
  });

  await page.mouse.down();
  // Generous timeout: CI renders with software GL at single-digit FPS.
  await expect.poll(async () => page.evaluate(() => window.__monecraft!.engine.state.blockChanges.changes().length), { timeout: 30000 }).toBeGreaterThan(0);
  await page.mouse.up();
});

test("right-click still places a block when not aimed at an interactive one", async ({ gamePage: page }) => {
  // The bed/furnace interact dispatcher sits in front of placement; this guards
  // that a non-interactive target still falls through to placing a block.
  await calmDaytime(page);
  await acquirePointerLock(page);
  await page.waitForTimeout(1000); // settle

  // Carve a clear lane ending in a stone backstop, dead ahead at eye height.
  const placed = await page.evaluate(() => {
    const state = window.__monecraft!.engine.state;
    const ex = Math.floor(state.player.position.x);
    const ez = Math.floor(state.player.position.z);
    state.player.position.x = ex + 0.5;
    state.player.position.z = ez + 0.5;
    state.player.yaw = 0;
    state.player.pitch = 0;
    const ey = Math.floor(state.player.position.y + 1.62);
    // 1 = Grass, 0 = Air, 3 = Stone (BlockId enum values).
    state.blockChanges.set(ex, ey, ez - 1, 0);
    state.blockChanges.set(ex, ey, ez - 2, 0);
    state.blockChanges.set(ex, ey, ez - 3, 3);
    state.selectedSlot = 0; // starter grass blocks
    const before = state.world.get(ex, ey, ez - 2);
    window.__monecraft!.engine.dispatch({ type: "placeBlock" });
    const after = state.world.get(ex, ey, ez - 2);
    return { before, after };
  });
  expect(placed.before).toBe(0); // air
  expect(placed.after).toBe(1); // grass placed
});

test("a chest opens, stores an item, and keeps it across a reload", async ({ gamePage: page }) => {
  await calmDaytime(page);
  await acquirePointerLock(page);
  await page.waitForTimeout(1000); // settle (slow CI renderers need the margin)

  // Build a deterministic spot: a chest as the floor with cleared headroom, the
  // player standing on it looking straight down, then right-click — all in one
  // step so the down-ray can only hit the chest (interact wins over placement,
  // so it opens). `round` (not `floor`) tolerates the player resting a hair
  // below the integer after collision resolution.
  const chestIndex = await page.evaluate(() => {
    const engine = window.__monecraft!.engine;
    const state = engine.state;
    const x = Math.floor(state.player.position.x);
    const z = Math.floor(state.player.position.z);
    const groundY = Math.round(state.player.position.y) - 1;
    state.blockChanges.set(x, groundY, z, 27); // BlockId.Chest, the floor
    state.blockChanges.set(x, groundY + 1, z, 0); // Air headroom (feet/body/head)
    state.blockChanges.set(x, groundY + 2, z, 0);
    state.blockChanges.set(x, groundY + 3, z, 0);
    state.player.position.set(x + 0.5, groundY + 1, z + 0.5);
    state.player.velocity.set(0, 0, 0);
    state.player.pitch = -Math.PI / 2 + 0.02;
    engine.dispatch({ type: "placeBlock" });
    return state.world.index(x, groundY, z);
  });

  // The chest grid appears once the snapshot propagates to React.
  await expect(page.getByTestId("chest-grid")).toBeVisible();

  // Move the starter grass stack (inventory slot 0) into the first chest slot
  // through the same command the panel dispatches (chest slot 0 = base + 0).
  await page.evaluate(() => window.__monecraft!.engine.dispatch({ type: "moveStack", from: 0, to: 1000 }));
  const storedId = await page.evaluate(() => {
    const state = window.__monecraft!.engine.state;
    return state.containers.get(state.openContainerIndex!)![0].id;
  });
  expect(storedId).toBe("grass");

  // Persist and reload: the chest block-entity survives in the per-world save.
  await page.evaluate(() => {
    const session = JSON.parse(sessionStorage.getItem("monecraft_active_session")!) as { worldId: string };
    localStorage.setItem(`minecraft_world_save_${session.worldId}`, JSON.stringify(window.__monecraft!.engine.serialize()));
  });
  await page.reload();
  await page.waitForFunction(() => window.__monecraft !== undefined, undefined, { timeout: 30000 });

  const restoredId = await page.evaluate((idx) => window.__monecraft!.engine.state.containers.get(idx)?.[0]?.id ?? null, chestIndex);
  expect(restoredId).toBe("grass");
});

test("V cycles the camera views and the scene keeps rendering", async ({ gamePage: page }) => {
  await calmDaytime(page);
  const cameraMode = () => page.evaluate(() => window.__monecraft!.engine.state.cameraMode);

  expect(await cameraMode()).toBe("first");
  await page.keyboard.press("v");
  expect(await cameraMode()).toBe("third-rear");
  // The third-person scene (player body included) still draws.
  await expect.poll(() => page.evaluate(() => window.__monecraft!.renderer.renderedTriangles())).toBeGreaterThan(0);

  await page.keyboard.press("v");
  expect(await cameraMode()).toBe("third-front");
  await page.keyboard.press("v");
  expect(await cameraMode()).toBe("first");

  // V keeps working from the pause menu (render-only, like Minecraft F5).
  await page.keyboard.press("Escape"); // unlocked, so Escape pauses directly
  await expect(page.getByRole("button", { name: "Back to Game" })).toBeVisible();
  await page.keyboard.press("v");
  expect(await cameraMode()).toBe("third-rear");
  await page.keyboard.press("Escape"); // resume
});

test("the pause menu freezes the game and resumes it", async ({ gamePage: page }) => {
  await calmDaytime(page);
  await page.keyboard.press("Escape"); // unlocked, so Escape pauses directly
  await expect(page.getByRole("button", { name: "Back to Game" })).toBeVisible();

  const clock1 = await page.evaluate(() => window.__monecraft!.engine.state.dayClock);
  await page.waitForTimeout(250);
  const clock2 = await page.evaluate(() => window.__monecraft!.engine.state.dayClock);
  expect(clock2).toBe(clock1);

  await page.getByRole("button", { name: "Back to Game" }).click();
  await expect(page.getByRole("button", { name: "Back to Game" })).not.toBeVisible();
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__monecraft!.engine.state.dayClock)).toBeGreaterThan(clock2);
});

test("picking a skin persists across a reload", async ({ gamePage: page }) => {
  await calmDaytime(page);
  await page.keyboard.press("Escape"); // unlocked, so Escape pauses directly
  await page.getByRole("button", { name: "Robot skin" }).click();

  // The skin now lives on the active profile, not a global key.
  const storedSkin = await page.evaluate(() => {
    const manifest = JSON.parse(localStorage.getItem("minecraft_profiles_v1")!);
    return manifest.profiles.find((p: { id: string }) => p.id === manifest.activeProfileId).skinId as string;
  });
  expect(storedSkin).toBe("robot");

  await page.reload();
  await page.waitForFunction(() => window.__monecraft !== undefined, undefined, { timeout: 30000 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Robot skin" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Steve skin" })).toHaveAttribute("aria-pressed", "false");
});

test("saving from the pause menu persists the world across a reload", async ({ gamePage: page }) => {
  await calmDaytime(page);
  const seed = await page.evaluate(() => window.__monecraft!.engine.state.world.seed);
  const positionBefore = await playerPosition(page);

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Save Game" }).click();
  const saved = await page.evaluate(() => {
    const session = JSON.parse(sessionStorage.getItem("monecraft_active_session")!) as { worldId: string };
    return localStorage.getItem(`minecraft_world_save_${session.worldId}`);
  });
  expect(saved).not.toBeNull();
  expect(JSON.parse(saved!).seed).toBe(seed);
  expect(JSON.parse(saved!).version).toBe(6);

  await page.reload();
  await page.waitForFunction(() => window.__monecraft !== undefined, undefined, { timeout: 30000 });

  expect(await page.evaluate(() => window.__monecraft!.engine.state.world.seed)).toBe(seed);
  const positionAfter = await playerPosition(page);
  expect(Math.abs(positionAfter.x - positionBefore.x)).toBeLessThan(2);
  expect(Math.abs(positionAfter.z - positionBefore.z)).toBeLessThan(2);
});
