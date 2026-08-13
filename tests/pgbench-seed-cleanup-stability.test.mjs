/**
 * seed → workload → cleanup → seed must restore the same harness cardinalities.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cardinalitySnapshotsEqual,
  inspectHarnessCardinalities,
  runSeedCleanupStabilityCycle,
} from "../scripts/lib/pgbench_seed_cleanup.mjs";

describe("pgbench seed/cleanup stability", () => {
  it("BASELINE_A equals BASELINE_B after CLEAN/SEED/workload/CLEAN/SEED", () => {
    /** @type {Record<string, { domain: any[], outbox: any[] }>} */
    const db = { records: { domain: [], outbox: [] } };

    const execSql = (sql) => {
      if (/DELETE FROM records\.outbox_events/.test(sql) && /PgbenchSeedV1/.test(sql)) {
        db.records.outbox = db.records.outbox.filter(
          (r) => r.type !== "PgbenchSeedV1" && r.type !== "PgbenchDomainTouchV1",
        );
        return { ok: true, rows: [] };
      }
      if (/DELETE FROM records\.pgbench_domain_touch/.test(sql)) {
        db.records.domain = db.records.domain.filter(
          (r) =>
            r.note &&
            !String(r.note).startsWith("pgbench-") &&
            !String(r.note).startsWith("w1-") &&
            !String(r.note).startsWith("w2-") &&
            !String(r.note).startsWith("wmix-"),
        );
        return { ok: true, rows: [] };
      }
      if (/INSERT INTO records\.pgbench_domain_touch/.test(sql) && /pgbench-seed/.test(sql)) {
        for (let i = 0; i < 64; i++) db.records.domain.push({ note: "pgbench-seed" });
        return { ok: true, rows: [] };
      }
      if (/INSERT INTO records\.outbox_events/.test(sql) && /PgbenchSeedV1/.test(sql)) {
        for (let i = 0; i < 256; i++) {
          db.records.outbox.push({ type: "PgbenchSeedV1", published: false });
        }
        return { ok: true, rows: [] };
      }
      if (/note = 'w1-domain-touch'/.test(sql)) {
        db.records.domain.push({ note: "w1-domain-touch" });
        return { ok: true, rows: [] };
      }
      if (/PgbenchDomainTouchV1/.test(sql) && /INSERT/.test(sql)) {
        db.records.domain.push({ note: "w2-domain-touch" });
        db.records.outbox.push({ type: "PgbenchDomainTouchV1", published: false });
        return { ok: true, rows: [] };
      }
      if (/SET published = true/.test(sql)) {
        const unpublished = db.records.outbox.find((r) => r.published === false);
        if (unpublished) unpublished.published = true;
        return { ok: true, rows: [] };
      }
      if (/note = 'wmix-w1-domain-touch'/.test(sql)) {
        db.records.domain.push({ note: "wmix-w1-domain-touch" });
        return { ok: true, rows: [] };
      }
      return { ok: true, rows: [] };
    };

    const inspect = () =>
      inspectHarnessCardinalities({
        schema: "records",
        counts: {
          domain_touch: db.records.domain.filter((r) =>
            /^(pgbench-|w1-|w2-|wmix-)/.test(r.note || ""),
          ).length,
          unpublished_seed: db.records.outbox.filter((r) => r.type === "PgbenchSeedV1" && !r.published).length,
          published_seed: db.records.outbox.filter((r) => r.type === "PgbenchSeedV1" && r.published).length,
          unpublished_domain_touch_outbox: db.records.outbox.filter(
            (r) => r.type === "PgbenchDomainTouchV1" && !r.published,
          ).length,
        },
      });

    const result = runSeedCleanupStabilityCycle({
      schema: "records",
      cleanup: () => {
        execSql("DELETE FROM records.outbox_events WHERE type IN ('PgbenchSeedV1', 'PgbenchDomainTouchV1')");
        execSql("DELETE FROM records.pgbench_domain_touch WHERE note LIKE 'pgbench-%'");
      },
      seed: () => {
        execSql("INSERT INTO records.pgbench_domain_touch note pgbench-seed");
        execSql("INSERT INTO records.outbox_events PgbenchSeedV1");
      },
      inspect,
      workloads: {
        W1: () => execSql("note = 'w1-domain-touch'"),
        W2: () => execSql("INSERT PgbenchDomainTouchV1"),
        W3: () => execSql("SET published = true"),
        WMIX: () => execSql("note = 'wmix-w1-domain-touch'"),
      },
    });
    assert.equal(result.ok, true);
    assert.ok(cardinalitySnapshotsEqual(result.baseline_a, result.baseline_b));
    assert.equal(result.baseline_a.domain_touch, 64);
    assert.equal(result.baseline_a.unpublished_seed, 256);
    assert.equal(result.baseline_a.published_seed, 0);
  });
});
