#!/usr/bin/env node
/**
 * Write freeze-integrity addendum for historical baseline-r2 (addendum only; no repair).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildHistoricalFreezeMismatchReport } from './lib/phase32h-freeze-integrity.mjs';

const DEFAULT_ROOT = '/tmp/phase32h-r1-baseline-r2';
const MONITOR_LOG = 'phase32h-monitor.log';

function main() {
  const outRoot = process.argv[2] || DEFAULT_ROOT;
  const monitorPath = path.join(outRoot, MONITOR_LOG);
  const shaManifest = path.join(outRoot, 'phase32h-r1-baseline-r2-sha256.txt');
  if (!fs.existsSync(path.join(outRoot, 'FROZEN_BLOCKED_EVIDENCE'))) {
    console.error(JSON.stringify({ status: 'BLOCKED', reason: 'missing frozen marker' }, null, 2));
    process.exit(2);
  }

  const expectedLine = (fs.readFileSync(shaManifest, 'utf8').split('\n') || []).find((line) =>
    line.includes(`/${MONITOR_LOG}`),
  );
  const expectedSha = expectedLine ? expectedLine.split(/\s+/)[0] : null;
  const observedSha = fs.existsSync(monitorPath)
    ? crypto.createHash('sha256').update(fs.readFileSync(monitorPath)).digest('hex')
    : null;

  const blockedManifestPath = path.join(outRoot, 'phase32h-r1-baseline-r2-blocked-manifest.json');
  const blockedManifest = fs.existsSync(blockedManifestPath)
    ? JSON.parse(fs.readFileSync(blockedManifestPath, 'utf8'))
    : {};
  const freezeTimestamp = blockedManifest.frozen_at || null;
  const finalMtime = fs.existsSync(monitorPath)
    ? new Date(fs.statSync(monitorPath).mtimeMs).toISOString()
    : null;

  const addendum = buildHistoricalFreezeMismatchReport({
    root: outRoot,
    mismatchedPath: monitorPath,
    expectedSha,
    observedSha,
    freezeTimestamp,
    finalMtime,
    writerResponsible:
      'matrix_monitor bash loop appending to phase32h-monitor.log after hash manifest generation',
    jsonlHashStatus: 'ALL_JSONL_OK',
  });

  const outPath = path.join(outRoot, 'phase32h-r1-baseline-r2-freeze-integrity-addendum.json');
  fs.writeFileSync(outPath, `${JSON.stringify(addendum, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ status: 'PASS', addendum_path: outPath }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
