import { describe, expect, it } from "vitest";

import { rewriteListingsProxyPath } from "../listings-path-rewrite.js";

describe("rewriteListingsProxyPath", () => {
  it("maps create and mine to listings-service root routes", () => {
    expect(rewriteListingsProxyPath("/create")).toBe("/create");
    expect(rewriteListingsProxyPath("create")).toBe("/create");
    expect(rewriteListingsProxyPath("/mine")).toBe("/mine");
  });

  it("maps search and settings to root", () => {
    expect(rewriteListingsProxyPath("/search")).toBe("/search");
    expect(rewriteListingsProxyPath("/settings")).toBe("/settings");
  });

  it("maps UUID listing detail under /listings/", () => {
    const id = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    expect(rewriteListingsProxyPath(`/${id}`)).toBe(`/listings/${id}`);
    expect(rewriteListingsProxyPath(`/${id}/revisions`)).toBe(`/listings/${id}/revisions`);
  });
});
