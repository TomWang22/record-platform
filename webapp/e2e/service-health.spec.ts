import { test, expect } from "@playwright/test";

/**
 * Edge / API readiness (extend with per-service routes as they stabilize).
 * Set E2E_API_BASE (e.g. https://record-platform.test) and optional E2E_EXTRA_URLS=comma,list
 */
test.describe("service health", () => {
  test("edge API readyz", async ({ request }) => {
    const res = await request.get("/api/readyz", { maxRedirects: 5 });
    expect(res.ok(), `readyz status ${res.status()}`).toBeTruthy();
  });

  test("extra URLs from E2E_EXTRA_URLS", async ({ request }) => {
    const raw = process.env.E2E_EXTRA_URLS?.trim();
    if (!raw) test.skip();
    const urls = raw.split(",").map((u) => u.trim()).filter(Boolean);
    for (const url of urls) {
      const res = await request.get(url);
      expect(res.ok(), `${url} -> ${res.status()}`).toBeTruthy();
    }
  });
});
