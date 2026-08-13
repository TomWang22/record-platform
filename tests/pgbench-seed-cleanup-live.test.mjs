/**
 * Live seed/cleanup stability against Colima records DB.
 * Requires records_outbox_pgbench_type_idx so cleanup does not seq-scan production outbox.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  cardinalitySnapshotsEqual,
  inspectHarnessCardinalities,
  runSeedCleanupStabilityCycle,
  CLEANUP_SQL_REL,
  SEED_SQL_REL,
} from "../scripts/lib/pgbench_seed_cleanup.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("pgbench seed/cleanup live stability", () => {
  it("live records CLEAN/SEED/workload/CLEAN/SEED restores the same cardinalities", (t) => {
    const psql = (args) =>
      spawnSync("psql", ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "records", ...args], {
        env: { ...process.env, PGPASSWORD: "postgres" },
        encoding: "utf8",
      });
    const ping = psql(["-t", "-A", "-c", "SELECT 1"]);
    if (ping.status !== 0) {
      throw new Error(`records postgres unavailable: ${ping.stderr || ping.stdout}`);
    }
    const idx = psql([
      "-t",
      "-A",
      "-c",
      "SELECT 1 FROM pg_indexes WHERE schemaname = 'records' AND indexname = 'records_outbox_pgbench_type_idx'",
    ]);
    if (String(idx.stdout || "").trim() !== "1") {
      t.skip("partial outbox index not ready; avoids seq-scan of production outbox_events");
      return;
    }
    const countSql = `
      SELECT json_build_object(
        'domain_touch', (SELECT count(*) FROM records.pgbench_domain_touch WHERE note LIKE 'pgbench-%' OR note LIKE 'w1-%' OR note LIKE 'w2-%' OR note LIKE 'wmix-%'),
        'unpublished_seed', (SELECT count(*) FROM records.outbox_events WHERE type = 'PgbenchSeedV1' AND published = false),
        'published_seed', (SELECT count(*) FROM records.outbox_events WHERE type = 'PgbenchSeedV1' AND published = true),
        'unpublished_domain_touch_outbox', (SELECT count(*) FROM records.outbox_events WHERE type = 'PgbenchDomainTouchV1' AND published = false),
        'published_domain_touch_outbox', (SELECT count(*) FROM records.outbox_events WHERE type = 'PgbenchDomainTouchV1' AND published = true)
      );
    `;
    const inspect = () => {
      const r = psql(["-t", "-A", "-c", countSql]);
      if (r.status !== 0) throw new Error(r.stderr || r.stdout);
      return inspectHarnessCardinalities({ schema: "records", counts: JSON.parse(String(r.stdout).trim()) });
    };
    const result = runSeedCleanupStabilityCycle({
      schema: "records",
      cleanup: () => {
        const r = psql(["-v", "ON_ERROR_STOP=1", "-f", join(ROOT, CLEANUP_SQL_REL)]);
        if (r.status !== 0) throw new Error(r.stderr || r.stdout);
      },
      seed: () => {
        const r = psql(["-v", "ON_ERROR_STOP=1", "-f", join(ROOT, SEED_SQL_REL)]);
        if (r.status !== 0) throw new Error(r.stderr || r.stdout);
      },
      inspect,
      workloads: {
        W1: () => {
          psql(["-c", "INSERT INTO records.pgbench_domain_touch (id, touched_at, note) VALUES (gen_random_uuid(), now(), 'w1-domain-touch')"]);
        },
        W2: () => {
          psql(["-c", `INSERT INTO records.pgbench_domain_touch (id, touched_at, note) VALUES (gen_random_uuid(), now(), 'w2-domain-touch');
            INSERT INTO records.outbox_events (id, aggregate_id, type, version, payload, published)
            VALUES (gen_random_uuid(), gen_random_uuid()::text, 'PgbenchDomainTouchV1', 1, convert_to('{"bench":true}','UTF8')::bytea, false);`]);
        },
        W3: () => {
          psql(["-c", "UPDATE records.outbox_events SET published = true WHERE id = (SELECT id FROM records.outbox_events WHERE type = 'PgbenchSeedV1' AND published = false LIMIT 1)"]);
        },
        WMIX: () => {
          psql(["-c", "INSERT INTO records.pgbench_domain_touch (id, touched_at, note) VALUES (gen_random_uuid(), now(), 'wmix-w1-domain-touch')"]);
        },
      },
    });
    assert.equal(result.ok, true);
    assert.ok(cardinalitySnapshotsEqual(result.baseline_a, result.baseline_b));
    assert.equal(result.baseline_a.domain_touch, 64);
    assert.equal(result.baseline_a.unpublished_seed, 256);
    assert.equal(result.baseline_a.published_seed, 0);
  });
});
