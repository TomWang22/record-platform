/**
 * Phase B enqueue API + G7 — PoolClient TX. HTTP/gRPC writers call helpers.
 *
 * E4: COMMIT throw is UNKNOWN_PENDING_RECONCILIATION until a fresh
 * connection reconciles frozen event_id + domain identity.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  LISTING_FLAG_SUBMITTED_V1,
  PEER_REVIEW_CREATED_V1,
  decodeTrustEventEnvelope,
  encodeListingFlagSubmittedV1,
  encodePeerReviewCreatedV1,
  wrapTrustOutboxRowAsEventEnvelope,
} from "../src/trustKafkaEvents.js";
import { insertTrustOutboxEvent } from "../src/outbox/enqueueOutbox.js";
import {
  classifyTrustEnqueueCommitReconciliation,
  runTrustEnqueueTransaction,
} from "../src/outbox/trustEnqueueTx.js";
import {
  insertListingFlagSubmittedWithOutbox,
  insertPeerReviewCreatedWithOutbox,
} from "../src/application/trustOutbox.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");

const FLAG_ID = "11111111-1111-4111-8111-111111111111";
const LISTING_ID = "22222222-2222-4222-8222-222222222222";
const REPORTER_ID = "33333333-3333-4333-8333-333333333333";
const EVENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REVIEW_ID = "44444444-4444-4444-8444-444444444444";
const BOOKING_ID = "55555555-5555-4555-8555-555555555555";
const REVIEWEE_ID = "66666666-6666-4666-8666-666666666666";
const AT = "2026-08-11T15:00:00.000Z";

type QueryCall = { sql: string; params: unknown[] };

function makeFakePool(opts?: {
  failOn?: "domain" | "outbox" | "commit";
  duplicate?: boolean;
  recon?: { outbox: boolean; domain: boolean } | "unavailable";
}) {
  const calls: QueryCall[] = [];
  let inTx = false;
  let committed = false;
  let rolledBack = false;
  let connectCount = 0;

  const txClient = {
    async query(sql: string, params: unknown[] = []) {
      const norm = sql.replace(/\s+/g, " ").trim();
      calls.push({ sql: norm, params });
      if (norm === "BEGIN") {
        inTx = true;
        return { rows: [], rowCount: 0 };
      }
      if (norm === "COMMIT") {
        if (opts?.failOn === "commit") throw new Error("commit_boom");
        committed = true;
        inTx = false;
        return { rows: [], rowCount: 0 };
      }
      if (norm === "ROLLBACK") {
        rolledBack = true;
        inTx = false;
        return { rows: [], rowCount: 0 };
      }
      if (norm.includes("INSERT INTO trust.outbox_events")) {
        if (opts?.failOn === "outbox") throw new Error("outbox_boom");
        return { rows: [], rowCount: 1 };
      }
      if (opts?.failOn === "domain" && !norm.includes("trust.outbox_events")) {
        throw new Error("domain_boom");
      }
      if (opts?.duplicate && norm.includes("INSERT INTO trust.listing_flags")) {
        const err = new Error("duplicate") as Error & { code: string };
        err.code = "23505";
        throw err;
      }
      if (opts?.duplicate && norm.includes("INSERT INTO trust.reviews")) {
        const err = new Error("duplicate") as Error & { code: string };
        err.code = "23505";
        throw err;
      }
      if (norm.includes("INSERT INTO trust.listing_flags")) {
        return { rows: [{ id: FLAG_ID, status: "pending" }], rowCount: 1 };
      }
      if (norm.includes("INSERT INTO trust.reviews")) {
        return { rows: [{ id: REVIEW_ID }], rowCount: 1 };
      }
      throw new Error(`unexpected_sql:${norm.slice(0, 140)}`);
    },
    release: vi.fn(),
  };

  const reconClient = {
    async query(sql: string, params: unknown[] = []) {
      const norm = sql.replace(/\s+/g, " ").trim();
      calls.push({ sql: `RECON ${norm}`, params });
      if (opts?.recon === "unavailable") {
        throw new Error("recon_boom");
      }
      const recon = opts?.recon ?? { outbox: true, domain: true };
      if (norm.includes("trust.outbox_events")) {
        return { rows: [{ exists: recon.outbox }], rowCount: 1 };
      }
      if (norm.includes("trust.listing_flags") || norm.includes("trust.reviews")) {
        return { rows: [{ exists: recon.domain }], rowCount: 1 };
      }
      throw new Error(`unexpected_recon_sql:${norm.slice(0, 140)}`);
    },
    release: vi.fn(),
  };

  const pool = {
    connect: async () => {
      connectCount += 1;
      if (connectCount === 1) return txClient;
      if (opts?.recon === "unavailable") {
        throw new Error("recon_connect_boom");
      }
      return reconClient;
    },
    query: async () => {
      throw new Error("bare_pool_query_forbidden_in_phase_b_helper");
    },
  };

  return {
    pool: pool as never,
    calls,
    getState: () => ({ inTx, committed, rolledBack, connectCount }),
  };
}

function outboxInsert(calls: QueryCall[]) {
  return calls.find((c) => c.sql.includes("INSERT INTO trust.outbox_events"));
}

describe("insertTrustOutboxEvent", () => {
  it("rejects missing event_id before any SQL", async () => {
    const client = { query: vi.fn() };
    await expect(
      insertTrustOutboxEvent(client as never, {
        eventId: "",
        aggregateId: LISTING_ID,
        type: LISTING_FLAG_SUBMITTED_V1,
        version: 1,
        payload: Buffer.from("x"),
      }),
    ).rejects.toThrow(/trust_outbox_event_id_missing/);
    expect(client.query).not.toHaveBeenCalled();
  });

  it("E13 rejects ListingFlaggedV1 and ReviewCreatedV1", async () => {
    const client = { query: vi.fn() };
    await expect(
      insertTrustOutboxEvent(client as never, {
        eventId: EVENT_ID,
        aggregateId: LISTING_ID,
        type: "ListingFlaggedV1",
        version: 1,
        payload: Buffer.from("x"),
      }),
    ).rejects.toThrow(/trust_outbox_type_invalid:ListingFlaggedV1/);
    await expect(
      insertTrustOutboxEvent(client as never, {
        eventId: EVENT_ID,
        aggregateId: REVIEW_ID,
        type: "ReviewCreatedV1",
        version: 1,
        payload: Buffer.from("x"),
      }),
    ).rejects.toThrow(/trust_outbox_type_invalid:ReviewCreatedV1/);
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe("E1/E5/E6/E7 ListingFlagSubmittedV1", () => {
  it("same PoolClient TX, proto BYTEA, event_id === outbox.id, aggregate=listing_id", async () => {
    const { pool, calls, getState } = makeFakePool();
    const result = await insertListingFlagSubmittedWithOutbox(pool, {
      listingId: LISTING_ID,
      flaggedBy: REPORTER_ID,
      reason: "counterfeit",
      description: "sleeve mismatch",
      eventId: EVENT_ID,
      at: AT,
    });

    expect(result.outcome).toBe("committed");
    if (result.outcome !== "committed") throw new Error("expected committed");
    expect(getState().committed).toBe(true);
    expect(getState().rolledBack).toBe(false);
    expect(result.value.eventId).toBe(EVENT_ID);
    expect(result.value.flagId).toBe(FLAG_ID);
    expect(calls[0]?.sql).toBe("BEGIN");
    expect(calls.at(-1)?.sql).toBe("COMMIT");
    expect(getState().connectCount).toBe(1);

    const insert = outboxInsert(calls);
    expect(insert).toBeTruthy();
    expect(insert!.params[0]).toBe(EVENT_ID);
    expect(insert!.params[1]).toBe(LISTING_ID);
    expect(insert!.params[2]).toBe(LISTING_FLAG_SUBMITTED_V1);
    expect(insert!.params[3]).toBe(1);
    const payload = insert!.params[4] as Buffer;
    const expected = encodeListingFlagSubmittedV1({
      flag_id: FLAG_ID,
      listing_id: LISTING_ID,
      flagged_by: REPORTER_ID,
      reason: "counterfeit",
      description: "sleeve mismatch",
      submitted_at: AT,
    });
    expect(payload.equals(expected)).toBe(true);

    const wrapped = wrapTrustOutboxRowAsEventEnvelope({
      id: EVENT_ID,
      aggregate_id: LISTING_ID,
      type: LISTING_FLAG_SUBMITTED_V1,
      version: 1,
      payload,
      created_at: AT,
    });
    const env = decodeTrustEventEnvelope(wrapped);
    expect(env.event_id).toBe(EVENT_ID);
    expect(env.timestamp).toBe(AT);
    expect(env.payload.equals(payload)).toBe(true);
  });

  it("E2 domain failure ⇒ zero outbox", async () => {
    const { pool, calls, getState } = makeFakePool({ failOn: "domain" });
    await expect(
      insertListingFlagSubmittedWithOutbox(pool, {
        listingId: LISTING_ID,
        flaggedBy: REPORTER_ID,
        reason: "counterfeit",
        eventId: EVENT_ID,
        at: AT,
      }),
    ).rejects.toThrow(/domain_boom/);
    expect(getState().rolledBack).toBe(true);
    expect(outboxInsert(calls)).toBeUndefined();
  });

  it("E3 outbox failure rolls domain", async () => {
    const { pool, getState } = makeFakePool({ failOn: "outbox" });
    await expect(
      insertPeerReviewCreatedWithOutbox(pool, {
        bookingId: BOOKING_ID,
        reviewerId: REPORTER_ID,
        revieweeId: REVIEWEE_ID,
        rating: 5,
        comment: "ok",
        eventId: EVENT_ID,
        at: AT,
      }),
    ).rejects.toThrow(/outbox_boom/);
    expect(getState().rolledBack).toBe(true);
  });
});

describe("E4 commit_throw_ambiguous G7", () => {
  it("classifier: both / neither / exactly one / unknown", () => {
    expect(classifyTrustEnqueueCommitReconciliation(true, true)).toBe(
      "COMMIT_PERSISTED_RECOVERED",
    );
    expect(classifyTrustEnqueueCommitReconciliation(false, false)).toBe(
      "COMMIT_NOT_PERSISTED",
    );
    expect(classifyTrustEnqueueCommitReconciliation(true, false)).toBe(
      "INVARIANT_VIOLATION",
    );
    expect(classifyTrustEnqueueCommitReconciliation(false, true)).toBe(
      "INVARIANT_VIOLATION",
    );
    expect(classifyTrustEnqueueCommitReconciliation(null, true)).toBe(
      "UNKNOWN_PENDING_RECONCILIATION",
    );
  });

  it("COMMIT throw + both present ⇒ COMMIT_PERSISTED_RECOVERED; fresh connection", async () => {
    const { pool, getState } = makeFakePool({
      failOn: "commit",
      recon: { outbox: true, domain: true },
    });
    const result = await insertListingFlagSubmittedWithOutbox(pool, {
      listingId: LISTING_ID,
      flaggedBy: REPORTER_ID,
      reason: "counterfeit",
      eventId: EVENT_ID,
      at: AT,
    });
    expect(result.outcome).toBe("COMMIT_PERSISTED_RECOVERED");
    if (result.outcome !== "COMMIT_PERSISTED_RECOVERED") {
      throw new Error("expected recovered");
    }
    expect(result.value.flagId).toBe(FLAG_ID);
    expect(getState().connectCount).toBe(2);
    expect(getState().rolledBack).toBe(true);
  });

  it("COMMIT throw + neither ⇒ COMMIT_NOT_PERSISTED", async () => {
    const { pool } = makeFakePool({
      failOn: "commit",
      recon: { outbox: false, domain: false },
    });
    const result = await insertListingFlagSubmittedWithOutbox(pool, {
      listingId: LISTING_ID,
      flaggedBy: REPORTER_ID,
      reason: "counterfeit",
      eventId: EVENT_ID,
      at: AT,
    });
    expect(result.outcome).toBe("COMMIT_NOT_PERSISTED");
  });

  it("COMMIT throw + only outbox ⇒ INVARIANT_VIOLATION", async () => {
    const { pool } = makeFakePool({
      failOn: "commit",
      recon: { outbox: true, domain: false },
    });
    const result = await insertPeerReviewCreatedWithOutbox(pool, {
      bookingId: BOOKING_ID,
      reviewerId: REPORTER_ID,
      revieweeId: REVIEWEE_ID,
      rating: 4,
      eventId: EVENT_ID,
      at: AT,
    });
    expect(result.outcome).toBe("INVARIANT_VIOLATION");
  });

  it("COMMIT throw + recon unavailable ⇒ UNKNOWN_PENDING_RECONCILIATION", async () => {
    const { pool, getState } = makeFakePool({
      failOn: "commit",
      recon: "unavailable",
    });
    const result = await insertListingFlagSubmittedWithOutbox(pool, {
      listingId: LISTING_ID,
      flaggedBy: REPORTER_ID,
      reason: "counterfeit",
      eventId: EVENT_ID,
      at: AT,
    });
    expect(result.outcome).toBe("UNKNOWN_PENDING_RECONCILIATION");
    expect(getState().connectCount).toBe(2);
  });

  it("unknowns != 0: runTrustEnqueueTransaction surfaces recon outcome, does not claim unpublished", async () => {
    const { pool, getState } = makeFakePool({
      failOn: "commit",
      recon: "unavailable",
    });
    const result = await runTrustEnqueueTransaction(
      pool,
      async (client) => {
        await client.query("INSERT INTO trust.listing_flags (id) VALUES ($1)", [FLAG_ID]);
        return { ok: true, eventId: EVENT_ID, flagId: FLAG_ID };
      },
      (value) => ({
        eventId: value.eventId,
        domain: { kind: "listing_flag_submitted", flagId: value.flagId },
      }),
    );
    expect(result.outcome).toBe("UNKNOWN_PENDING_RECONCILIATION");
    expect(getState().committed).toBe(false);
  });
});

describe("E7/E14/E15 PeerReviewCreatedV1", () => {
  it("aggregate_id is review_id; booking_id stays booking_id in payload", async () => {
    const { pool, calls, getState } = makeFakePool();
    const result = await insertPeerReviewCreatedWithOutbox(pool, {
      bookingId: BOOKING_ID,
      reviewerId: REPORTER_ID,
      revieweeId: REVIEWEE_ID,
      rating: 5,
      comment: "[host] great stay",
      eventId: EVENT_ID,
      at: AT,
    });
    expect(result.outcome).toBe("committed");
    if (result.outcome !== "committed") throw new Error("expected committed");
    expect(getState().committed).toBe(true);
    expect(result.value.reviewId).toBe(REVIEW_ID);
    const insert = outboxInsert(calls);
    expect(insert!.params[1]).toBe(REVIEW_ID);
    expect(insert!.params[2]).toBe(PEER_REVIEW_CREATED_V1);
    const payload = insert!.params[4] as Buffer;
    const decoded = encodePeerReviewCreatedV1({
      review_id: REVIEW_ID,
      booking_id: BOOKING_ID,
      reviewer_id: REPORTER_ID,
      reviewee_id: REVIEWEE_ID,
      rating: 5,
      comment: "[host] great stay",
      created_at: AT,
    });
    expect(payload.equals(decoded)).toBe(true);
  });

  it("E15 duplicate 23505 ⇒ zero outbox", async () => {
    const { pool, calls, getState } = makeFakePool({ duplicate: true });
    await expect(
      insertListingFlagSubmittedWithOutbox(pool, {
        listingId: LISTING_ID,
        flaggedBy: REPORTER_ID,
        reason: "counterfeit",
        eventId: EVENT_ID,
        at: AT,
      }),
    ).rejects.toMatchObject({ code: "23505" });
    expect(getState().rolledBack).toBe(true);
    expect(outboxInsert(calls)).toBeUndefined();
  });
});

describe("E12/E13/E16 source contracts", () => {
  it("E12 enqueue path has no producer.send", () => {
    const enq = readFileSync(join(SRC, "outbox/enqueueOutbox.ts"), "utf8");
    const tx = readFileSync(join(SRC, "outbox/trustEnqueueTx.ts"), "utf8");
    const app = readFileSync(join(SRC, "application/trustOutbox.ts"), "utf8");
    expect(enq).not.toMatch(/producer\.send/);
    expect(tx).not.toMatch(/producer\.send/);
    expect(app).not.toMatch(/producer\.send/);
  });

  it("E13 enqueue allow-list is submitted + peer-review only", () => {
    const enq = readFileSync(join(SRC, "outbox/enqueueOutbox.ts"), "utf8");
    expect(enq).toMatch(/LISTING_FLAG_SUBMITTED_V1/);
    expect(enq).toMatch(/PEER_REVIEW_CREATED_V1/);
    expect(enq).not.toMatch(/\bLISTING_FLAGGED_V1\b/);
    expect(enq).not.toMatch(/(?<![A-Z_])REVIEW_CREATED_V1\b/);
  });

  it("E16 uses pool.connect / PoolClient; no pool.query BEGIN", () => {
    const enq = readFileSync(join(SRC, "outbox/enqueueOutbox.ts"), "utf8");
    const tx = readFileSync(join(SRC, "outbox/trustEnqueueTx.ts"), "utf8");
    const app = readFileSync(join(SRC, "application/trustOutbox.ts"), "utf8");
    expect(enq).toMatch(/PoolClient/);
    expect(enq).not.toMatch(/new Pool/);
    expect(tx).toMatch(/pool\.connect/);
    expect(tx).not.toMatch(/pool\.query\(\s*["']BEGIN["']/);
    expect(app).toMatch(/runTrustEnqueueTransaction/);
    expect(app).not.toMatch(/pool\.query\(\s*["']BEGIN["']/);
  });

  it("HTTP/gRPC listing-flag + peer-review paths call enqueue helpers (E8–E11)", () => {
    const http = readFileSync(join(SRC, "http-server.ts"), "utf8");
    const grpc = readFileSync(join(SRC, "grpc-server.ts"), "utf8");
    expect(http).toMatch(/insertListingFlagSubmittedWithOutbox/);
    expect(http).toMatch(/insertPeerReviewCreatedWithOutbox/);
    expect(grpc).toMatch(/insertListingFlagSubmittedWithOutbox/);
    expect(grpc).toMatch(/insertPeerReviewCreatedWithOutbox/);
  });
});
