/**
 * Read-only Gate-3 sequential-run progress / stall watchdog.
 * Does not alter benchmark execution, resume, or authorization flags.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import {
  evaluateRunWatchdog,
  parseProgressLog,
  appendWatchdogHistory,
  estimateOwnerEta,
  resolveLastProgressAtMs,
  writeJsonAtomic,
} from "../scripts/lib/pgbench_run_watchdog.mjs";

describe("pgbench run watchdog", () => {
  it("parses progress lines from env-aware log", () => {
    const text = [
      '{"progress":true,"executed":17,"pending_remaining":14599,"status":"PASS","cell_id":"PER_OWNER_CEILING|records|W1_DOMAIN_ONLY|UNIFORM|c16|t1|bNA|r1","tps":1}',
      '{"progress":true,"executed":18,"pending_remaining":14598,"status":"PASS","cell_id":"PER_OWNER_CEILING|records|W1_DOMAIN_ONLY|UNIFORM|c16|t1|bNA|r2","tps":2}',
    ].join("\n");
    const events = parseProgressLog(text);
    assert.equal(events.length, 2);
    assert.equal(events[1].executed, 18);
    assert.match(events[1].cell_id, /records/);
  });

  it("reports RUNNING when process alive and progress recent", () => {
    const now = Date.now();
    const r = evaluateRunWatchdog({
      now_ms: now,
      runner_alive: true,
      pgbench_alive: true,
      last_progress_at_ms: now - 60_000,
      stall_after_ms: 20 * 60_000,
      expected_cell_seconds: 150,
      last_progress: { executed: 18, cell_id: "x", status: "PASS" },
      owner_valid_cells: 18,
      owner_expected_cells: 1218,
    });
    assert.equal(r.state, "RUNNING");
    assert.equal(r.stalled, false);
    assert.equal(r.owner_complete, false);
  });

  it("reports STALLED when no progress beyond threshold while runner claimed alive", () => {
    const now = Date.now();
    const r = evaluateRunWatchdog({
      now_ms: now,
      runner_alive: true,
      pgbench_alive: false,
      last_progress_at_ms: now - 45 * 60_000,
      stall_after_ms: 20 * 60_000,
      expected_cell_seconds: 150,
      last_progress: { executed: 18, cell_id: "x", status: "PASS" },
      owner_valid_cells: 18,
      owner_expected_cells: 1218,
    });
    assert.equal(r.state, "STALLED");
    assert.equal(r.stalled, true);
    assert.match(r.reason, /no progress/i);
  });

  it("reports STOPPED when runner process is gone", () => {
    const now = Date.now();
    const r = evaluateRunWatchdog({
      now_ms: now,
      runner_alive: false,
      pgbench_alive: false,
      last_progress_at_ms: now - 60_000,
      stall_after_ms: 20 * 60_000,
      last_progress: { executed: 18, cell_id: "x", status: "PASS" },
      owner_valid_cells: 18,
      owner_expected_cells: 1218,
    });
    assert.equal(r.state, "STOPPED");
    assert.equal(r.stalled, false);
  });
});

describe("pgbench watchdog history + ETA", () => {
  it("appends history samples without mutating prior entries", () => {
    const prev = {
      samples: [
        {
          at: "2026-08-12T01:00:00.000Z",
          owner_valid_cells: 10,
          executed: 10,
          state: "RUNNING",
        },
      ],
    };
    const next = appendWatchdogHistory(prev, {
      at: "2026-08-12T01:05:00.000Z",
      owner_valid_cells: 12,
      executed: 12,
      state: "RUNNING",
    });
    assert.equal(prev.samples.length, 1);
    assert.equal(next.samples.length, 2);
    assert.equal(next.samples[1].owner_valid_cells, 12);
  });

  it("estimates ETA from observed cell rate (theoretical floor note)", () => {
    const eta = estimateOwnerEta({
      owner_valid_cells: 27,
      owner_expected_cells: 1218,
      samples: [
        { at_ms: 1_000_000, owner_valid_cells: 10 },
        { at_ms: 1_000_000 + 30 * 60_000, owner_valid_cells: 27 },
      ],
      fallback_seconds_per_cell: 150,
    });
    assert.equal(eta.remaining_cells, 1191);
    assert.ok(eta.seconds_per_cell_observed > 0);
    assert.ok(eta.eta_seconds_observed > 0);
    assert.ok(eta.eta_seconds_contract_floor > 0);
    assert.match(eta.note, /theoretical|observed/i);
    assert.equal(eta.owner_complete, false);
  });

  it("does not claim completion from ETA helpers", () => {
    const eta = estimateOwnerEta({
      owner_valid_cells: 1218,
      owner_expected_cells: 1218,
      samples: [],
      fallback_seconds_per_cell: 150,
    });
    assert.equal(eta.remaining_cells, 0);
    assert.equal(eta.eta_seconds_observed, 0);
    assert.equal(eta.pgbench_ceiling_complete, false);
  });
});

describe("pgbench watchdog stall timer is progress-event-based", () => {
  const stallAfter = 20 * 60_000;
  const t0 = 1_700_000_000_000;

  it("does not reset stall timer on unrelated log mtime / non-progress writes", () => {
    const lastRealProgress = t0;
    const logMtimeAfterWarning = t0 + 5 * 60_000;
    const now = t0 + 25 * 60_000;
    const last_progress_at_ms = resolveLastProgressAtMs({
      now_ms: now,
      log_mtime_ms: logMtimeAfterWarning,
      events: [
        {
          executed: 21,
          cell_id: "PER_OWNER_CEILING|records|W1_DOMAIN_ONLY|UNIFORM|c16|t4|bNA|r3",
          at_ms: lastRealProgress,
        },
      ],
      history_samples: [
        {
          at_ms: lastRealProgress,
          owner_valid_cells: 21,
          executed: 21,
          cell_id: "PER_OWNER_CEILING|records|W1_DOMAIN_ONLY|UNIFORM|c16|t4|bNA|r3",
        },
      ],
      owner_valid_cells: 21,
    });
    assert.equal(last_progress_at_ms, lastRealProgress);
    assert.notEqual(last_progress_at_ms, logMtimeAfterWarning);
    const r = evaluateRunWatchdog({
      now_ms: now,
      runner_alive: true,
      pgbench_alive: true,
      last_progress_at_ms,
      stall_after_ms: stallAfter,
      last_progress: { executed: 21, cell_id: "same", status: "PASS" },
      owner_valid_cells: 21,
      owner_expected_cells: 1218,
    });
    assert.equal(r.state, "STALLED");
    assert.equal(r.stalled, true);
  });

  it("does not reset stall timer when executed/cell_id are unchanged", () => {
    const lastRealProgress = t0;
    const now = t0 + 25 * 60_000;
    const last_progress_at_ms = resolveLastProgressAtMs({
      now_ms: now,
      log_mtime_ms: now,
      events: [
        {
          executed: 21,
          cell_id: "cell-a",
          at_ms: lastRealProgress,
        },
        {
          executed: 21,
          cell_id: "cell-a",
          at_ms: now,
        },
      ],
      history_samples: [
        { at_ms: lastRealProgress, owner_valid_cells: 21, executed: 21, cell_id: "cell-a" },
      ],
      owner_valid_cells: 21,
    });
    assert.equal(last_progress_at_ms, lastRealProgress);
    const r = evaluateRunWatchdog({
      now_ms: now,
      runner_alive: true,
      pgbench_alive: true,
      last_progress_at_ms,
      stall_after_ms: stallAfter,
      last_progress: { executed: 21, cell_id: "cell-a", status: "PASS" },
      owner_valid_cells: 21,
      owner_expected_cells: 1218,
    });
    assert.equal(r.stalled, true);
  });

  it("resets stall timer when a new completed cell appears", () => {
    const lastRealProgress = t0;
    const newCellAt = t0 + 3 * 60_000;
    const now = t0 + 4 * 60_000;
    const last_progress_at_ms = resolveLastProgressAtMs({
      now_ms: now,
      log_mtime_ms: now,
      events: [
        { executed: 21, cell_id: "cell-a", at_ms: lastRealProgress },
        { executed: 22, cell_id: "cell-b", at_ms: newCellAt },
      ],
      history_samples: [
        { at_ms: lastRealProgress, owner_valid_cells: 21, executed: 21, cell_id: "cell-a" },
      ],
      owner_valid_cells: 22,
    });
    assert.equal(last_progress_at_ms, newCellAt);
    const r = evaluateRunWatchdog({
      now_ms: now,
      runner_alive: true,
      pgbench_alive: true,
      last_progress_at_ms,
      stall_after_ms: stallAfter,
      last_progress: { executed: 22, cell_id: "cell-b", status: "PASS" },
      owner_valid_cells: 22,
      owner_expected_cells: 1218,
    });
    assert.equal(r.state, "RUNNING");
    assert.equal(r.stalled, false);
  });

  it("resets stall timer when owner_valid_cells increases in history", () => {
    const lastRealProgress = t0;
    const increaseAt = t0 + 2 * 60_000;
    const now = t0 + 3 * 60_000;
    const last_progress_at_ms = resolveLastProgressAtMs({
      now_ms: now,
      log_mtime_ms: now,
      events: [{ executed: 21, cell_id: "cell-a", at_ms: lastRealProgress }],
      history_samples: [
        { at_ms: lastRealProgress, owner_valid_cells: 21, executed: 21, cell_id: "cell-a" },
        { at_ms: increaseAt, owner_valid_cells: 22, executed: 21, cell_id: "cell-a" },
      ],
      owner_valid_cells: 22,
    });
    assert.equal(last_progress_at_ms, increaseAt);
  });
});

describe("pgbench watchdog atomic JSON persistence", () => {
  it("writes via same-directory temp then rename and leaves no tmp files", () => {
    const dir = mkdtempSync(join(tmpdir(), "pgbench-watchdog-atomic-"));
    try {
      const dest = join(dir, "latest.json");
      /** @type {{ from: string, to: string } | null} */
      let seen = null;
      writeJsonAtomic(dest, { schema: "v1", n: 1 }, {
        renameSync: (from, to) => {
          seen = { from, to };
          renameSync(from, to);
        },
      });
      assert.ok(seen);
      assert.equal(seen.to, dest);
      assert.equal(dirname(seen.from), dir);
      assert.match(seen.from, /\.tmp$/);
      assert.equal(JSON.parse(readFileSync(dest, "utf8")).n, 1);
      assert.equal(readdirSync(dir).filter((f) => f.endsWith(".tmp")).length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the previous document if rename never happens after temp write", () => {
    const dir = mkdtempSync(join(tmpdir(), "pgbench-watchdog-atomic-fail-"));
    try {
      const dest = join(dir, "history.json");
      writeFileSync(dest, JSON.stringify({ samples: [1] }) + "\n");
      assert.throws(() => {
        writeJsonAtomic(dest, { samples: [1, 2] }, {
          renameSync: () => {
            throw new Error("simulated crash before rename");
          },
        });
      });
      assert.deepEqual(JSON.parse(readFileSync(dest, "utf8")), { samples: [1] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fsyncs the parent directory after rename for power-loss durability", () => {
    const dir = mkdtempSync(join(tmpdir(), "pgbench-watchdog-dirsync-"));
    try {
      const dest = join(dir, "latest.json");
      /** @type {string[]} */
      const order = [];
      writeJsonAtomic(dest, { n: 1 }, {
        renameSync: (from, to) => {
          order.push("rename");
          renameSync(from, to);
        },
        fsyncDirSync: (d) => {
          order.push("fsync_dir");
          assert.equal(d, dir);
        },
      });
      assert.deepEqual(order, ["rename", "fsync_dir"]);
      assert.equal(JSON.parse(readFileSync(dest, "utf8")).n, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("cleans up temp files after both successful and failed atomic writes", () => {
    const dir = mkdtempSync(join(tmpdir(), "pgbench-watchdog-tmp-cleanup-"));
    try {
      const dest = join(dir, "history.json");
      writeJsonAtomic(dest, { samples: [1] });
      assert.equal(readdirSync(dir).filter((f) => f.endsWith(".tmp")).length, 0);

      writeFileSync(dest, JSON.stringify({ samples: [1] }) + "\n");
      assert.throws(() => {
        writeJsonAtomic(dest, { samples: [1, 2] }, {
          renameSync: () => {
            throw new Error("simulated crash before rename");
          },
        });
      });
      assert.deepEqual(JSON.parse(readFileSync(dest, "utf8")), { samples: [1] });
      assert.equal(
        readdirSync(dir).filter((f) => f.endsWith(".tmp")).length,
        0,
        "failed atomic write must not leave .tmp files",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
