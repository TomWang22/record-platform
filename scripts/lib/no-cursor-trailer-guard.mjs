/**
 * Reject Cursor/CursorAgent commit trailers in git history (read-only).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

const GRANDFATHER_SHAS = [
  '22b12aecbc330038cf3deb4d893d7c004b3fb6ee',
  'c48e8d5fe95b90a4f094bbc077f8b29b7ad98664',
  'b5cf8a2ec1b0402a65daccebc2f6c4b8aeb9a881',
  '6aeedcb104ee86efac2956f53beebbe85dab218e',
  '9e02e08bd0f901a20dafd8110b6080a3ab7e7e7a',
  '8a19b7b918e7847616fc532721275a8b04ebe20a',
  'fa95fe9ff9e695c26a2662e71f37c5fd673c2a9a',
  'ec348531c970b5be950ad3ccaba84c74566853d2',
  'a6c2a7ef9d4dec9ab69866c60a97e2d4038e3dc5',
  '126bfa6078054e2933b343acd46fdd20085afdb1',
  'e25992efd8871f20989c1692c592ed848089acd0',
];

export function loadGrandfatherShas() {
  if (optsFromEnvGrandfather()) return optsFromEnvGrandfather();
  return new Set(GRANDFATHER_SHAS);
}

function optsFromEnvGrandfather() {
  const path = process.env.NO_CURSOR_TRAILER_GRANDFATHER_FILE;
  if (!path || !fs.existsSync(path)) return null;
  const data = JSON.parse(fs.readFileSync(path, 'utf8'));
  return new Set(Array.isArray(data.grandfathered_shas) ? data.grandfathered_shas : []);
}

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
 * @param {{ ref?: string, grandfather?: Set<string>, strict?: boolean }} [opts]
 */
export function auditGitHistory(opts = {}) {
  const ref = opts.ref || 'HEAD';
  const grandfather = opts.grandfather ?? loadGrandfatherShas();
  const strict = opts.strict === true;
  const violations = [];
  const grandfathered = [];

  for (const { sha, body } of listCommits(ref)) {
    const line = findCursorTrailerLine(body);
    if (!line) continue;
    if (!strict && grandfather.has(sha)) {
      grandfathered.push({ sha, line });
      continue;
    }
    violations.push({ sha, line, ref });
  }

  return {
    ref,
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    violations,
    grandfathered_count: grandfathered.length,
    grandfathered,
    strict,
  };
}

export function evaluateNoCursorTrailerGuard(opts = {}) {
  const report = auditGitHistory(opts);
  return {
    guard: 'no-cursor-trailer',
    status: report.status,
    ref: report.ref,
    violations: report.violations,
    grandfathered_count: report.grandfathered_count,
    policy: report.strict
      ? 'strict-all-commits'
      : 'enforce-after-grandfather',
  };
}
