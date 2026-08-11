/**
 * Phase B enqueue transaction: pool.connect() → one PoolClient →
 * BEGIN → work → COMMIT.
 *
 * COMMIT throw is not unpublished proof (E4/G7). Fresh-connection SELECT
 * on frozen event_id + domain identity:
 *   both present   => COMMIT_PERSISTED_RECOVERED
 *   neither        => COMMIT_NOT_PERSISTED
 *   exactly one    => INVARIANT_VIOLATION
 *   unavailable    => UNKNOWN_PENDING_RECONCILIATION
 */
import type { Pool, PoolClient } from "pg";

export type TrustEnqueueCommitOutcome =
  | "committed"
  | "COMMIT_PERSISTED_RECOVERED"
  | "COMMIT_NOT_PERSISTED"
  | "INVARIANT_VIOLATION"
  | "UNKNOWN_PENDING_RECONCILIATION";

export type TrustEnqueueDomainIdentity =
  | { kind: "listing_flag_submitted"; flagId: string }
  | { kind: "peer_review_created"; reviewId: string };

export type TrustEnqueueIdentity = {
  eventId: string;
  domain: TrustEnqueueDomainIdentity;
};

export type TrustEnqueueResult<T> =
  | { outcome: "committed"; value: T }
  | { outcome: "COMMIT_PERSISTED_RECOVERED"; value: T }
  | { outcome: "COMMIT_NOT_PERSISTED" }
  | { outcome: "INVARIANT_VIOLATION" }
  | { outcome: "UNKNOWN_PENDING_RECONCILIATION" };

export function classifyTrustEnqueueCommitReconciliation(
  outboxExists: boolean | null,
  domainExists: boolean | null,
): Exclude<TrustEnqueueCommitOutcome, "committed"> {
  if (outboxExists == null || domainExists == null) {
    return "UNKNOWN_PENDING_RECONCILIATION";
  }
  if (outboxExists && domainExists) return "COMMIT_PERSISTED_RECOVERED";
  if (!outboxExists && !domainExists) return "COMMIT_NOT_PERSISTED";
  return "INVARIANT_VIOLATION";
}

function domainExistsSql(domain: TrustEnqueueDomainIdentity): {
  sql: string;
  id: string;
} {
  switch (domain.kind) {
    case "listing_flag_submitted":
      return {
        sql: `SELECT EXISTS(SELECT 1 FROM trust.listing_flags WHERE id = $1::uuid) AS exists`,
        id: domain.flagId,
      };
    case "peer_review_created":
      return {
        sql: `SELECT EXISTS(SELECT 1 FROM trust.reviews WHERE id = $1::uuid) AS exists`,
        id: domain.reviewId,
      };
    default: {
      const _exhaustive: never = domain;
      throw new Error(`trust_enqueue_domain_kind_invalid:${JSON.stringify(_exhaustive)}`);
    }
  }
}

async function existsFlag(client: PoolClient, sql: string, id: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(sql, [id]);
  return rows[0]?.exists === true;
}

async function reconcileOnFreshConnection(
  pool: Pool,
  identity: TrustEnqueueIdentity,
): Promise<Exclude<TrustEnqueueCommitOutcome, "committed">> {
  let recon: PoolClient;
  try {
    recon = await pool.connect();
  } catch {
    return "UNKNOWN_PENDING_RECONCILIATION";
  }
  try {
    const outbox = await existsFlag(
      recon,
      `SELECT EXISTS(SELECT 1 FROM trust.outbox_events WHERE id = $1::uuid) AS exists`,
      identity.eventId,
    );
    const domainQ = domainExistsSql(identity.domain);
    const domain = await existsFlag(recon, domainQ.sql, domainQ.id);
    return classifyTrustEnqueueCommitReconciliation(outbox, domain);
  } catch {
    return "UNKNOWN_PENDING_RECONCILIATION";
  } finally {
    recon.release();
  }
}

export async function runTrustEnqueueTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
  identityOf: (value: T) => TrustEnqueueIdentity,
): Promise<TrustEnqueueResult<T>> {
  const client = await pool.connect();
  let released = false;
  try {
    await client.query("BEGIN");
    const value = await work(client);
    const identity = identityOf(value);
    try {
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      released = true;
      const outcome = await reconcileOnFreshConnection(pool, identity);
      if (outcome === "COMMIT_PERSISTED_RECOVERED") {
        return { outcome, value };
      }
      return { outcome };
    }
    return { outcome: "committed", value };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (!released) client.release();
  }
}
