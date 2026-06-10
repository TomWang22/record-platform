/**
 * Push cart/shipping notifications to notification-service (mesh secret).
 */
async function pushNotification(input: {
  userId: string;
  eventType: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const secret = (
    process.env.LISTINGS_BOOKING_INTERNAL_SECRET ||
    process.env.BOOKING_LISTINGS_INTERNAL_SECRET ||
    ""
  ).trim();
  const base = (
    process.env.NOTIFICATION_HTTP ||
    "http://notification-service.record-platform.svc.cluster.local:4015"
  ).replace(/\/$/, "");
  if (!secret || !input.userId) return;
  try {
    const res = await fetch(`${base}/internal/push-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-booking-internal-secret": secret,
      },
      body: JSON.stringify({
        user_id: input.userId,
        event_type: input.eventType,
        payload: input.payload,
      }),
      signal: AbortSignal.timeout(Number(process.env.SHOPPING_NOTIFICATION_PUSH_TIMEOUT_MS || "4000")),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[shopping] notification push failed", input.eventType, res.status, text.slice(0, 200));
    }
  } catch (e) {
    console.warn("[shopping] notification push error", input.eventType, e);
  }
}

export async function pushCartReservedNotification(input: {
  buyerUserId: string;
  listingId: string;
  listingTitle?: string | null;
  purchaseType: "best_offer" | "auction_win";
  amountCents?: number | null;
}): Promise<void> {
  const title =
    input.purchaseType === "auction_win" ? "Auction win reserved in cart" : "Accepted offer reserved in cart";
  const listingLabel = input.listingTitle?.trim() || "your item";
  await pushNotification({
    userId: input.buyerUserId,
    eventType: "CartReserved",
    payload: {
      listing_id: input.listingId,
      listing_title: input.listingTitle ?? null,
      purchase_type: input.purchaseType,
      amount_cents: input.amountCents ?? null,
      title,
      body: `${listingLabel} was added to your cart`,
      deep_link: "/cart",
      source: "http.shopping.cart_reserve",
    },
  });
}

export async function pushShipmentStatusNotification(input: {
  buyerUserId: string;
  orderId: string;
  orderNumber?: string | null;
  trackingNumber?: string | null;
  status: string;
}): Promise<void> {
  const tracking = input.trackingNumber?.trim() || "pending";
  await pushNotification({
    userId: input.buyerUserId,
    eventType: "ShipmentStatusUpdated",
    payload: {
      order_id: input.orderId,
      order_number: input.orderNumber ?? null,
      tracking_number: tracking,
      status: input.status,
      title: "Order shipped",
      body: `Your order ${input.orderNumber || ""} shipped — tracking ${tracking}`.trim(),
      deep_link: "/settings/orders",
      source: "http.shopping.checkout",
    },
  });
}
