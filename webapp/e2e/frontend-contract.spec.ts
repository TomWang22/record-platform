import { test, expect } from "@playwright/test";

const genericErrorTexts = [
  "Failed to fetch",
  "An unexpected error occurred",
  "Off-Campus-Housing-Tracker",
  "Off-Campus Housing",
];

const authRequiredRawText = "auth required";

const pages = [
  { path: "/", name: "home" },
  { path: "/login", name: "login" },
  { path: "/register", name: "register" },
  { path: "/records", name: "records" },
  { path: "/listings", name: "listings" },
  { path: "/cart", name: "cart" },
  { path: "/market", name: "sell-list" },
  { path: "/messages", name: "messages" },
  { path: "/insights", name: "insights" },
  { path: "/integrations", name: "integrations" },
  { path: "/observation-deck", name: "observation-deck" },
  { path: "/settings", name: "settings" },
  { path: "/privacy", name: "privacy" },
  { path: "/terms", name: "terms" },
  { path: "/about", name: "about" },
  { path: "/dashboard", name: "dashboard" },
  { path: "/auctions", name: "auctions" },
  { path: "/forum", name: "forum" },
];

test.describe("Frontend contract — no generic errors", () => {
  for (const pg of pages) {
    test(`${pg.name} (${pg.path}): no generic error text`, async ({ page }) => {
      const waitUntil = pg.path === "/insights" ? "domcontentloaded" : "networkidle";
      const timeout = pg.path === "/insights" ? 60_000 : 30_000;
      await page.goto(pg.path, { waitUntil, timeout });
      if (pg.path === "/insights") {
        await expect(page.getByRole("heading", { name: /AI Insights/i })).toBeVisible({
          timeout: 45_000,
        });
      }

      for (const text of genericErrorTexts) {
        const count = await page.getByText(text, { exact: false }).count();
        expect(count, `"${text}" should not appear on ${pg.path}`).toBe(0);
      }
    });
  }

  for (const pg of pages) {
    if (["/login", "/register"].includes(pg.path)) continue;

    test(`${pg.name} (${pg.path}): no raw "auth required" text`, async ({
      page,
    }) => {
      const waitUntil = pg.path === "/insights" ? "domcontentloaded" : "networkidle";
      const timeout = pg.path === "/insights" ? 60_000 : 30_000;
      await page.goto(pg.path, { waitUntil, timeout });
      if (pg.path === "/insights") {
        await expect(page.getByRole("heading", { name: /AI Insights/i })).toBeVisible({
          timeout: 45_000,
        });
      }

      const bodyText = await page.textContent("body");
      const hasRawAuth =
        bodyText?.includes('"error":"auth required"') ||
        bodyText?.includes('"error": "auth required"');
      expect(
        hasRawAuth,
        `Raw JSON "auth required" should not appear on ${pg.path}`,
      ).toBeFalsy();
    });
  }
});

test.describe("Frontend contract — branding", () => {
  for (const pg of pages) {
    test(`${pg.name} (${pg.path}): no stale OCH branding`, async ({
      page,
    }) => {
      const waitUntil = pg.path === "/insights" ? "domcontentloaded" : "networkidle";
      const timeout = pg.path === "/insights" ? 60_000 : 30_000;
      await page.goto(pg.path, { waitUntil, timeout });
      if (pg.path === "/insights") {
        await expect(page.getByRole("heading", { name: /AI Insights/i })).toBeVisible({
          timeout: 45_000,
        });
      }

      const bodyText = (await page.textContent("body")) ?? "";
      expect(
        bodyText.includes("Off-Campus-Housing-Tracker"),
        `"Off-Campus-Housing-Tracker" found on ${pg.path}`,
      ).toBeFalsy();
    });
  }
});

test.describe("Frontend contract — sidebar", () => {
  test("sidebar shows sign-in or user controls", async ({ page }) => {
    await page.goto("/dashboard", {
      waitUntil: "networkidle",
      timeout: 30_000,
    });

    const signIn = page.getByText("Sign in");
    const signOut = page.getByText("Sign out");
    const hasSignIn = (await signIn.count()) > 0;
    const hasSignOut = (await signOut.count()) > 0;
    expect(
      hasSignIn || hasSignOut,
      "Sidebar must have either Sign in or Sign out",
    ).toBeTruthy();
  });
});
