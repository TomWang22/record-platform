import { describe, expect, it } from "vitest";
import { computeProxySettlement, minimumNextBidCents } from "../src/listings-auction-proxy.js";

describe("listings-auction-proxy", () => {
  it("first bidder sets current to starting bid", () => {
    const s = computeProxySettlement({
      startingBidCents: 1000,
      bidIncrementCents: 100,
      reserveCents: null,
      previousCurrentBidCents: 0,
      previousHighBidderId: null,
      proxies: [],
      newBidderUserId: "user-a",
      newMaxBidCents: 5000,
      bidSource: "proxy_auto",
    });
    expect(s.currentBidCents).toBe(1000);
    expect(s.highBidderUserId).toBe("user-a");
    expect(s.increments).toHaveLength(1);
  });

  it("second proxy bidder raises to second max + increment", () => {
    const s = computeProxySettlement({
      startingBidCents: 1000,
      bidIncrementCents: 100,
      reserveCents: null,
      previousCurrentBidCents: 1000,
      previousHighBidderId: "user-a",
      proxies: [{ bidderUserId: "user-a", maxBidCents: 5000 }],
      newBidderUserId: "user-b",
      newMaxBidCents: 3000,
      bidSource: "proxy_auto",
    });
    expect(s.currentBidCents).toBe(3100);
    expect(s.highBidderUserId).toBe("user-b");
    expect(s.outbidUserIds).toContain("user-a");
  });

  it("minimum next bid uses increment", () => {
    expect(
      minimumNextBidCents({
        startingBidCents: 1000,
        currentBidCents: 1500,
        bidIncrementCents: 100,
        hasBids: true,
      }),
    ).toBe(1600);
  });
});
