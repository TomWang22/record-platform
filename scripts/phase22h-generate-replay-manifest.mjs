#!/usr/bin/env node
/**
 * Phase 22H — generate full 57105-row Phase 21 replay manifest (local only).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  BATCHES,
  DEFAULTS,
  REPO_ROOT,
  batchProbeCount,
  expandManifestRows,
  gitSha,
  sha256File,
} from './lib/phase22-full-replay-common.mjs';

const OUT_DIR = path.join(REPO_ROOT, 'bench_logs/ai-platform/phase22/full-replay');
const JSONL = path.join(OUT_DIR, 'phase22-full-57105-manifest.jsonl');
const SUMMARY = path.join(OUT_DIR, 'phase22-full-57105-manifest-summary.json');

function main() {
  const artifactSha = sha256File(DEFAULTS.artifactPath);
  if (artifactSha !== DEFAULTS.expectedArtifactSha) {
    console.error(`BLOCKED: artifact SHA mismatch ${artifactSha}`);
    process.exit(2);
  }

  const rows = expandManifestRows();
  const batchCounts = Object.fromEntries(BATCHES.map((b) => [b.id, batchProbeCount(b)]));
  const sum = rows.length;

  if (sum !== DEFAULTS.manifestTarget) {
    console.error(`BLOCKED: manifest row count ${sum} != ${DEFAULTS.manifestTarget}`);
    process.exit(2);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(JSONL, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);

  const summary = {
    phase: '22H',
    generated_at: new Date().toISOString(),
    git_sha: gitSha(),
    artifact_sha: artifactSha,
    row_count: sum,
    expected_row_count: DEFAULTS.manifestTarget,
    batch_count: BATCHES.length,
    cases_per_run: 9,
    batch_probe_counts: batchCounts,
    batch_probe_sum: Object.values(batchCounts).reduce((a, b) => a + b, 0),
    early_segment_batches: ['T20.16D', 'T20.17C', 'T20.18C', 'T20.19C', 'T20.20C', 'T20.21B'],
    early_segment_probes: ['T20.16D', 'T20.17C', 'T20.18C', 'T20.19C', 'T20.20C', 'T20.21B'].reduce(
      (acc, id) => acc + batchCounts[id],
      0,
    ),
    early_adapter: 'early-equivalence: contract allowlist + staging preview_opt_in via enroll (no permanent allowlist broadening)',
    status: sum === DEFAULTS.manifestTarget ? 'PASS' : 'BLOCKED',
  };

  fs.writeFileSync(SUMMARY, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ jsonl: JSONL, summary: SUMMARY, ...summary }, null, 2));
  process.exit(summary.status === 'PASS' ? 0 : 2);
}

main();
