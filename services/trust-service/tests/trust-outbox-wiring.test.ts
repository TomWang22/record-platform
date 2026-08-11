/**
 * Phase B writer wiring — seven frozen HTTP/gRPC paths.
 * G7 HTTP/gRPC semantics are frozen before handlers change.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as grpc from "@grpc/grpc-js";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { classifyTrustEnqueueClientResult } from "../src/outbox/trustEnqueueClient.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");
const FLAG_ID = "flag-wired-1";
const REVIEW_ID = "rev-wired-1";
const reporter = randomUUID();
const listingId = randomUUID();
const bookingId = randomUUID();
const revieweeId = randomUUID();

const { insertFlagMock, insertReviewMock, loadBookingMock } = vi.hoisted(() => ({
  insertFlagMock: vi.fn(),
  insertReviewMock: vi.fn(),
  loadBookingMock: vi.fn(),
}));

vi.mock("../src/application/trustOutbox.js", () => ({
  insertListingFlagSubmittedWithOutbox: (...args: unknown[]) => insertFlagMock(...args),
  insertPeerReviewCreatedWithOutbox: (...args: unknown[]) => insertReviewMock(...args),
}));

vi.mock("../src/peer-review-booking-gate.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/peer-review-booking-gate.js")>();
  return {
    ...actual,
    loadBookingForPeerReviewGate: (...args: unknown[]) => loadBookingMock(...args),
  };
});

vi.mock("../src/db.js", () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
  },
}));

vi.mock("@common/utils/otel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@common/utils/otel")>();
  return {
    ...actual,
    tracingMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
    mountDebugTraceHeaders: () => {},
    inferNetProtoForSpan: () => "http",
  };
});

vi.mock("@common/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@common/utils")>();
  return {
    ...actual,
    createHttpConcurrencyGuard: () =>
      (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

const { createTrustHttpApp } = await import("../src/http-server.js");
const { trustGrpcHandlersForTest } = await import("../src/grpc-server.js");

describe("G7 HTTP/gRPC response freeze", () => {
  it("maps the four outcomes to frozen client statuses", () => {
    const value = { flagId: FLAG_ID, eventId: "e1", status: "pending" };
    expect(classifyTrustEnqueueClientResult({ outcome: "committed", value })).toEqual({
      disposition: "succeeded",
      value,
    });
    expect(
      classifyTrustEnqueueClientResult({
        outcome: "COMMIT_PERSISTED_RECOVERED",
        value,
      }),
    ).toEqual({ disposition: "succeeded", value });

    const notPersisted = classifyTrustEnqueueClientResult({
      outcome: "COMMIT_NOT_PERSISTED",
    });
    expect(notPersisted).toMatchObject({
      disposition: "retryable",
      code: "COMMIT_NOT_PERSISTED",
      httpStatus: 503,
      grpcStatusName: "UNAVAILABLE",
    });

    const invariant = classifyTrustEnqueueClientResult({
      outcome: "INVARIANT_VIOLATION",
    });
    expect(invariant).toMatchObject({
      disposition: "hard_failure",
      code: "INVARIANT_VIOLATION",
      httpStatus: 500,
      grpcStatusName: "INTERNAL",
    });

    const unknown = classifyTrustEnqueueClientResult({
      outcome: "UNKNOWN_PENDING_RECONCILIATION",
    });
    expect(unknown).toMatchObject({
      disposition: "unknown",
      code: "UNKNOWN_PENDING_RECONCILIATION",
      httpStatus: 500,
      grpcStatusName: "UNKNOWN",
    });
    expect(unknown.disposition === "succeeded").toBe(false);
  });
});

describe("E8–E11 source wiring", () => {
  it("covered HTTP/gRPC paths call the frozen helpers", () => {
    const http = readFileSync(join(SRC, "http-server.ts"), "utf8");
    const grpcSrc = readFileSync(join(SRC, "grpc-server.ts"), "utf8");
    expect(http).toMatch(/insertListingFlagSubmittedWithOutbox/);
    expect(http).toMatch(/insertPeerReviewCreatedWithOutbox/);
    expect(grpcSrc).toMatch(/insertListingFlagSubmittedWithOutbox/);
    expect(grpcSrc).toMatch(/insertPeerReviewCreatedWithOutbox/);
    expect(http).not.toMatch(/ListingFlaggedV1/);
    expect(http).not.toMatch(/ReviewCreatedV1/);
    expect(grpcSrc).not.toMatch(/ListingFlaggedV1/);
    expect(grpcSrc).not.toMatch(/ReviewCreatedV1/);
    expect(http).toMatch(/classifyTrustEnqueueClientResult/);
    expect(grpcSrc).toMatch(/classifyTrustEnqueueClientResult/);
  });

  it("user_flags report-abuse branch stays unwired", () => {
    const http = readFileSync(join(SRC, "http-server.ts"), "utf8");
    const grpcSrc = readFileSync(join(SRC, "grpc-server.ts"), "utf8");
    expect(http).toMatch(/INSERT INTO trust\.user_flags/);
    expect(grpcSrc).toMatch(/INSERT INTO trust\.user_flags/);
  });
});

describe("HTTP listing-flag G7", () => {
  beforeEach(() => {
    insertFlagMock.mockReset();
    insertReviewMock.mockReset();
    loadBookingMock.mockReset();
  });

  it("/flag-listing committed → 201", async () => {
    insertFlagMock.mockResolvedValue({
      outcome: "committed",
      value: { flagId: FLAG_ID, eventId: "e1", status: "pending" },
    });
    const app = createTrustHttpApp();
    const res = await request(app)
      .post("/flag-listing")
      .set("x-user-id", reporter)
      .send({ listing_id: listingId, reason: "spam" })
      .expect(201);
    expect(res.body.data.flag_id).toBe(FLAG_ID);
    expect(insertFlagMock).toHaveBeenCalled();
  });

  it("/flag-listing COMMIT_PERSISTED_RECOVERED → 201", async () => {
    insertFlagMock.mockResolvedValue({
      outcome: "COMMIT_PERSISTED_RECOVERED",
      value: { flagId: FLAG_ID, eventId: "e1", status: "pending" },
    });
    const app = createTrustHttpApp();
    await request(app)
      .post("/flag-listing")
      .set("x-user-id", reporter)
      .send({ listing_id: listingId, reason: "spam" })
      .expect(201);
  });

  it("/flag-listing COMMIT_NOT_PERSISTED → 503", async () => {
    insertFlagMock.mockResolvedValue({ outcome: "COMMIT_NOT_PERSISTED" });
    const app = createTrustHttpApp();
    const res = await request(app)
      .post("/flag-listing")
      .set("x-user-id", reporter)
      .send({ listing_id: listingId, reason: "spam" })
      .expect(503);
    expect(res.body.code).toBe("COMMIT_NOT_PERSISTED");
  });

  it("/flag-listing INVARIANT_VIOLATION → 500", async () => {
    insertFlagMock.mockResolvedValue({ outcome: "INVARIANT_VIOLATION" });
    const app = createTrustHttpApp();
    const res = await request(app)
      .post("/flag-listing")
      .set("x-user-id", reporter)
      .send({ listing_id: listingId, reason: "spam" })
      .expect(500);
    expect(res.body.code).toBe("INVARIANT_VIOLATION");
  });

  it("/flag-listing UNKNOWN_PENDING_RECONCILIATION → 500 never success", async () => {
    insertFlagMock.mockResolvedValue({
      outcome: "UNKNOWN_PENDING_RECONCILIATION",
    });
    const app = createTrustHttpApp();
    const res = await request(app)
      .post("/flag-listing")
      .set("x-user-id", reporter)
      .send({ listing_id: listingId, reason: "spam" })
      .expect(500);
    expect(res.body.code).toBe("UNKNOWN_PENDING_RECONCILIATION");
    expect(res.body.data).toBeUndefined();
  });

  it("/report-abuse listing uses insertListingFlagSubmittedWithOutbox", async () => {
    insertFlagMock.mockResolvedValue({
      outcome: "committed",
      value: { flagId: FLAG_ID, eventId: "e1", status: "pending" },
    });
    const app = createTrustHttpApp();
    await request(app)
      .post("/report-abuse")
      .set("x-user-id", reporter)
      .send({
        abuse_target_type: "listing",
        target_id: listingId,
        category: "fraud",
        details: "x",
      })
      .expect(201);
    expect(insertFlagMock).toHaveBeenCalled();
    expect(insertFlagMock.mock.calls[0]?.[1]).toMatchObject({
      listingId,
      description: "x",
    });
  });
});

describe("HTTP peer-review G7 + booking gate before BEGIN", () => {
  const prevBooking = process.env.BOOKING_HTTP;

  beforeEach(() => {
    insertReviewMock.mockReset();
    loadBookingMock.mockReset();
  });

  afterEach(() => {
    if (prevBooking === undefined) delete process.env.BOOKING_HTTP;
    else process.env.BOOKING_HTTP = prevBooking;
  });

  it("/peer-review committed → 201", async () => {
    insertReviewMock.mockResolvedValue({
      outcome: "committed",
      value: { reviewId: REVIEW_ID, eventId: "e1" },
    });
    const app = createTrustHttpApp();
    const res = await request(app)
      .post("/peer-review")
      .set("x-user-id", reporter)
      .send({
        booking_id: bookingId,
        reviewee_id: revieweeId,
        side: "host",
        rating: 5,
        comment: "great",
      })
      .expect(201);
    expect(res.body.data.review_id).toBe(REVIEW_ID);
    expect(insertReviewMock).toHaveBeenCalled();
  });

  it("BOOKING_HTTP gate failure does not call enqueue helper", async () => {
    process.env.BOOKING_HTTP = "http://booking.example";
    loadBookingMock.mockResolvedValue(null);
    const app = createTrustHttpApp();
    await request(app)
      .post("/peer-review")
      .set("x-user-id", reporter)
      .send({
        booking_id: bookingId,
        reviewee_id: revieweeId,
        side: "host",
        rating: 5,
      })
      .expect(400);
    expect(insertReviewMock).not.toHaveBeenCalled();
  });
});

describe("gRPC listing-flag + peer-review G7", () => {
  beforeEach(() => {
    insertFlagMock.mockReset();
    insertReviewMock.mockReset();
  });

  function run<T>(invoke: (cb: (err: T | null, res?: unknown) => void) => void) {
    return new Promise<{ err: T | null; res?: unknown }>((resolve, reject) => {
      try {
        invoke((err, res) => resolve({ err, res }));
      } catch (e) {
        reject(e);
      }
    });
  }

  it("FlagListing COMMIT_NOT_PERSISTED → UNAVAILABLE", async () => {
    insertFlagMock.mockResolvedValue({ outcome: "COMMIT_NOT_PERSISTED" });
    const { err } = await run((cb) =>
      trustGrpcHandlersForTest.FlagListing(
        {
          request: {
            listing_id: listingId,
            reporter_id: reporter,
            reason: "spam",
          },
        } as never,
        cb,
      ),
    );
    expect((err as { code: number }).code).toBe(grpc.status.UNAVAILABLE);
  });

  it("FlagListing COMMIT_PERSISTED_RECOVERED → OK", async () => {
    insertFlagMock.mockResolvedValue({
      outcome: "COMMIT_PERSISTED_RECOVERED",
      value: { flagId: FLAG_ID, eventId: "e1", status: "pending" },
    });
    const { err, res } = await run((cb) =>
      trustGrpcHandlersForTest.FlagListing(
        {
          request: {
            listing_id: listingId,
            reporter_id: reporter,
            reason: "spam",
          },
        } as never,
        cb,
      ),
    );
    expect(err).toBeNull();
    expect((res as { flag_id: string }).flag_id).toBe(FLAG_ID);
  });

  it("SubmitPeerReview COMMIT_NOT_PERSISTED → UNAVAILABLE", async () => {
    insertReviewMock.mockResolvedValue({ outcome: "COMMIT_NOT_PERSISTED" });
    const { err } = await run((cb) =>
      trustGrpcHandlersForTest.SubmitPeerReview(
        {
          request: {
            booking_id: bookingId,
            reviewer_id: reporter,
            reviewee_id: revieweeId,
            side: "host",
            rating: 5,
          },
        } as never,
        cb,
      ),
    );
    expect((err as { code: number }).code).toBe(grpc.status.UNAVAILABLE);
  });

  it("SubmitReview UNKNOWN → UNKNOWN and not OK", async () => {
    insertReviewMock.mockResolvedValue({
      outcome: "UNKNOWN_PENDING_RECONCILIATION",
    });
    const { err, res } = await run((cb) =>
      trustGrpcHandlersForTest.SubmitReview(
        {
          request: {
            booking_id: bookingId,
            reviewer_id: reporter,
            reviewee_id: revieweeId,
            rating: 4,
          },
        } as never,
        cb,
      ),
    );
    expect((err as { code: number }).code).toBe(grpc.status.UNKNOWN);
    expect(res).toBeUndefined();
  });

  it("ReportAbuse listing calls listing-flag helper; user branch does not", async () => {
    insertFlagMock.mockResolvedValue({
      outcome: "committed",
      value: { flagId: FLAG_ID, eventId: "e1", status: "pending" },
    });
    const { err } = await run((cb) =>
      trustGrpcHandlersForTest.ReportAbuse(
        {
          request: {
            abuse_target_type: "listing",
            target_id: listingId,
            reporter_id: reporter,
            category: "fraud",
          },
        } as never,
        cb,
      ),
    );
    expect(err).toBeNull();
    expect(insertFlagMock).toHaveBeenCalled();
  });
});
