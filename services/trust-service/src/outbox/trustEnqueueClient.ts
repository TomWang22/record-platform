/**
 * Frozen HTTP/gRPC mapping for trust enqueue G7 outcomes.
 * Handlers must not invent a 201/OK on unknown or not-persisted COMMIT.
 */
import type { TrustEnqueueResult } from "./trustEnqueueTx.js";

export type TrustEnqueueClientDisposition =
  | "succeeded"
  | "retryable"
  | "hard_failure"
  | "unknown";

export type TrustEnqueueClientMapped<T> =
  | { disposition: "succeeded"; value: T }
  | {
      disposition: Exclude<TrustEnqueueClientDisposition, "succeeded">;
      code:
        | "COMMIT_NOT_PERSISTED"
        | "INVARIANT_VIOLATION"
        | "UNKNOWN_PENDING_RECONCILIATION";
      message: string;
      httpStatus: 503 | 500;
      grpcStatusName: "UNAVAILABLE" | "INTERNAL" | "UNKNOWN";
    };

export function classifyTrustEnqueueClientResult<T>(
  result: TrustEnqueueResult<T>,
): TrustEnqueueClientMapped<T> {
  switch (result.outcome) {
    case "committed":
    case "COMMIT_PERSISTED_RECOVERED":
      if (!("value" in result) || result.value === undefined) {
        return {
          disposition: "unknown",
          code: "UNKNOWN_PENDING_RECONCILIATION",
          message: "commit recovered without value",
          httpStatus: 500,
          grpcStatusName: "UNKNOWN",
        };
      }
      return { disposition: "succeeded", value: result.value };
    case "COMMIT_NOT_PERSISTED":
      return {
        disposition: "retryable",
        code: "COMMIT_NOT_PERSISTED",
        message: "commit not persisted",
        httpStatus: 503,
        grpcStatusName: "UNAVAILABLE",
      };
    case "INVARIANT_VIOLATION":
      return {
        disposition: "hard_failure",
        code: "INVARIANT_VIOLATION",
        message: "outbox invariant violation",
        httpStatus: 500,
        grpcStatusName: "INTERNAL",
      };
    case "UNKNOWN_PENDING_RECONCILIATION":
      return {
        disposition: "unknown",
        code: "UNKNOWN_PENDING_RECONCILIATION",
        message: "commit outcome unknown",
        httpStatus: 500,
        grpcStatusName: "UNKNOWN",
      };
    default: {
      const _exhaustive: never = result;
      throw new Error(`trust_enqueue_outcome_unhandled:${JSON.stringify(_exhaustive)}`);
    }
  }
}
