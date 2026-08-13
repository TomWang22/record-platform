/**
 * Isolated Gate-3 source revision freeze.
 * Provisioning must refuse unless HEAD matches the manifest git_sha and
 * benchmark-relevant trees are clean. reports/performance/pgbench/ is excluded.
 */
import { spawnSync } from "node:child_process";

export const ISOLATED_SOURCE_MISMATCH_PREFIX = "ISOLATED_SOURCE_REVISION_MISMATCH";
export const ISOLATED_SOURCE_NOT_FROZEN = "ISOLATED_SOURCE_REVISION_NOT_FROZEN";

const SCOPED_PATHS = ["scripts/lib", "scripts/performance", "tests"];

/**
 * @param {string} relPath
 */
export function isIsolatedBenchmarkSourcePath(relPath) {
  const p = String(relPath || "").replace(/^\.\//, "").replace(/\\/g, "/");
  if (p.startsWith("reports/performance/pgbench/")) return false;
  if (p.startsWith("tests/pgbench-")) return true;
  if (p.startsWith("scripts/lib/pgbench_")) return true;
  if (p.startsWith("scripts/performance/launch-isolated-")) return true;
  if (p.startsWith("scripts/performance/gate3-isolated-")) return true;
  if (p.startsWith("scripts/performance/supervise-pgbench")) return true;
  if (p.startsWith("scripts/performance/watch-pgbench")) return true;
  if (p.startsWith("scripts/performance/generate-pgbench")) return true;
  if (p.startsWith("scripts/performance/report-pgbench")) return true;
  if (p.startsWith("scripts/performance/merge-pgbench")) return true;
  if (p.startsWith("scripts/performance/run-pgbench")) return true;
  if (/^scripts\/performance\/.*pgbench/.test(p)) return true;
  return false;
}

function runGit(repoRoot, args) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  const r = spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8", env });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "git failed").trim();
    throw new Error(err || "git failed");
  }
  return String(r.stdout || "").trim();
}

/**
 * @param {{
 *   expectedGitSha?: string | null,
 *   repoRoot: string,
 * }} opts
 */
export function assertIsolatedSourceRevision(opts) {
  const expected = opts?.expectedGitSha;
  const repoRoot = opts?.repoRoot;
  if (!expected) {
    return { ok: false, head: null, reasons: [ISOLATED_SOURCE_NOT_FROZEN] };
  }
  let head;
  try {
    head = runGit(repoRoot, ["rev-parse", "HEAD"]);
  } catch (err) {
    return {
      ok: false,
      head: null,
      reasons: [`${ISOLATED_SOURCE_MISMATCH_PREFIX} git: ${err.message}`],
    };
  }
  /** @type {string[]} */
  const reasons = [];
  if (head !== expected) {
    reasons.push(`${ISOLATED_SOURCE_MISMATCH_PREFIX} HEAD=${head} expected=${expected}`);
  }
  const dirtySet = new Set();
  try {
    const changed = runGit(repoRoot, ["diff", "--name-only", "HEAD", "--", ...SCOPED_PATHS]);
    const unstaged = runGit(repoRoot, ["diff", "--name-only", "--", ...SCOPED_PATHS]);
    const staged = runGit(repoRoot, ["diff", "--name-only", "--cached", "--", ...SCOPED_PATHS]);
    const untracked = runGit(repoRoot, ["ls-files", "--others", "--exclude-standard", "--", ...SCOPED_PATHS]);
    for (const block of [changed, unstaged, staged, untracked]) {
      for (const line of String(block || "").split("\n")) {
        if (line.trim()) dirtySet.add(line.trim());
      }
    }
  } catch (err) {
    reasons.push(`${ISOLATED_SOURCE_MISMATCH_PREFIX} git-status: ${err.message}`);
    return { ok: false, head, reasons };
  }
  const dirty = [...dirtySet].filter(isIsolatedBenchmarkSourcePath);
  for (const p of dirty) {
    reasons.push(`${ISOLATED_SOURCE_MISMATCH_PREFIX} dirty ${p}`);
  }
  return { ok: reasons.length === 0, head, reasons };
}
