/**
 * Canonical enumerator/hasher for files that can affect a Gate-3 cell after matrix startup.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const SOURCE_BUNDLE_SCHEMA = "record-platform-pgbench-source-bundle/v1";
export const SOURCE_BUNDLE_MISSING = "SOURCE_BUNDLE_MISSING";
export const SOURCE_BUNDLE_UNTRACKED = "SOURCE_BUNDLE_UNTRACKED";
export const SOURCE_BUNDLE_IGNORED = "SOURCE_BUNDLE_IGNORED";
export const SOURCE_BUNDLE_DIRTY = "SOURCE_BUNDLE_DIRTY";
export const SOURCE_BUNDLE_GIT_MISMATCH = "SOURCE_BUNDLE_GIT_MISMATCH";

export const PREPARED_SOURCE_PATHS = [
  "reports/performance/outbox-publisher-parity.PREPARED.json",
  "reports/performance/end-harness.PREPARED.json",
];

function gitEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

function runGit(repoRoot, args) {
  return spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", env: gitEnv() });
}

function runGitBytes(repoRoot, args) {
  return spawnSync("git", ["-C", repoRoot, ...args], { encoding: "buffer", env: gitEnv() });
}

function sha256Bytes(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function walkSqlAndJson(dir, relBase, acc) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = `${relBase}/${name}`.replace(/\\/g, "/");
    const st = statSync(abs);
    if (st.isDirectory()) walkSqlAndJson(abs, rel, acc);
    else if (name.endsWith(".sql") || name.endsWith(".json")) acc.push(rel);
  }
}

/**
 * Complete set of dynamically-read benchmark artifacts (post-startup).
 * @param {string} repoRoot
 */
export function listDynamicSourcePaths(repoRoot) {
  /** @type {string[]} */
  const paths = [];
  walkSqlAndJson(join(repoRoot, "scripts/performance/pgbench"), "scripts/performance/pgbench", paths);
  for (const p of PREPARED_SOURCE_PATHS) {
    if (!paths.includes(p)) paths.push(p);
  }
  return [...new Set(paths)].sort();
}

/**
 * Deterministic bundle SHA: sorted path + NUL + sha256 + newline.
 * @param {{ path: string, sha256: string }[]} files
 */
export function computeBundleSha256(files) {
  const sorted = [...(files || [])].sort((a, b) => String(a.path).localeCompare(String(b.path)));
  const payload = sorted.map((f) => `${f.path}\0${f.sha256}\n`).join("");
  return sha256Bytes(payload);
}

function gitCheckIgnore(repoRoot, rel) {
  const r = runGit(repoRoot, ["check-ignore", "-q", rel]);
  return r.status === 0;
}

function gitTracked(repoRoot, rel) {
  const r = runGit(repoRoot, ["ls-files", "--error-unmatch", "--", rel]);
  return r.status === 0;
}

function gitDirty(repoRoot, rel) {
  const unstaged = runGit(repoRoot, ["diff", "--name-only", "--", rel]);
  const staged = runGit(repoRoot, ["diff", "--name-only", "--cached", "--", rel]);
  const names = `${unstaged.stdout || ""}\n${staged.stdout || ""}`;
  return names.split("\n").map((s) => s.trim()).filter(Boolean).includes(rel);
}

function gitUntracked(repoRoot, rel) {
  if (gitTracked(repoRoot, rel)) return false;
  if (!existsSync(join(repoRoot, rel))) return false;
  return true;
}

/**
 * @param {{ repoRoot: string, paths: string[] }} opts
 */
export function assertSourceBundleCommitted(opts) {
  const repoRoot = opts.repoRoot;
  const paths = opts.paths || [];
  /** @type {string[]} */
  const reasons = [];
  for (const rel of paths) {
    const abs = join(repoRoot, rel);
    if (!existsSync(abs)) {
      reasons.push(`${SOURCE_BUNDLE_MISSING}:${rel}`);
      continue;
    }
    if (gitCheckIgnore(repoRoot, rel) && !gitTracked(repoRoot, rel)) {
      reasons.push(`${SOURCE_BUNDLE_IGNORED}:${rel}`);
      continue;
    }
    if (gitUntracked(repoRoot, rel)) {
      reasons.push(`${SOURCE_BUNDLE_UNTRACKED}:${rel}`);
      continue;
    }
    if (gitDirty(repoRoot, rel)) {
      reasons.push(`${SOURCE_BUNDLE_DIRTY}:${rel}`);
      continue;
    }
    const shown = runGitBytes(repoRoot, ["show", `HEAD:${rel}`]);
    if (shown.status !== 0) {
      reasons.push(`${SOURCE_BUNDLE_UNTRACKED}:${rel}`);
      continue;
    }
    const live = readFileSync(abs);
    if (sha256Bytes(live) !== sha256Bytes(shown.stdout)) {
      reasons.push(`${SOURCE_BUNDLE_GIT_MISMATCH}:${rel}`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * @param {{
 *   repoRoot: string,
 *   gitSha?: string,
 *   workloadRevision?: string,
 *   requiredPaths?: string[],
 * }} opts
 */
export function buildSourceBundle(opts) {
  const repoRoot = opts.repoRoot;
  const required = opts.requiredPaths?.length
    ? [...opts.requiredPaths].sort()
    : listDynamicSourcePaths(repoRoot);
  /** @type {string[]} */
  const reasons = [];
  /** @type {{ path: string, sha256: string }[]} */
  const files = [];
  for (const rel of required) {
    const abs = join(repoRoot, rel);
    if (!existsSync(abs)) {
      reasons.push(`${SOURCE_BUNDLE_MISSING}:${rel}`);
      continue;
    }
    files.push({ path: rel, sha256: sha256Bytes(readFileSync(abs)) });
  }
  const committed = assertSourceBundleCommitted({ repoRoot, paths: required.filter((p) => existsSync(join(repoRoot, p))) });
  if (!committed.ok) reasons.push(...committed.reasons);
  const ok = reasons.length === 0;
  return {
    schema: SOURCE_BUNDLE_SCHEMA,
    git_sha: opts.gitSha || null,
    workload_revision: opts.workloadRevision || null,
    files,
    file_count: files.length,
    bundle_sha256: files.length ? computeBundleSha256(files) : null,
    ok,
    reasons,
  };
}
