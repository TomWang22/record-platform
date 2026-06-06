import { describe, expect, it } from "vitest";
import {
  buildPublicOfferEvent,
  offerStatusDisplay,
  publicOfferResponseLeaksInternal,
} from "../src/listings-offers-contract.js";

describe("listings-offers-contract", () => {
  it("formats status display", () => {
    expect(offerStatusDisplay("pending")).toBe("Pending");
    expect(offerStatusDisplay("accepted")).toBe("Accepted");
  });

  it("buildPublicOfferEvent hides cents", () => {
    const ev = buildPublicOfferEvent(
      {
        id: "e1",
        offer_id: "o1",
        listing_id: "l1",
        actor_user_id: "u1",
        event_type: "created",
        previous_status: null,
        new_status: "pending",
        amount_cents: 2500,
        message: "hi",
        created_at: "2026-06-06T12:00:00.000Z",
      },
      "Buyer",
    );
    expect(ev.amountDisplay).toBe("$25.00");
    expect(publicOfferResponseLeaksInternal(ev)).toBeNull();
  });
});
