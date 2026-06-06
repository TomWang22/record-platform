import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Static contract: /listings/search must register before catch-all /listings/:id
 * (avoids treating "search" as a UUID). No live upstream — safe during cold-bootstrap audits.
 */
describe("listings search route registration order", () => {
  const appSrc = readFileSync(join(process.cwd(), "src/app.ts"), "utf8");

  it("registers /listings/search before generic /listings proxy", () => {
    const searchIdx = appSrc.indexOf('["/listings/search", "/api/listings/search"]');
    const catchAllIdx = appSrc.indexOf('app.use(\n  "/listings",');
    expect(searchIdx).toBeGreaterThan(-1);
    expect(catchAllIdx).toBeGreaterThan(-1);
    expect(searchIdx).toBeLessThan(catchAllIdx);
  });

  it("search route rewrites to /listings/search upstream path", () => {
    const start = appSrc.indexOf('["/listings/search", "/api/listings/search"]');
    expect(start).toBeGreaterThan(-1);
    const slice = appSrc.slice(start, start + 900);
    expect(slice).toContain('pathRewrite: () => "/listings/search"');
  });
});
