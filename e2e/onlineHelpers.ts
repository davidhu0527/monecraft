import { expect, type Page } from "@playwright/test";

/**
 * Shared plumbing for the two-browser online journeys (multiplayer.e2e.ts,
 * nether-online.e2e.ts): the account/registration menu walk and the "booted,
 * synced, drawing" bar every online entry must clear. Extracted verbatim from
 * the co-op journey so both specs drive the identical real stack.
 */

/** Console/page errors collected like the smoke fixture does (favicon 404 is noise). */
export function watchErrors(page: Page, sink: string[]): void {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text().includes("Failed to load resource") && message.location().url.endsWith("/favicon.ico")) return;
    sink.push(`${message.text()} (${message.location().url})`);
  });
  page.on("pageerror", (error) => sink.push(String(error)));
}

/** Booted, synced, and drawing: the bar every online entry must clear. */
export async function waitForOnlineGame(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__monecraft !== undefined, undefined, { timeout: 30000 });
  await page.waitForFunction(() => window.__monecraft!.net?.status() === "online", undefined, { timeout: 30000 });
  await page.waitForFunction(() => window.__monecraft!.renderer.renderedTriangles() > 0, undefined, { timeout: 30000 });
}

/** Registers a fresh account: welcome gate's "Sign in" → auth screen → sign-up. */
export async function signUp(page: Page, name: string, email: string): Promise<void> {
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "I need an account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Display name").fill(name);
  await page.getByLabel("Password").fill("hunter2hunter2");
  await page.getByRole("button", { name: "Create account" }).click();
}

/** From the account home, creates an online profile and enters its world list. */
export async function createOnlineProfile(page: Page, name: string): Promise<void> {
  // Sign-up → session probe → account home spans two network hops.
  await expect(page.getByText("Online Profiles")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("new-online-profile").click();
  await page.getByLabel("Profile name").fill(name);
  // exact: "Create account" (form) and "Create World" share the substring.
  await page.getByRole("button", { name: "Create", exact: true }).click();
}
