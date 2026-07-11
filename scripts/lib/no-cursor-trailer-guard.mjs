/**
 * Reject Cursor/CursorAgent commit trailers in git history (read-only).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const TRAILER_RE = /^(?:co-authored-by|signed-off-by|reviewed-by|assisted-by):\s*.*(?:cursoragent@cursor\.com|\bcursor\b).*$/im;

export const TRAILER_KEYS = [
  'Co-authored-by',
  'Signed-off-by',
  'Reviewed-by',
  'Assisted-by',
];

export function findCursorTrailerLine(message) {
  const lines = String(message || '').split(/\r?\n/);
  for (const line of lines) {
    if (TRAILER_RE.test(line)) return line.trim();
  }
  return null;
}

export function listCommits(ref = 'HEAD') {
  const r = spawnSync('git', ['log', ref, '--format=%H%x00%B%x00'], {
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(r.stderr?.toString('utf8') || `git log failed for ${ref}`);
  }
  const parts = (r.stdout || Buffer.alloc(0)).toString('latin1').split('\x00');
  const commits = [];
  for (let i = 0; i < parts.length - 1; i += 2) {
    const sha = parts[i].trim();
    const body = parts[i + 1];
    if (!sha) continue;
    commits.push({ sha, body });
  }
  return commits;
}

/**
 * @param {{ ref?: string }} [opts]
 */
export function auditGitHistory(opts = {}) {
  const ref = opts.ref || 'HEAD';
  const violations = [];

  for (const { sha, body } of listCommits(ref)) {
    const line = findCursorTrailerLine(body);
    if (line) violations.push({ sha, line, ref });
  }

  return {
    ref,
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    violations,
    policy: 'strict-all-commits',
  };
}

export function evaluateNoCursorTrailerGuard(opts = {}) {
  const report = auditGitHistory(opts);
  return {
    guard: 'no-cursor-trailer',
    status: report.status,
    ref: report.ref,
    violations: report.violations,
    policy: report.policy,
  };
}
