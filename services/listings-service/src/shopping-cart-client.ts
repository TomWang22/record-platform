/**
 * Reserve accepted OBO offer in buyer cart (shopping-service internal route).
 */
const SHOPPING_HTTP_TARGET =
  process.env.SHOPPING_HTTP_TARGET || "http://shopping-service:4007";

const INTERNAL_SECRET = (
  process.env.LISTINGS_BOOKING_INTERNAL_SECRET ||
  process.env.BOOKING_LISTINGS_INTERNAL_SECRET ||
  ""
).trim();

export type ReserveOfferCartInput = {
  buyerUserId: string;
  listingId: string;
  offerId: string;
  amountCents: number;
  listingTitle?: string | null;
  sellerDisplay?: string | null;
};

export type ReserveAuctionCartInput = {
  buyerUserId: string;
  listingId: string;
  amountCents: number;
  listingTitle?: string | null;
  sellerDisplay?: string | null;
};

export async function reserveAuctionWinInCart(
  input: ReserveAuctionCartInput,
): Promise<{ cartItemId: string } | null> {
  if (!INTERNAL_SECRET) {
    console.warn("[listings-auction] cart reserve skipped: missing internal secret");
    return null;
  }
  const url = `${SHOPPING_HTTP_TARGET.replace(/\/$/, "")}/internal/cart/reserve-auction-win`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-listings-internal-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify({
        buyer_user_id: input.buyerUserId,
        listing_id: input.listingId,
        amount_cents: input.amountCents,
        listing_title: input.listingTitle ?? null,
        seller_display: input.sellerDisplay ?? null,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[listings-auction] cart reserve failed", res.status, text.slice(0, 400));
      return null;
    }
    const body = (await res.json()) as { cart_item_id?: string };
    const cartItemId = String(body.cart_item_id || "").trim();
    return cartItemId ? { cartItemId } : null;
  } catch (e) {
    console.error("[listings-auction] cart reserve error", e);
    return null;
  }
}

export async function reserveAcceptedOfferInCart(
  input: ReserveOfferCartInput,
): Promise<{ cartItemId: string } | null> {
  if (!INTERNAL_SECRET) {
    console.warn("[listings-offers] cart reserve skipped: missing internal secret");
    return null;
  }
  const url = `${SHOPPING_HTTP_TARGET.replace(/\/$/, "")}/internal/cart/reserve-offer`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-listings-internal-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify({
        buyer_user_id: input.buyerUserId,
        listing_id: input.listingId,
        offer_id: input.offerId,
        amount_cents: input.amountCents,
        listing_title: input.listingTitle ?? null,
        seller_display: input.sellerDisplay ?? null,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[listings-offers] cart reserve failed", res.status, text.slice(0, 400));
      return null;
    }
    const body = (await res.json()) as { cart_item_id?: string };
    const cartItemId = String(body.cart_item_id || "").trim();
    return cartItemId ? { cartItemId } : null;
  } catch (e) {
    console.error("[listings-offers] cart reserve error", e);
    return null;
  }
}
