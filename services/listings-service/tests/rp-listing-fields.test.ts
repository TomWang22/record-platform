import { describe, expect, it } from "vitest";

import { inferFormatFromTitle, parseRpListingFields, resolveRpFormat } from "../src/rp-listing-fields.js";

describe("rp-listing-fields", () => {
  it("infers LP from title bracket", () => {
    expect(inferFormatFromTitle("Miles Davis — Kind of Blue [VG+ LP]")).toBe("LP");
  });

  it("never maps apartment residence_type to format", () => {
    const row = {
      title: "Plain title",
      residence_type: "apartment",
      amenities: [],
    };
    expect(resolveRpFormat(row, {})).toBeUndefined();
    expect(parseRpListingFields(row).format).toBeUndefined();
  });

  it("reads format from amenities key:value", () => {
    const row = {
      title: "Test",
      amenities: ["format:LP", "media_condition:VG+"],
    };
    const rp = parseRpListingFields(row);
    expect(rp.format).toBe("LP");
    expect(rp.mediaCondition).toBe("VG+");
  });
});
