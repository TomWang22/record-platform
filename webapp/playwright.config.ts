import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.E2E_API_BASE?.replace(/\/$/, "") || "https://record-platform.test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: require.resolve("./e2e/global-setup"),
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
    extraHTTPHeaders: {
      "X-RP-E2E-Contract": "1",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
