/**
 * Track A meta-auditor — verifies CI artifacts + PREPARED packet hashes.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const EMIT = join(REPO, "scripts/ci/run-track-a-exact-sha-ci.mjs");
const AUDITOR = join(REPO, "scripts/audit-track-a-meta.py");

function writeJsonSha(path, payload) {
  const raw = `${JSON.stringify(payload, null, 2)}\n`;
  writeFileSync(path, raw);
  writeFileSync(`${path}.sha256`, `${createHash("sha256").update(raw).digest("hex")}\n`);
}

function seedTempRepoFromCi() {
  const emit = spawnSync("node", [EMIT, "--skip-tests", "--skip-meta"], {
    cwd: REPO,
    encoding: "utf8",
  });
  assert.equal(emit.status, 0, emit.stderr || emit.stdout);

  const dir = mkdtempSync(join(tmpdir(), "track-a-meta-"));
  const ci = join(dir, "reports/ci");
  mkdirSync(ci, { recursive: true });
  mkdirSync(join(dir, "reports/outbox"), { recursive: true });
  symlinkSync(join(REPO, "scripts"), join(dir, "scripts"));

  for (const name of [
    "denom-freeze.json",
    "track-a1-provenance-result.json",
    "track-a2-readonly-probe-result.json",
    "track-a-exact-sha-bundle.json",
  ]) {
    const payload = JSON.parse(readFileSync(join(REPO, "reports/ci", name), "utf8"));
    writeJsonSha(join(ci, name), payload);
  }

  const packetRel =
    "reports/outbox/canary-v3-live-window-authorization-packet.PREPARED.json";
  copyFileSync(join(REPO, packetRel), join(dir, packetRel));
  copyFileSync(join(REPO, `${packetRel}.sha256`), join(dir, `${packetRel}.sha256`));

  // Source files referenced by a1 source_file_shas must exist under temp repo.
  // Symlink each frozen path back to the real tree.
  const a1 = JSON.parse(readFileSync(join(ci, "track-a1-provenance-result.json"), "utf8"));
  for (const rel of Object.keys(a1.source_file_shas || {})) {
    const dest = join(dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    try {
      symlinkSync(join(REPO, rel), dest);
    } catch {
      /* already linked */
    }
  }

  return { dir, ci };
}

test("Track A exact-SHA emit + meta-auditor PASS on current tree", () => {
  const r = spawnSync("node", [EMIT, "--skip-tests"], {
    cwd: REPO,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.a1, "HARNESS_PASS");
  assert.equal(parsed.a2, "HARNESS_PASS");
  assert.equal(parsed.meta_auditor, "PASS");
  assert.equal(parsed.live_window_authorized, false);
  assert.equal(parsed.a2_live_acceptance_ready, false);

  const meta = JSON.parse(
    readFileSync(join(REPO, "reports/ci/track-a-meta-auditor-result.json"), "utf8"),
  );
  assert.equal(meta.verdict, "TRACK_A_META_PASS");
  assert.equal(meta.read_only_live_probe_pass, false);
  assert.equal(meta.canary_v3_execution_authorized, false);
  assert.deepEqual(meta.failures, []);
});

test("Track A meta-auditor fails when A2 claims live probe PASS", () => {
  const { dir, ci } = seedTempRepoFromCi();
  const a2Path = join(ci, "track-a2-readonly-probe-result.json");
  const a2 = JSON.parse(readFileSync(a2Path, "utf8"));
  a2.read_only_live_probe_pass = true;
  writeJsonSha(a2Path, a2);

  const r = spawnSync(
    "python3",
    [AUDITOR, "--repo", dir, "--ci-dir", ci, "--out", join(ci, "meta.json")],
    { cwd: REPO, encoding: "utf8" },
  );
  assert.equal(r.status, 2, r.stderr || r.stdout);
  const meta = JSON.parse(readFileSync(join(ci, "meta.json"), "utf8"));
  assert.equal(meta.verdict, "TRACK_A_META_FAIL");
  assert.ok(meta.failures.includes("a2:ci_claimed_live_probe_pass"));
  rmSync(dir, { recursive: true, force: true });
});

test("Track A meta-auditor fails on PREPARED adapter hash tamper", () => {
  const { dir, ci } = seedTempRepoFromCi();
  const packetPath = join(
    dir,
    "reports/outbox/canary-v3-live-window-authorization-packet.PREPARED.json",
  );
  const packet = JSON.parse(readFileSync(packetPath, "utf8"));
  packet.adapter_source_hashes.live_capture_module = "0".repeat(64);
  writeJsonSha(packetPath, packet);

  const r = spawnSync(
    "python3",
    [AUDITOR, "--repo", dir, "--ci-dir", ci, "--out", join(ci, "meta.json")],
    { cwd: REPO, encoding: "utf8" },
  );
  assert.equal(r.status, 2, r.stderr || r.stdout);
  const meta = JSON.parse(readFileSync(join(ci, "meta.json"), "utf8"));
  assert.equal(meta.verdict, "TRACK_A_META_FAIL");
  assert.ok(
    meta.failures.some((f) =>
      f.startsWith("packet:adapter_source_hash_mismatch:live_capture_module"),
    ),
  );
  rmSync(dir, { recursive: true, force: true });
});
