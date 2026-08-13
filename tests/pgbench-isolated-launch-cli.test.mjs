import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COLIMA_SEQUENTIAL_RUN_ID,
  PLACEHOLDER_ISOLATED_RUN_ID,
} from "../scripts/lib/pgbench_isolated_shard_launcher.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "scripts/performance/launch-isolated-pgbench-shards.mjs");

function run(env = {}) {
  return spawnSync(process.execPath, [cli], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    cwd: root,
  });
}

function parseStdout(r) {
  return JSON.parse(r.stdout);
}

describe("fail-closed isolated launch CLI", () => {
  it("X1 draft JSON refuses with exit 2", () => {
    const r = run({
      GATE3_ISOLATED_MANIFEST: "scripts/performance/gate3-isolated-15-vm-launch-manifest.json",
    });
    assert.equal(r.status, 2);
    const json = parseStdout(r);
    assert.equal(json.launch, "REFUSED");
    assert.equal(json.launched, false);
    assert.equal(json.spawn_pgbench, false);
    assert.ok(
      json.reasons.some(
        (reason) =>
          reason.includes(PLACEHOLDER_ISOLATED_RUN_ID) ||
          reason.includes("NEW_RUN_ID_REQUIRED") ||
          reason.includes("DECLARED_AT_PROVISION"),
      ),
    );
  });

  it("X2 placeholder GATE3_RESUME_DIR refuses with exit 2", () => {
    const r = run({
      GATE3_RESUME_DIR: PLACEHOLDER_ISOLATED_RUN_ID,
    });
    assert.equal(r.status, 2);
    const json = parseStdout(r);
    assert.equal(json.launch, "REFUSED");
    assert.equal(json.launched, false);
    assert.equal(json.spawn_pgbench, false);
    assert.ok(json.reasons.some((reason) => reason.includes("NEW_RUN_ID_REQUIRED")));
  });

  it("X3 Colima resume dir refuses with exit 2", () => {
    const r = run({
      GATE3_RESUME_DIR: `reports/performance/pgbench/${COLIMA_SEQUENTIAL_RUN_ID}`,
    });
    assert.equal(r.status, 2);
    const json = parseStdout(r);
    assert.equal(json.launch, "REFUSED");
    assert.equal(json.launched, false);
    assert.equal(json.spawn_pgbench, false);
    assert.ok(json.reasons.some((reason) => reason.includes("Colima")));
  });

  it("X4 STOP: never launches or provisions", () => {
    const r = run({
      GATE3_ISOLATED_MANIFEST: "scripts/performance/gate3-isolated-15-vm-launch-manifest.json",
    });
    const json = parseStdout(r);
    assert.equal(json.launched, false);
    assert.equal(json.spawn_pgbench, false);
    assert.equal(json.provision, false);
    assert.ok(r.status === 0 || r.status === 2);
  });

  it("X5 authorization flags remain false / NO_GO", () => {
    const r = run({
      GATE3_ISOLATED_MANIFEST: "scripts/performance/gate3-isolated-15-vm-launch-manifest.json",
    });
    const json = parseStdout(r);
    assert.equal(json.tuning, "NO_GO");
    assert.equal(json.protocol, "NO_GO");
    assert.equal(json.track_c_acceptance_pass, false);
    assert.equal(json.platform_pass, false);
    assert.equal(json.pgbench_ceiling_complete, false);
    assert.notEqual(json.protocol_execution_authorized, true);
  });

  it("X6 CLI source does not writeFileSync under Colima report dir", () => {
    const src = readFileSync(cli, "utf8");
    assert.doesNotMatch(src, /writeFileSync[\s\S]*pgbench-contract-20260812-011924-ef21a35e/);
    assert.doesNotMatch(src, /run-pgbench-matrix\.mjs/);
    assert.doesNotMatch(src, /child_process/);
    assert.doesNotMatch(src, /\bspawn\b/);
  });

  it("X4/X5/X7 STOP does not spawn or authorize", () => {
    const src = readFileSync(join(root, "scripts/performance/launch-isolated-pgbench-shards.mjs"), "utf8");
    assert.equal(src.includes("run-pgbench-matrix.mjs"), false);
    assert.equal(/spawnSync\(|execFileSync\(/.test(src), false);
    assert.match(src, /launched: false/);
    assert.match(src, /track_c_acceptance_pass: false/);
    assert.match(src, /platform_pass: false/);
  });
});
