import { describe, expect, it } from "vitest";
import {
  buildPublicListingFromRow,
  publicListingResponseLeaksInternalPricing,
} from "../src/listing-public-contract.js";
import { publicListingResponseLeaksPrivateData } from "../src/listing-public-privacy.js";

describe("listing-public-contract", () => {
  it("search and detail shapes share priceDisplay without price_cents", () => {
    const row = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      user_id: "660e8400-e29b-41d4-a716-446655440001",
      username_display: "Vinyl Seller",
      title: "Kind of Blue LP",
      description: "Classic jazz.",
      price_cents: 4599,
      status: "active",
      created_at: "2026-06-01T12:00:00.000Z",
      updated_at: "2026-06-02T15:30:00.000Z",
      listed_at: "2026-06-01T12:00:00.000Z",
      amenities: { format: "LP", media_condition: "NM", sleeve_condition: "VG+" },
      primary_image_url: "https://example.com/cover.jpg",
      city: "Brooklyn",
      state_or_province: "NY",
      country: "US",
    };
    const search = buildPublicListingFromRow(row);
    const detail = buildPublicListingFromRow(
      {
        ...row,
        images_json: ["https://example.com/cover.jpg"],
        media_items_json: [
          {
            id: "m1",
            url_or_path: "https://example.com/cover.jpg",
            media_type: "image",
            sort_order: 0,
          },
        ],
      },
      { includePrivateAddress: false, includeOwnerIds: false },
    );

    expect(search.price).toBe(45.99);
    expect(search.priceDisplay).toBe("$45.99");
    expect(detail.priceDisplay).toBe(search.priceDisplay);
    expect(detail.seller).toBe(search.seller);
    expect(detail.format).toBe("LP");
    expect(search.format).toBe("LP");
    expect((detail.images as string[]).length).toBeGreaterThan(0);

    expect(publicListingResponseLeaksInternalPricing(search)).toBeNull();
    expect(publicListingResponseLeaksInternalPricing(detail)).toBeNull();
    expect(search.price_cents).toBeUndefined();
    expect(detail.price_cents).toBeUndefined();
  });

  it("rejects housing keys in public payload", () => {
    const pub = buildPublicListingFromRow({
      id: "l1",
      title: "Test",
      price_cents: 1000,
      residence_type: "apartment",
      landlord_id: "u1",
      bedrooms: 2,
    });
    expect(pub.residence_type).toBeUndefined();
    expect(pub.landlord_id).toBeUndefined();
    expect(publicListingResponseLeaksPrivateData(pub)).toBeNull();
  });
});
