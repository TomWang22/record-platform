/**
 * Interim service-to-service push when Kafka consumer lag or dev clusters skip Kafka.
 * Uses the same internal secret as booking/listings mesh calls.
 */
export async function pushMessageReceivedNotification(input: {
  recipientId: string;
  senderId: string;
  messageId: string;
  threadId: string;
  content: string;
  senderDisplayName?: string | null;
  listingId?: string | null;
  listingTitle?: string | null;
}): Promise<void> {
  const secret = (process.env.BOOKING_LISTINGS_INTERNAL_SECRET || "").trim();
  const base = (process.env.NOTIFICATION_HTTP || "http://notification-service:4020").replace(/\/$/, "");
  if (!secret || !input.recipientId) return;

  const preview = String(input.content || "").trim().slice(0, 160);
  try {
    const res = await fetch(`${base}/internal/push-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-booking-internal-secret": secret,
      },
      body: JSON.stringify({
        user_id: input.recipientId,
        event_type: "message_received",
        payload: {
          message_id: input.messageId,
          sender_id: input.senderId,
          thread_id: input.threadId,
          preview,
          sender_display_name: input.senderDisplayName ?? null,
          listing_id: input.listingId ?? null,
          listing_title: input.listingTitle ?? null,
          source: "http.messaging.push",
        },
      }),
      signal: AbortSignal.timeout(Number(process.env.MESSAGING_NOTIFICATION_PUSH_TIMEOUT_MS || "4000")),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[messaging] message_received push failed", res.status, text.slice(0, 200));
    }
  } catch (e) {
    console.warn("[messaging] message_received push error", e);
  }
}
