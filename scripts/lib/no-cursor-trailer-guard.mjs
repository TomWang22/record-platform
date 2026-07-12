/**
 * Reject Cursor/CursorAgent commit attribution in git history (read-only).
 * Covers commit-message trailers and author/committer identity metadata.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const TRAILER_RE =
  /^(?:co-authored-by|signed-off-by|reviewed-by|assisted-by):\s*.*(?:cursoragent@cursor\.com|\bcursor\b).*$/im;

const FORBIDDEN_IDENTITY_TOKENS = ['cursor', 'cursoragent', 'cursor.com'];

export const TRAILER_KEYS = [
  'Co-authored-by',
  'Signed-off-by',
  'Reviewed-by',
  'Assisted-by',
];

function containsForbiddenIdentity(value) {
  const normalized = String(value || '').toLowerCase();
  return FORBIDDEN_IDENTITY_TOKENS.some((token) => normalized.includes(token));
}

export function findCursorTrailerLine(message) {
  const lines = String(message || '').split(/\r?\n/);
  for (const line of lines) {
    if (TRAILER_RE.test(line)) return line.trim();
  }
  return null;
}

export function findCursorIdentityViolations(commit) {
  const violations = [];
  const fields = [
    ['author_name', commit.authorName],
    ['author_email', commit.authorEmail],
    ['committer_name', commit.committerName],
    ['committer_email', commit.committerEmail],
  ];

  for (const [field, value] of fields) {
    if (containsForbiddenIdentity(value)) {
      violations.push({ field, value: String(value) });
    }
  }

  return violations;
}

function parseCommitRecords(stdout) {
  const parts = (stdout || Buffer.alloc(0)).toString('latin1').split('\x00');
  const commits = [];

  for (let i = 0; i < parts.length - 5; i += 6) {
    const sha = parts[i].trim();
    const authorName = parts[i + 1];
    const authorEmail = parts[i + 2];
    const committerName = parts[i + 3];
    const committerEmail = parts[i + 4];
    const body = parts[i + 5];
    if (!sha) continue;
    commits.push({
      sha,
      authorName,
      authorEmail,
      committerName,
      committerEmail,
      body,
    });
  }

  return commits;
}

export function listCommits(ref = 'HEAD') {
  const r = spawnSync(
    'git',
    ['log', ref, '--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x00'],
    {
      cwd: REPO_ROOT,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (r.status !== 0) {
    throw new Error(r.stderr?.toString('utf8') || `git log failed for ${ref}`);
  }
  return parseCommitRecords(r.stdout);
}

export function listCommitsInRange(range) {
  const r = spawnSync(
    'git',
    ['log', range, '--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x00'],
    {
      cwd: REPO_ROOT,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (r.status !== 0) {
    throw new Error(r.stderr?.toString('utf8') || `git log failed for ${range}`);
  }
  return parseCommitRecords(r.stdout);
}

function auditCommits(commits, refLabel) {
  const violations = [];

  for (const commit of commits) {
    const trailerLine = findCursorTrailerLine(commit.body);
    if (trailerLine) {
      violations.push({
        sha: commit.sha,
        kind: 'trailer',
        field: 'message',
        value: trailerLine,
        ref: refLabel,
      });
    }

    for (const identityViolation of findCursorIdentityViolations(commit)) {
      violations.push({
        sha: commit.sha,
        kind: 'identity',
        field: identityViolation.field,
        value: identityViolation.value,
        ref: refLabel,
      });
    }
  }

  return {
    ref: refLabel,
    commits_scanned: commits.length,
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    violations,
    policy: 'strict-no-cursor-attribution',
  };
}

/**
 * @param {{ ref?: string }} [opts]
 */
export function auditGitHistory(opts = {}) {
  const ref = opts.ref || 'HEAD';
  return auditCommits(listCommits(ref), ref);
}

/**
 * @param {{ range: string }} opts
 */
export function auditGitPushRange(opts) {
  const { range } = opts;
  if (!range || !range.includes('..')) {
    throw new Error(`invalid git range: ${range}`);
  }
  return auditCommits(listCommitsInRange(range), range);
}

/**
 * @param {{ ref?: string, range?: string }} [opts]
 */
export function evaluateNoCursorTrailerGuard(opts = {}) {
  const report = opts.range
    ? auditGitPushRange({ range: opts.range })
    : auditGitHistory({ ref: opts.ref || 'HEAD' });

  return {
    guard: 'no-cursor-attribution',
    status: report.status,
    ref: report.ref,
    commits_scanned: report.commits_scanned,
    violations: report.violations,
    policy: report.policy,
  };
}
