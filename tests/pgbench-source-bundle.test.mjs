/**
 * Canonical Gate-3 dynamic source bundle: SHA over every file that can affect a cell after startup.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import {
  computeBundleSha256,
  buildSourceBundle,
  assertSourceBundleCommitted,
  SOURCE_BUNDLE_MISSING,
  SOURCE_BUNDLE_UNTRACKED,
  SOURCE_BUNDLE_IGNORED,
  SOURCE_BUNDLE_DIRTY,
} from "../scripts/lib/pgbench_source_bundle.mjs";

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || "git failed");
  return r.stdout.trim();
}

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), "src-bundle-"));
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "bundle@test"]);
  git(dir, ["config", "user.name", "Bundle Test"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  return dir;
}

function write(root, rel, contents) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, contents);
  return p;
}

describe("pgbench source bundle SHA", () => {
  it("file ordering does not change bundle SHA", () => {
    const a = computeBundleSha256([
      { path: "b.sql", sha256: "11" },
      { path: "a.sql", sha256: "22" },
    ]);
    const b = computeBundleSha256([
      { path: "a.sql", sha256: "22" },
      { path: "b.sql", sha256: "11" },
    ]);
    assert.equal(a, b);
  });

  it("one byte change changes bundle SHA", () => {
    const a = computeBundleSha256([{ path: "a.sql", sha256: "aa" }]);
    const b = computeBundleSha256([{ path: "a.sql", sha256: "ab" }]);
    assert.notEqual(a, b);
  });
});

describe("pgbench source bundle commit freeze", () => {
  it("missing dynamic file fails", () => {
    const dir = initRepo();
    try {
      write(dir, "scripts/performance/pgbench/common/seed.sql", "select 1;\n");
      write(dir, ".gitignore", "");
      git(dir, ["add", "-A"]);
      git(dir, ["commit", "-m", "partial"]);
      const built = buildSourceBundle({
        repoRoot: dir,
        gitSha: git(dir, ["rev-parse", "HEAD"]),
        workloadRevision: "test",
        requiredPaths: [
          "scripts/performance/pgbench/common/seed.sql",
          "scripts/performance/pgbench/common/cleanup.sql",
        ],
      });
      assert.equal(built.ok, false);
      assert.ok(built.reasons.some((r) => r.startsWith(SOURCE_BUNDLE_MISSING)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("untracked dynamic file fails", () => {
    const dir = initRepo();
    try {
      write(dir, "scripts/performance/pgbench/common/seed.sql", "seed\n");
      git(dir, ["add", "-A"]);
      git(dir, ["commit", "-m", "seed"]);
      write(dir, "scripts/performance/pgbench/common/cleanup.sql", "cleanup\n");
      const verdict = assertSourceBundleCommitted({
        repoRoot: dir,
        paths: [
          "scripts/performance/pgbench/common/seed.sql",
          "scripts/performance/pgbench/common/cleanup.sql",
        ],
      });
      assert.equal(verdict.ok, false);
      assert.ok(verdict.reasons.some((r) => r.startsWith(SOURCE_BUNDLE_UNTRACKED)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignored dynamic file fails", () => {
    const dir = initRepo();
    try {
      write(dir, ".gitignore", "*.sql\n");
      write(dir, "scripts/performance/pgbench/common/seed.sql", "seed\n");
      git(dir, ["add", "-A"]);
      git(dir, ["commit", "-m", "ignore"]);
      const verdict = assertSourceBundleCommitted({
        repoRoot: dir,
        paths: ["scripts/performance/pgbench/common/seed.sql"],
      });
      assert.equal(verdict.ok, false);
      assert.ok(verdict.reasons.some((r) => r.startsWith(SOURCE_BUNDLE_IGNORED)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dirty dynamic file fails", () => {
    const dir = initRepo();
    try {
      write(dir, "scripts/performance/pgbench/common/seed.sql", "seed-v1\n");
      git(dir, ["add", "-A"]);
      git(dir, ["commit", "-m", "seed"]);
      write(dir, "scripts/performance/pgbench/common/seed.sql", "seed-v2\n");
      const verdict = assertSourceBundleCommitted({
        repoRoot: dir,
        paths: ["scripts/performance/pgbench/common/seed.sql"],
      });
      assert.equal(verdict.ok, false);
      assert.ok(verdict.reasons.some((r) => r.startsWith(SOURCE_BUNDLE_DIRTY)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("committed clean files produce a bundle matching git show bytes", () => {
    const dir = initRepo();
    try {
      write(dir, "scripts/performance/pgbench/common/seed.sql", "seed\n");
      write(dir, "scripts/performance/pgbench/common/cleanup.sql", "cleanup\n");
      git(dir, ["add", "-A"]);
      git(dir, ["commit", "-m", "ok"]);
      const sha = git(dir, ["rev-parse", "HEAD"]);
      const bundle = buildSourceBundle({
        repoRoot: dir,
        gitSha: sha,
        workloadRevision: "test",
        requiredPaths: [
          "scripts/performance/pgbench/common/seed.sql",
          "scripts/performance/pgbench/common/cleanup.sql",
        ],
      });
      assert.equal(bundle.ok, true);
      assert.equal(bundle.file_count, 2);
      assert.ok(bundle.bundle_sha256);
      const committed = assertSourceBundleCommitted({
        repoRoot: dir,
        paths: bundle.files.map((f) => f.path),
      });
      assert.equal(committed.ok, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
