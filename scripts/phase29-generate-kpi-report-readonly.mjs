#!/usr/bin/env node
/** Generate /tmp Phase 29 combined KPI report from local/dev DB rows. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] || '/tmp/phase29-kpi-report';

const result = spawnSync(
  'node',
  [path.join(repoRoot, 'scripts/phase26f-combined-kpi-report-readonly.mjs'), '--out', outDir],
  { cwd: repoRoot, encoding: 'utf8' },
);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
