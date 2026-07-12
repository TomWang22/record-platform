/**
 * Reject Cursor/CursorAgent commit attribution in git history (read-only).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findCursorTrailerLine,
  findExactCursorCoauthorTrailerLine,
  findCursorIdentityViolations,
} from './no-cursor-attribution-policy.mjs';

export {
  findCursorTrailerLine,
  findExactCursorCoauthorTrailerLine,
  findCursorIdentityViolations,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

export const TRAILER_KEYS = [
  'Co-authored-by',
  'Signed-off-by',
  'Reviewed-by',
  'Assisted-by',
];

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

export function listAllCommits() {
  const r = spawnSync(
    'git',
    ['log', '--all', '--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x00'],
    {
      cwd: REPO_ROOT,
      maxBuffer: 128 * 1024 * 1024,
    },
  );
  if (r.status !== 0) {
    throw new Error(r.stderr?.toString('utf8') || 'git log --all failed');
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

export function auditCommitRecords(commits, refLabel) {
  return auditCommits(commits, refLabel);
}

export function auditGitHistory(opts = {}) {
  const ref = opts.ref || 'HEAD';
  return auditCommits(listCommits(ref), ref);
}

export function auditGitPushRange(opts) {
  const { range } = opts;
  if (!range || !range.includes('..')) {
    throw new Error(`invalid git range: ${range}`);
  }
  return auditCommits(listCommitsInRange(range), range);
}

export function auditAllRefs() {
  return auditCommits(listAllCommits(), '--all');
}

function gitText(args) {
  const r = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(r.stderr || `git ${args.join(' ')} failed`);
  }
  return r.stdout.trim();
}

export function countRetainedRefs() {
  const branches = gitText(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']).split('\n').filter(Boolean);
  const tags = gitText(['for-each-ref', '--format=%(refname)', 'refs/tags']).split('\n').filter(Boolean);
  return { branches: branches.length, tags: tags.length, branch_names: branches, tag_names: tags };
}

export function isShallowRepository() {
  return gitText(['rev-parse', '--is-shallow-repository']) === 'true';
}

export function buildDetailedGuardReport() {
  const shallow = isShallowRepository();
  const retained = countRetainedRefs();
  const main = auditGitHistory({ ref: 'origin/main' });
  const all = auditAllRefs();

  const authorsRejected = [...main.violations, ...all.violations].filter(
    (v) => v.kind === 'identity' && v.field.includes('author'),
  ).length;
  const committersRejected = [...main.violations, ...all.violations].filter(
    (v) => v.kind === 'identity' && v.field.includes('committer'),
  ).length;
  const trailersRejected = [...main.violations, ...all.violations].filter(
    (v) => v.kind === 'trailer',
  ).length;

  const status =
    shallow || main.status !== 'PASS' || all.status !== 'PASS' ? 'FAIL' : 'PASS';

  return {
    guard: 'no-cursor-attribution',
    status,
    policy: 'strict-no-cursor-attribution',
    shallow_repository: shallow,
    origin_main_commits_scanned: main.commits_scanned,
    all_retained_commits_scanned: all.commits_scanned,
    retained_branches_scanned: retained.branches,
    retained_tags_scanned: retained.tags,
    authors_rejected: authorsRejected,
    committers_rejected: committersRejected,
    trailers_rejected: trailersRejected,
    origin_main: main,
    all_retained: all,
  };
}

export function evaluateNoCursorTrailerGuard(opts = {}) {
  if (opts.detailed) {
    return buildDetailedGuardReport();
  }

  if (opts.includeAllRefs) {
    const report = auditAllRefs();
    return {
      guard: 'no-cursor-attribution',
      status: report.status,
      ref: report.ref,
      commits_scanned: report.commits_scanned,
      violations: report.violations,
      policy: report.policy,
    };
  }

  const ref = opts.ref || 'origin/main';
  const report = opts.range
    ? auditGitPushRange({ range: opts.range })
    : auditGitHistory({ ref });

  return {
    guard: 'no-cursor-attribution',
    status: report.status,
    violations: report.violations,
    ref: report.ref,
    commits_scanned: report.commits_scanned,
    policy: report.policy,
  };
}
