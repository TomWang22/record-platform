import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PER_OWNER_OPERATIONAL_ORDER } from "../scripts/lib/pgbench_resume.mjs";
import {
  PLACEHOLDER_CONTENTION_DOMAIN,
  PLACEHOLDER_ISOLATED_RUN_ID,
  buildIsolatedLaunchPlan,
  mintIsolatedRunId,
} from "../scripts/lib/pgbench_isolated_shard_launcher.mjs";

function phase1Domains() {
  return Object.fromEntries(
    PER_OWNER_OPERATIONAL_ORDER.map((o) => [o, `domain-owner-${o}`]),
  );
}

function phase2Domains() {
  return {
    "fullstack-0": "domain-fullstack-0",
    "fullstack-1": "domain-fullstack-1",
    "fullstack-2": "domain-fullstack-2",
    "fullstack-3": "domain-fullstack-3",
  };
}

function mintedRunId() {
  return mintIsolatedRunId({
    git_sha: "ef21a35e18b721b369fbb1a42f975f59a1c43f79",
    now: new Date("2026-08-12T22:30:00Z"),
  });
}

describe("isolated launch-plan generation", () => {
  it("L1/L2 Phase-1 plan has 11 OWNER_AFFINITY shards", () => {
    const isolated_run_id = mintedRunId();
    const plan = buildIsolatedLaunchPlan({
      isolated_run_id,
      phase: "PER_OWNER_CEILING",
      contention_domains: phase1Domains(),
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.spawn_pgbench, false);
    assert.equal(plan.phase, "PER_OWNER_CEILING");
    assert.equal(plan.shards.length, 11);
    assert.equal(plan.shards[0].owner, "records");
    assert.equal(plan.shards[0].launch_env.GATE3_SHARD_INDEX, "0");
    assert.equal(plan.shards[0].launch_env.GATE3_SHARD_MODE, "OWNER_AFFINITY");
    assert.equal(plan.shards[0].launch_env.GATE3_SHARD_COUNT, "11");
    assert.equal(plan.shards[0].launch_env.GATE3_PHASE, "PER_OWNER_CEILING");
    assert.equal(plan.shards[0].launch_env.GATE3_OWNER, "records");
    assert.equal(
      plan.shards[0].launch_env.GATE3_RESUME_DIR,
      "reports/performance/pgbench/pgbench-isolated-20260812-223000-ef21a35e",
    );
    assert.notEqual(plan.shards[0].launch_env.GATE3_RESUME_DIR, PLACEHOLDER_ISOLATED_RUN_ID);
    for (let i = 0; i < PER_OWNER_OPERATIONAL_ORDER.length; i++) {
      assert.equal(plan.shards[i].owner, PER_OWNER_OPERATIONAL_ORDER[i]);
      assert.equal(plan.shards[i].launch_env.GATE3_SHARD_INDEX, String(i));
      assert.equal(plan.shards[i].launch_env.GATE3_OWNER, PER_OWNER_OPERATIONAL_ORDER[i]);
    }
  });

  it("L8 plan never spawns pgbench", () => {
    const phase1 = buildIsolatedLaunchPlan({
      isolated_run_id: mintedRunId(),
      phase: "PER_OWNER_CEILING",
      contention_domains: phase1Domains(),
    });
    const phase2 = buildIsolatedLaunchPlan({
      isolated_run_id: mintedRunId(),
      phase: "ALL_OWNERS_CONCURRENT",
      phase2_shard_count: 4,
      phase2_declared_before_execution: true,
      contention_domains: phase2Domains(),
    });
    assert.equal(phase1.ok, true);
    assert.equal(phase1.spawn_pgbench, false);
    assert.equal(phase2.ok, true);
    assert.equal(phase2.spawn_pgbench, false);
    const src = readFileSync(
      new URL("../scripts/lib/pgbench_isolated_shard_launcher.mjs", import.meta.url),
      "utf8",
    );
    assert.equal(/\bfrom\s+["']node:child_process["']/.test(src), false);
    assert.equal(/\bimport\s*\(\s*["']node:child_process["']/.test(src), false);
    assert.equal(src.includes("run-pgbench-matrix"), false);
    assert.equal(
      phase1.shards.every((s) => !s.argv && !s.command && !s.spawn),
      true,
    );
    assert.equal(
      phase2.shards.every((s) => !s.argv && !s.command && !s.spawn),
      true,
    );
  });

  it("refuses placeholder run id and DECLARED_AT_PROVISION domains", () => {
    const badId = buildIsolatedLaunchPlan({
      isolated_run_id: PLACEHOLDER_ISOLATED_RUN_ID,
      phase: "PER_OWNER_CEILING",
      contention_domains: phase1Domains(),
    });
    assert.equal(badId.ok, false);
    assert.equal(badId.spawn_pgbench, false);

    const domains = phase1Domains();
    domains.records = PLACEHOLDER_CONTENTION_DOMAIN;
    const badDomain = buildIsolatedLaunchPlan({
      isolated_run_id: mintedRunId(),
      phase: "PER_OWNER_CEILING",
      contention_domains: domains,
    });
    assert.equal(badDomain.ok, false);
    assert.equal(badDomain.spawn_pgbench, false);

    const fsDomains = phase2Domains();
    fsDomains["fullstack-0"] = PLACEHOLDER_CONTENTION_DOMAIN;
    const badFs = buildIsolatedLaunchPlan({
      isolated_run_id: mintedRunId(),
      phase: "ALL_OWNERS_CONCURRENT",
      phase2_shard_count: 4,
      phase2_declared_before_execution: true,
      contention_domains: fsDomains,
    });
    assert.equal(badFs.ok, false);
    assert.equal(badFs.spawn_pgbench, false);
    assert.notEqual(badFs.reason, "PHASE_PLAN_NOT_IMPLEMENTED");
    assert.equal(
      (badFs.reasons || []).some((r) => /DECLARED_AT_PROVISION/.test(r)),
      true,
    );
  });

  it("L3/L4/L5 Phase-2 HASH plan covers 1218 without split", () => {
    const isolated_run_id = mintedRunId();
    const plan = buildIsolatedLaunchPlan({
      isolated_run_id,
      phase: "ALL_OWNERS_CONCURRENT",
      phase2_shard_count: 4,
      phase2_declared_before_execution: true,
      contention_domains: phase2Domains(),
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.spawn_pgbench, false);
    assert.equal(plan.phase, "ALL_OWNERS_CONCURRENT");
    assert.equal(plan.shards.length, 4);
    assert.equal(plan.cell_split_across_vms, false);
    assert.deepEqual(plan.expected_cells_by_shard, [311, 296, 309, 302]);
    assert.deepEqual(
      plan.shards.map((s) => s.expected_cells),
      [311, 296, 309, 302],
    );
    assert.equal(plan.shards[0].launch_env.GATE3_SHARD_MODE, "HASH");
    assert.equal(plan.shards[0].launch_env.GATE3_SHARD_COUNT, "4");
    assert.equal(plan.shards[0].launch_env.GATE3_PHASE, "ALL_OWNERS_CONCURRENT");
    assert.equal(plan.shards[0].launch_env.GATE3_OWNER, undefined);
    assert.equal(plan.shards[0].cell_split_across_vms, false);
    for (let i = 0; i < plan.shards.length; i++) {
      const shard = plan.shards[i];
      assert.equal(shard.launch_env.GATE3_SHARD_MODE, "HASH");
      assert.equal(shard.launch_env.GATE3_SHARD_COUNT, "4");
      assert.equal(shard.launch_env.GATE3_SHARD_INDEX, String(i));
      assert.equal(shard.launch_env.GATE3_OWNER, undefined);
      assert.equal(shard.cell_split_across_vms, false);
      assert.equal(shard.cell_ids.length, shard.expected_cells);
    }
    const ids = plan.shards.flatMap((s) => s.cell_ids);
    assert.equal(ids.length, 1218);
    assert.equal(new Set(ids).size, 1218);
  });

  it("L6 fallback HASH×1 before Phase 2", () => {
    const plan = buildIsolatedLaunchPlan({
      isolated_run_id: mintIsolatedRunId({
        git_sha: "ef21a35e18b721b369fbb1a42f975f59a1c43f79",
        now: new Date("2026-08-12T22:30:00Z"),
      }),
      phase: "ALL_OWNERS_CONCURRENT",
      phase2_shard_count: 1,
      phase2_declared_before_execution: true,
      phase2_checkpoint_exists: false,
      contention_domains: { "fullstack-0": "domain-fullstack-0" },
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.spawn_pgbench, false);
    assert.equal(plan.shards.length, 1);
    assert.equal(plan.shards[0].expected_cells, 1218);
    assert.equal(plan.shards[0].launch_env.GATE3_SHARD_MODE, "HASH");
    assert.equal(plan.shards[0].launch_env.GATE3_SHARD_COUNT, "1");
    assert.equal(plan.shards[0].launch_env.GATE3_OWNER, undefined);
  });

  it("L7 refuses 4→1 after Phase-2 checkpoint", () => {
    const plan = buildIsolatedLaunchPlan({
      isolated_run_id: mintIsolatedRunId({
        git_sha: "ef21a35e18b721b369fbb1a42f975f59a1c43f79",
        now: new Date("2026-08-12T22:30:00Z"),
      }),
      phase: "ALL_OWNERS_CONCURRENT",
      phase2_shard_count: 1,
      phase2_declared_before_execution: true,
      phase2_frozen_shard_count: 4,
      phase2_checkpoint_exists: true,
      contention_domains: { "fullstack-0": "domain-fullstack-0" },
    });
    assert.equal(plan.ok, false);
    assert.equal(plan.spawn_pgbench, false);
    assert.notEqual(plan.reason, "PHASE_PLAN_NOT_IMPLEMENTED");
    assert.equal(
      (plan.reasons || []).some((r) => /immutable|frozen|checkpoint/i.test(r)),
      true,
    );
  });
});
