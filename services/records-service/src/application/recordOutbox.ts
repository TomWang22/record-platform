/**
 * Shared records write services: domain mutation + revision (where applicable)
 * + records.outbox_events INSERT on the same Prisma transaction.
 *
 * event_id is minted once before $transaction. Drain must not remint.
 * No-op PUT: no Prisma UPDATE, no revision, no outbox row.
 */
import { randomUUID } from "node:crypto";
import {
  encodeRecordCreatedV1,
  encodeRecordDeletedV1,
  encodeRecordUpdatedV1,
  RECORD_CREATED_V1,
  RECORD_DELETED_V1,
  RECORD_UPDATED_V1,
} from "../recordsKafkaEvents.js";
import { insertRecordsOutboxEvent } from "../outbox/enqueueOutbox.js";

export function mintRecordsEventId(): string {
  return randomUUID();
}

type RecordRow = {
  id: string;
  userId: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  mediaPieces?: unknown[];
  [key: string]: unknown;
};

export type RecordsWriteTx = {
  record: {
    create: (args: unknown) => Promise<RecordRow>;
    update: (args: unknown) => Promise<RecordRow>;
    delete: (args: unknown) => Promise<RecordRow>;
    findFirst: (args: unknown) => Promise<RecordRow | null>;
  };
  recordRevision: {
    create: (args: unknown) => Promise<unknown>;
    findFirst: (args: unknown) => Promise<{ revisionNumber: number } | null>;
  };
  $executeRaw: (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<number | bigint>;
};

export type RecordsWriteClient = {
  $transaction: <T>(fn: (tx: RecordsWriteTx) => Promise<T>) => Promise<T>;
  record: {
    findUnique: (args: unknown) => Promise<RecordRow | null>;
    findFirst: (args: unknown) => Promise<RecordRow | null>;
  };
};

function iso(value: Date | string | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.length > 0) return value;
  return new Date().toISOString();
}

function plainForDiff(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(plainForDiff);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = plainForDiff(v);
    }
    return out;
  }
  return value;
}

function domainChangedFields(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): string[] {
  const changed: string[] = [];
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    if (key === "updatedAt") continue;
    if (JSON.stringify(plainForDiff(prev[key])) !== JSON.stringify(plainForDiff(next[key]))) {
      changed.push(key);
    }
  }
  return changed;
}

function jsonDiff(prev: Record<string, unknown>, next: Record<string, unknown>) {
  const changed: string[] = [];
  const previousValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    const a = plainForDiff(prev[key] ?? null);
    const b = plainForDiff(next[key] ?? null);
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changed.push(key);
      previousValues[key] = a;
      newValues[key] = b;
    }
  }
  return { changed, previousValues, newValues };
}

function overlayRecord(
  existing: RecordRow,
  recordData: Record<string, unknown>,
  mediaPieces?: unknown[],
  formatUpdate?: string,
): RecordRow {
  const next: RecordRow = { ...existing, ...recordData };
  if (formatUpdate) next.format = formatUpdate;
  if (Array.isArray(mediaPieces)) {
    next.mediaPieces = mediaPieces.map((piece) => {
      const p = { ...(piece as Record<string, unknown>) };
      delete p.__formatHint;
      return { ...p, userId: existing.userId };
    });
  }
  return next;
}

export type CreateRecordWithOutboxInput = {
  data: Record<string, unknown>;
  include?: Record<string, unknown>;
  eventId?: string;
};

export type CreateRecordWithOutboxResult = {
  record: RecordRow;
  eventId: string;
};

export async function createRecordWithOutbox(
  prisma: RecordsWriteClient,
  input: CreateRecordWithOutboxInput,
): Promise<CreateRecordWithOutboxResult> {
  const eventId = input.eventId ?? mintRecordsEventId();
  return prisma.$transaction(async (tx) => {
    const rec = await tx.record.create({
      data: input.data,
      include:
        input.include ?? { mediaPieces: { orderBy: { index: "asc" } } },
    });
    await tx.recordRevision.create({
      data: {
        recordId: rec.id,
        userId: rec.userId,
        revisionNumber: 1,
        changedFields: Object.keys(rec),
        previousValues: {},
        newValues: rec,
        createdBy: rec.userId,
      },
    });
    await insertRecordsOutboxEvent(tx, {
      eventId,
      aggregateId: rec.id,
      type: RECORD_CREATED_V1,
      version: 1,
      payload: encodeRecordCreatedV1({
        record_id: rec.id,
        user_id: rec.userId,
        created_at: iso(rec.createdAt),
      }),
    });
    return { record: rec, eventId };
  });
}

export type UpdateRecordWithOutboxInput = {
  id: string;
  userId: string;
  recordData: Record<string, unknown>;
  mediaPieces?: unknown[];
  formatUpdate?: string;
  eventId?: string;
};

export type UpdateRecordWithOutboxResult =
  | { kind: "not_found"; record: null; eventId: null }
  | { kind: "noop"; record: RecordRow; eventId: null }
  | { kind: "updated"; record: RecordRow; eventId: string };

export async function updateRecordWithOutbox(
  prisma: RecordsWriteClient,
  input: UpdateRecordWithOutboxInput,
): Promise<UpdateRecordWithOutboxResult> {
  const existing = await prisma.record.findUnique({
    where: { id: input.id },
    include: { mediaPieces: true },
  });
  if (!existing || existing.userId !== input.userId) {
    return { kind: "not_found", record: null, eventId: null };
  }

  const prospective = overlayRecord(
    existing,
    input.recordData,
    input.mediaPieces,
    input.formatUpdate,
  );
  if (domainChangedFields(existing, prospective).length === 0) {
    return { kind: "noop", record: existing, eventId: null };
  }

  const eventId = input.eventId ?? mintRecordsEventId();
  const record = await prisma.$transaction(async (tx) => {
    await tx.record.update({
      where: { id: input.id },
      data: {
        ...input.recordData,
        ...(input.formatUpdate ? { format: input.formatUpdate } : {}),
        ...(Array.isArray(input.mediaPieces)
          ? {
              mediaPieces: {
                deleteMany: {},
                create: input.mediaPieces.map((piece) => {
                  const p = { ...(piece as Record<string, unknown>) };
                  delete p.__formatHint;
                  return { ...p, userId: input.userId };
                }),
              },
            }
          : {}),
      },
    });
    const fresh = await tx.record.findFirst({
      where: { id: input.id, userId: input.userId },
      include: { mediaPieces: { orderBy: { index: "asc" } } },
    });
    if (!fresh) {
      throw new Error("records_update_missing_after_write");
    }
    const diff = jsonDiff(existing, fresh);
    const last = await tx.recordRevision.findFirst({
      where: { recordId: input.id, userId: input.userId },
      orderBy: { revisionNumber: "desc" },
    });
    const nextRevision = Number(last?.revisionNumber ?? 0) + 1;
    await tx.recordRevision.create({
      data: {
        recordId: input.id,
        userId: input.userId,
        revisionNumber: nextRevision,
        changedFields: diff.changed,
        previousValues: diff.previousValues,
        newValues: diff.newValues,
        createdBy: input.userId,
      },
    });
    await insertRecordsOutboxEvent(tx, {
      eventId,
      aggregateId: input.id,
      type: RECORD_UPDATED_V1,
      version: 1,
      payload: encodeRecordUpdatedV1({
        record_id: input.id,
        user_id: input.userId,
        updated_at: iso(fresh.updatedAt),
      }),
    });
    return fresh;
  });
  return { kind: "updated", record, eventId };
}

export type DeleteRecordWithOutboxInput = {
  id: string;
  userId: string;
  eventId?: string;
  deletedAt?: string;
};

export type DeleteRecordWithOutboxResult =
  | { kind: "not_found"; eventId: null }
  | { kind: "deleted"; eventId: string };

export async function deleteRecordWithOutbox(
  prisma: RecordsWriteClient,
  input: DeleteRecordWithOutboxInput,
): Promise<DeleteRecordWithOutboxResult> {
  const existing = await prisma.record.findUnique({
    where: { id: input.id },
  });
  if (!existing || existing.userId !== input.userId) {
    return { kind: "not_found", eventId: null };
  }

  const eventId = input.eventId ?? mintRecordsEventId();
  const deletedAt = input.deletedAt ?? new Date().toISOString();
  await prisma.$transaction(async (tx) => {
    await tx.record.delete({ where: { id: input.id } });
    await insertRecordsOutboxEvent(tx, {
      eventId,
      aggregateId: input.id,
      type: RECORD_DELETED_V1,
      version: 1,
      payload: encodeRecordDeletedV1({
        record_id: input.id,
        user_id: existing.userId,
        deleted_at: deletedAt,
      }),
    });
  });
  return { kind: "deleted", eventId };
}
