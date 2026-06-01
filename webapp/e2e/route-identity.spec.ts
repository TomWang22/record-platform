import { test, expect } from "@playwright/test";

const APP_SHELL_MARKER = "Catalog Intelligence";

type RouteExpectation = {
  path: string;
  name: string;
  mustContain: RegExp | string;
  mustNotBeStandaloneLogin?: boolean;
};

const protectedRoutes: RouteExpectation[] = [
  { path: "/dashboard", name: "dashboard", mustContain: /My Collection|Welcome back/i },
  { path: "/records", name: "records", mustContain: /My collection|Sign in to view your collection/i },
  { path: "/records/new", name: "records-new", mustContain: /Add new record/i },
  { path: "/cart", name: "cart", mustContain: /Shopping Cart/i },
  { path: "/auctions", name: "auctions", mustContain: /Auction Monitor/i },
  { path: "/listings", name: "listings", mustContain: /Marketplace Listings|Sign in to browse/i },
  { path: "/market", name: "sell-list", mustContain: /Create listing|List a record|Sell/i },
  { path: "/settings", name: "settings", mustContain: /Settings|Sign in/i },
  { path: "/observation-deck", name: "observation-deck", mustContain: /Observation deck|Sign in/i },
];

async function hasAppShell(page: import("@playwright/test").Page): Promise<boolean> {
  const body = (await page.textContent("body")) ?? "";
  return body.includes(APP_SHELL_MARKER) || (await page.locator("aside").count()) > 0;
}

async function isStandaloneLoginPage(page: import("@playwright/test").Page): Promise<boolean> {
  const hasShell = await hasAppShell(page);
  if (hasShell) return false;
  const signInHeading = await page.getByRole("heading", { name: /Sign in/i }).count();
  const emailField = await page.getByLabel(/Email/i).count();
  return signInHeading > 0 && emailField > 0;
}

test.describe("Route identity — protected app routes", () => {
  for (const route of protectedRoutes) {
    test(`${route.name} (${route.path}): app shell + page identity, not standalone login`, async ({
      page,
    }) => {
      await page.goto(route.path, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(500);

      expect(await hasAppShell(page), `${route.path} must render AppShell`).toBeTruthy();
      expect(
        await isStandaloneLoginPage(page),
        `${route.path} must not render standalone /login page`,
      ).toBeFalsy();

      await expect(
        page.getByRole("heading", { level: 1, name: route.mustContain }).first(),
        `${route.path} must show expected page heading`,
      ).toBeVisible({ timeout: 15_000 });
    });
  }
});

test.describe("Route identity — login page", () => {
  test("/login is standalone (no app shell nav)", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded", timeout: 30_000 });

    expect(await page.getByRole("heading", { name: /Sign in/i }).count()).toBeGreaterThan(0);
    expect(await hasAppShell(page)).toBeFalsy();
    expect(await page.getByText("Auction Monitor").count()).toBe(0);
  });
});
