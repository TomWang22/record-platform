import type { Pool } from "pg";

import { upsertNotificationByDedupeKey } from "../notification-upsert.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MessageReceivedNotificationInput = {
  recipientId: string;
  senderId: string;
  messageId: string;
  threadId: string;
  preview: string;
  senderDisplayName?: string | null;
  listingId?: string | null;
  listingTitle?: string | null;
  notificationSource?: string;
};

export async function createMessageReceivedNotification(
  pool: Pool,
  input: MessageReceivedNotificationInput,
): Promise<{ inserted: boolean; notificationId: string | null }> {
  const recipientId = String(input.recipientId || "").trim().toLowerCase();
  const messageId = String(input.messageId || "").trim().toLowerCase();
  const threadId = String(input.threadId || "").trim();
  if (!UUID_RE.test(recipientId) || !UUID_RE.test(messageId)) {
    return { inserted: false, notificationId: null };
  }

  const senderLabel = String(input.senderDisplayName || "").trim() || "Someone";
  const preview = String(input.preview || "").trim().slice(0, 160) || "New message";
  const listingId = String(input.listingId || "").trim();
  const listingTitle = String(input.listingTitle || "").trim();
  const href = threadId
    ? `/messages?thread=${encodeURIComponent(threadId)}`
    : listingId
      ? `/messages?listing=${encodeURIComponent(listingId)}`
      : "/messages";

  const payload: Record<string, unknown> = {
    type: "message_received",
    notification_category: "messages",
    notification_audience: "user",
    notification_recipient_role: "user",
    title: `Message from ${senderLabel}`,
    body: preview,
    href,
    deep_link: href,
    message_id: messageId,
    sender_id: input.senderId,
    conversation_id: threadId || null,
    listing_id: listingId || null,
    listing_title: listingTitle || null,
    source: input.notificationSource ?? "messaging.message_sent",
  };

  const result = await upsertNotificationByDedupeKey(pool, {
    userId: recipientId,
    eventType: "message_received",
    dedupeKey: `message_received:${messageId}:${recipientId}`,
    payload,
  });

  return { inserted: result.inserted, notificationId: result.notificationId };
}
