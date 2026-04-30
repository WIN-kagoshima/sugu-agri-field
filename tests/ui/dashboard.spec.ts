import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const here = fileURLToPath(new URL(".", import.meta.url));
const DASHBOARD_PATH = resolve(here, "../../dist/ui/dashboard.html");

test.describe("MCP Apps UI bundle (dashboard.html)", () => {
  test.skip(!existsSync(DASHBOARD_PATH), "Run `npm run build:ui` first");

  test("renders the dashboard shell and exposes the global app bridge", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
    });

    await page.goto(pathToFileURL(DASHBOARD_PATH).toString());

    // The React shell mounts a #root element with the dashboard sidebar.
    await expect(page.locator("#root")).toBeVisible({ timeout: 10_000 });

    // Top-level dashboard heading is always rendered (offline-friendly).
    await expect(page.getByText(/SuguAgriField/i)).toBeVisible();

    // No uncaught JS errors at boot.
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("falls back gracefully when no MCP Apps host bridge is present", async ({ page }) => {
    await page.goto(pathToFileURL(DASHBOARD_PATH).toString());

    // useAppBridge should detect missing window.app and surface a fallback
    // banner so users understand they're seeing the standalone preview.
    const fallback = page.getByText(/standalone preview|no host detected|fallback/i);
    await expect(fallback).toBeVisible({ timeout: 5_000 });
  });
});
