import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright is used ONLY for the MCP Apps UI bundle (dist/ui/dashboard.html).
 * The bundle is offline (single HTML, inlined JS/CSS), so we serve it as a
 * file:// URL — no dev server required.
 */
export default defineConfig({
  testDir: "tests/ui",
  testMatch: ["**/*.spec.ts"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
