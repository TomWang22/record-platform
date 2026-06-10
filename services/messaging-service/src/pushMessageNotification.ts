/**
 * Interim service-to-service push when Kafka consumer lag or dev clusters skip Kafka.
 * Uses the same internal secret as booking/listings mesh calls.
 */
async function pushMarketplaceNotification(input: {
  recipientId: string;
  eventType: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const secret = (process.env.BOOKING_LISTINGS_INTERNAL_SECRET || "").trim();
  const base = (process.env.NOTIFICATION_HTTP || "http://notification-service:4020").replace(/\/$/, "");
  if (!secret || !input.recipientId) return;
  try {
    const res = await fetch(`${base}/internal/push-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-booking-internal-secret": secret,
      },
      body: JSON.stringify({
        user_id: input.recipientId,
        event_type: input.eventType,
        payload: input.payload,
      }),
      signal: AbortSignal.timeout(Number(process.env.MESSAGING_NOTIFICATION_PUSH_TIMEOUT_MS || "4000")),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[messaging] push failed", input.eventType, res.status, text.slice(0, 200));
    }
  } catch (e) {
    console.warn("[messaging] push error", input.eventType, e);
  }
}

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

export async function pushMessageEditedNotification(input: {
  recipientId: string;
  editorId: string;
  messageId: string;
  threadId: string;
  preview: string;
}): Promise<void> {
  await pushMarketplaceNotification({
    recipientId: input.recipientId,
    eventType: "MessageEdited",
    payload: {
      message_id: input.messageId,
      editor_id: input.editorId,
      thread_id: input.threadId,
      preview: input.preview,
      title: "Message edited",
      body: input.preview,
      deep_link: input.threadId
        ? `/messages?thread=${encodeURIComponent(input.threadId)}`
        : "/messages",
      source: "http.messaging.edit",
    },
  });
}

export async function pushMessageReactionNotification(input: {
  recipientId: string;
  reactorId: string;
  messageId: string;
  threadId: string;
  emoji: string;
}): Promise<void> {
  await pushMarketplaceNotification({
    recipientId: input.recipientId,
    eventType: "MessageReaction",
    payload: {
      message_id: input.messageId,
      reactor_id: input.reactorId,
      thread_id: input.threadId,
      emoji: input.emoji,
      title: "New reaction",
      body: `Reacted ${input.emoji}`,
      deep_link: input.threadId
        ? `/messages?thread=${encodeURIComponent(input.threadId)}`
        : "/messages",
      source: "http.messaging.reaction",
    },
  });
}
