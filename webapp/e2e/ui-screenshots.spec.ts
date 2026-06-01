import { test, expect } from "@playwright/test";
import path from "path";

const SCREENSHOT_DIR = path.join(__dirname, "screenshots");

const pages: { name: string; path: string; waitFor?: string }[] = [
  { name: "home", path: "/" },
  { name: "login", path: "/login" },
  { name: "register", path: "/register" },
  { name: "records", path: "/records" },
  { name: "records-new", path: "/records/new" },
  { name: "listings", path: "/listings" },
  { name: "market", path: "/market" },
  { name: "messages", path: "/messages" },
  { name: "cart", path: "/cart" },
  { name: "dashboard", path: "/dashboard" },
  { name: "insights", path: "/insights" },
  { name: "settings", path: "/settings" },
  { name: "auctions", path: "/auctions" },
  { name: "forum", path: "/forum" },
  { name: "integrations", path: "/integrations" },
  { name: "observation-deck", path: "/observation-deck" },
  { name: "about", path: "/about" },
  { name: "privacy", path: "/privacy" },
  { name: "terms", path: "/terms" },
];

test.describe("UI screenshots — all RP pages", () => {
  for (const pg of pages) {
    test(`screenshot: ${pg.name} (${pg.path})`, async ({ page }) => {
      const isInsights = pg.path === "/insights";
      const res = await page.goto(pg.path, {
        waitUntil: isInsights ? "domcontentloaded" : "networkidle",
        timeout: isInsights ? 60_000 : 30_000,
      });
      if (isInsights) {
        await expect(page.getByRole("heading", { name: /Insights & AI/i })).toBeVisible({
          timeout: 45_000,
        });
      }
      expect(res).not.toBeNull();
      expect(res!.status()).toBeLessThan(500);

      if (pg.waitFor) {
        await page.waitForSelector(pg.waitFor, { timeout: 10_000 }).catch(() => {});
      }

      await page.waitForTimeout(1000);

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${pg.name}.png`),
        fullPage: true,
      });
    });
  }
});

test.describe("API health endpoints", () => {
  const healthEndpoints = [
    "/api/readyz",
    "/api/healthz",
    "/api/auth/healthz",
    "/api/listings/healthz",
    "/api/trust/healthz",
  ];

  for (const ep of healthEndpoints) {
    test(`health: ${ep}`, async ({ request }) => {
      const res = await request.get(ep, { maxRedirects: 5 });
      expect(res.ok(), `${ep} → ${res.status()}`).toBeTruthy();
    });
  }
});
