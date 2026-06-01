import { describe, expect, it } from "vitest";
import {
  publicListingResponseLeaksPrivateData,
  toPublicListingShape,
} from "../src/listing-public-privacy.js";

describe("listing-public-privacy", () => {
  it("strips street address and coordinates from public shape", () => {
    const pub = toPublicListingShape({
      id: "l1",
      title: "Blue Note press",
      address_line1: "123 Secret St",
      address_line2: "Apt 9",
      postal_code: "01002",
      latitude: 42.39,
      longitude: -72.53,
      city: "Amherst",
      state_or_province: "MA",
      country: "US",
      user_id: "u1",
      bedrooms: 3,
    });
    expect(pub.address_line1).toBeUndefined();
    expect(pub.latitude).toBeUndefined();
    expect(pub.longitude).toBeUndefined();
    expect(pub.user_id).toBeUndefined();
    expect(pub.bedrooms).toBeUndefined();
    expect(pub.seller_city).toBe("Amherst");
    expect(pub.seller_region).toBe("MA");
    expect(pub.seller_country).toBe("US");
    expect(pub.approximate_location_label).toBeTruthy();
  });

  it("allows private address fields for owner view", () => {
    const owner = toPublicListingShape(
      {
        id: "l1",
        address_line1: "123 Secret St",
        city: "Amherst",
        user_id: "u1",
      },
      { includePrivateAddress: true, includeOwnerIds: true },
    );
    expect(owner.address_line1).toBe("123 Secret St");
    expect(owner.user_id).toBe("u1");
  });

  it("detects leaks in nested search payloads", () => {
    const leak = publicListingResponseLeaksPrivateData({
      items: [{ address_line1: "hidden" }],
    });
    expect(leak).toBe("items.address_line1");
  });
});
