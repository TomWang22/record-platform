/**
 * Reject duplicate screenshots masquerading as distinct states/turns.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

export const DUPLICATE_SCREENSHOT_MASQUERADING_AS_DISTINCT_STATE =
  'DUPLICATE_SCREENSHOT_MASQUERADING_AS_DISTINCT_STATE';

/**
 * @param {Array<{ path: string, label?: string, turn_index?: number, state_id?: string, allow_duplicate?: boolean }>} rows
 * @param {{ maxExactDuplicates?: number }} [opts]
 */
export function assertScreenshotDistinctness(rows, opts = {}) {
  const maxExactDuplicates = opts.maxExactDuplicates ?? 1;
  const byHash = new Map();
  const issues = [];

  for (const row of rows) {
    if (!row?.path || !fs.existsSync(row.path)) {
      issues.push({ code: 'screenshot_missing', path: row?.path });
      continue;
    }
    const buf = fs.readFileSync(row.path);
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    row.sha256 = sha256;
    const prior = byHash.get(sha256) || [];
    prior.push(row);
    byHash.set(sha256, prior);
  }

  let exactDuplicateGroups = 0;
  for (const [sha, group] of byHash.entries()) {
    if (group.length < 2) continue;
    const allAllowed = group.every((r) => r.allow_duplicate === true);
    if (allAllowed) continue;
    exactDuplicateGroups += 1;
    const labels = group.map((r) => r.label || r.state_id || r.path).join(' | ');
    if (exactDuplicateGroups > maxExactDuplicates || !group.some((r) => r.allow_duplicate)) {
      issues.push({
        code: DUPLICATE_SCREENSHOT_MASQUERADING_AS_DISTINCT_STATE,
        sha256: sha,
        count: group.length,
        labels,
      });
    }
  }

  if (issues.length) {
    const first = issues[0];
    const err = new Error(
      `${first.code}: ${first.labels || first.path || 'duplicate or missing screenshot'}`,
    );
    err.code = first.code;
    err.issues = issues;
    throw err;
  }

  return {
    ok: true,
    unique_sha256: byHash.size,
    rows: rows.length,
  };
}

/**
 * Pairwise require different hashes for ordered turn/state screenshots.
 */
export function assertTurnScreenshotsDistinct(paths) {
  const rows = paths.map((path, i) => ({
    path,
    label: `turn_${i + 1}`,
    turn_index: i,
  }));
  return assertScreenshotDistinctness(rows, { maxExactDuplicates: 0 });
}
