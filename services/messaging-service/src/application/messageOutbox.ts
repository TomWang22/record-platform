/**
 * Shared create/reply application service: domain write + messaging.outbox_events
 * in one transaction. HTTP and gRPC must call these — no direct produce for covered events.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { buildMetadata, type EventMetadataJson } from "../kafkaMessagingEvents.js";
import {
  insertMessagingOutboxEvent,
  type MessagingEventPayload,
} from "../outbox/enqueueOutbox.js";
import { withMessagingTransaction } from "../lib/transaction.js";

export type MessageRow = {
  id: string;
  sender_id: string;
  recipient_id: string | null;
  group_id: string | null;
  parent_message_id: string | null;
  thread_id: string | null;
  message_type: string;
  subject: string;
  content: string;
  created_at: Date | string;
  updated_at: Date | string;
};

export type CreateMessageInput = {
  senderId: string;
  recipientId: string | null;
  groupId: string | null;
  parentMessageId: string | null;
  threadId: string | null;
  messageType: string;
  subject: string;
  content: string;
  /**
   * Frozen Kafka partition key for messaging.events.v1.
   * May depend on the inserted row (e.g. group_id || recipient_id || message.id).
   */
  partitionKey: string | ((message: MessageRow) => string);
  correlationId?: string;
  causationId?: string;
  /** Extra JSON fields merged into the event payload (e.g. listing_id). */
  extraPayload?: Record<string, unknown>;
};

export type ReplyMessageInput = CreateMessageInput & {
  parentMessageId: string;
};

export type MessageWriteResult = {
  message: MessageRow;
  eventId: string;
  partitionKey: string;
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function resolvePartitionKey(
  partitionKey: CreateMessageInput["partitionKey"],
  message: MessageRow,
): string {
  const key =
    typeof partitionKey === "function" ? partitionKey(message) : partitionKey;
  if (!key) {
    throw new Error("messaging_outbox_partition_key_empty");
  }
  return String(key);
}

async function insertMessage(
  client: PoolClient,
  input: CreateMessageInput,
): Promise<MessageRow> {
  const result = await client.query<MessageRow>(
    `
      INSERT INTO messages.messages (
        sender_id, recipient_id, group_id, parent_message_id, thread_id,
        message_type, subject, content, is_read
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE)
      RETURNING
        id::text,
        sender_id::text,
        recipient_id::text,
        group_id::text,
        parent_message_id::text,
        thread_id::text,
        message_type,
        subject,
        content,
        created_at,
        updated_at
    `,
    [
      input.senderId,
      input.recipientId,
      input.groupId,
      input.parentMessageId,
      input.threadId,
      input.messageType,
      input.subject,
      input.content,
    ],
  );

  if (result.rowCount !== 1 || !result.rows[0]) {
    throw new Error(
      `messaging_domain_insert_rowcount:${result.rowCount ?? "null"}!=1`,
    );
  }
  return result.rows[0];
}

export async function createMessageWithOutbox(
  pool: Pool,
  input: CreateMessageInput,
): Promise<MessageWriteResult> {
  return withMessagingTransaction(pool, async (client) => {
    const message = await insertMessage(client, input);
    const partitionKey = resolvePartitionKey(input.partitionKey, message);
    const eventId = randomUUID();
    const metadata = buildMetadata({
      event_id: eventId,
      event_type: "MessageSent",
      aggregate_id: message.id,
      aggregate_type: "message",
      correlation_id: input.correlationId,
      causation_id: input.causationId,
    });
    const payload: MessagingEventPayload = {
      metadata,
      message_id: message.id,
      sender_id: message.sender_id,
      recipient_id: message.recipient_id ?? "",
      group_id: message.group_id ?? "",
      parent_message_id: message.parent_message_id ?? "",
      thread_id: message.thread_id ?? "",
      message_type: message.message_type,
      subject: message.subject,
      content: message.content,
      created_at: iso(message.created_at),
      ...(input.extraPayload ?? {}),
    };
    await insertMessagingOutboxEvent(client, {
      eventId,
      partitionKey,
      type: "MessageSentV1",
      version: 1,
      payload,
    });
    return { message, eventId, partitionKey };
  });
}

export async function replyMessageWithOutbox(
  pool: Pool,
  input: ReplyMessageInput,
): Promise<MessageWriteResult> {
  return withMessagingTransaction(pool, async (client) => {
    const message = await insertMessage(client, {
      ...input,
      parentMessageId: input.parentMessageId,
    });
    const partitionKey = resolvePartitionKey(input.partitionKey, message);
    const eventId = randomUUID();
    const metadata = buildMetadata({
      event_id: eventId,
      event_type: "MessageReplied",
      aggregate_id: message.id,
      aggregate_type: "message",
      correlation_id: input.correlationId,
      causation_id: input.causationId ?? input.parentMessageId,
    });
    const payload: MessagingEventPayload = {
      metadata,
      message_id: message.id,
      parent_message_id: input.parentMessageId,
      sender_id: message.sender_id,
      recipient_id: message.recipient_id ?? "",
      group_id: message.group_id ?? "",
      thread_id: message.thread_id ?? "",
      message_type: message.message_type,
      subject: message.subject,
      content: message.content,
      created_at: iso(message.created_at),
      ...(input.extraPayload ?? {}),
    };
    await insertMessagingOutboxEvent(client, {
      eventId,
      partitionKey,
      type: "MessageRepliedV1",
      version: 1,
      payload,
    });
    return { message, eventId, partitionKey };
  });
}

/** @internal for tests */
export type { EventMetadataJson };
