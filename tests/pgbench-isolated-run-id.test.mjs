import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COLIMA_SEQUENTIAL_RUN_ID,
  PLACEHOLDER_CONTENTION_DOMAIN,
  PLACEHOLDER_ISOLATED_RUN_ID,
  assertIsolatedRunId,
  assertManifestLaunchable,
  assertPhase2ShardCountFrozen,
  assertRunIdentityImmutable,
  buildIsolatedLaunchManifest,
  mintIsolatedRunId,
  resumeDirForIsolatedRunId,
} from "../scripts/lib/pgbench_isolated_shard_launcher.mjs";

describe("isolated run-id placeholders", () => {
  it("P1/P2/P3 refuse placeholder, Colima, and empty", () => {
    assert.equal(assertIsolatedRunId("NEW_RUN_ID_REQUIRED").ok, false);
    assert.equal(assertIsolatedRunId(PLACEHOLDER_ISOLATED_RUN_ID).ok, false);
    assert.equal(assertIsolatedRunId(COLIMA_SEQUENTIAL_RUN_ID).ok, false);
    assert.equal(assertIsolatedRunId("").ok, false);
    assert.equal(assertIsolatedRunId(null).ok, false);
  });

  it("P4/P9 minted id is executable-shaped", () => {
    const id = mintIsolatedRunId({
      git_sha: "ef21a35e18b721b369fbb1a42f975f59a1c43f79",
      now: new Date("2026-08-12T22:30:00Z"),
    });
    assert.match(id, /^pgbench-isolated-20260812-223000-ef21a35e$/);
    assert.equal(assertIsolatedRunId(id).ok, true);
    assert.equal(
      resumeDirForIsolatedRunId(id),
      "reports/performance/pgbench/pgbench-isolated-20260812-223000-ef21a35e",
    );
  });

  it("P5 refuses identity change after checkpoint", () => {
    const frozen = "pgbench-isolated-20260812-223000-ef21a35e";
    const reminted = mintIsolatedRunId({
      git_sha: "ef21a35e18b721b369fbb1a42f975f59a1c43f79",
      now: new Date("2026-08-12T22:31:00Z"),
    });
    assert.notEqual(reminted, frozen);
    assert.equal(assertRunIdentityImmutable(frozen, reminted).ok, false);
    assert.equal(assertRunIdentityImmutable(frozen, frozen).ok, true);
    assert.equal(assertRunIdentityImmutable(null, reminted).ok, true);
  });

  it("P6/P7/P8 draft is not launchable", () => {
    const draft = buildIsolatedLaunchManifest({ phase2_shard_count: 4 });
    assert.equal(draft.isolated_run_id, PLACEHOLDER_ISOLATED_RUN_ID);
    assert.equal(draft.launch_now, false);
    const r = assertManifestLaunchable(draft);
    assert.equal(r.ok, false);
    assert.equal(r.exit_code, 2);
    assert.ok(draft.phase_1.vms.some((v) => v.contention_domain_id === PLACEHOLDER_CONTENTION_DOMAIN));
  });

  it("P10 Phase-2 count immutable after checkpoint", () => {
    assert.equal(
      assertPhase2ShardCountFrozen({ declared: 1, frozen: 4, phase2_checkpoint_exists: true }).ok,
      false,
    );
    assert.equal(
      assertPhase2ShardCountFrozen({ declared: 4, frozen: 4, phase2_checkpoint_exists: true }).ok,
      true,
    );
    assert.equal(
      assertPhase2ShardCountFrozen({ declared: 1, frozen: null, phase2_checkpoint_exists: false }).ok,
      true,
    );
  });
});
