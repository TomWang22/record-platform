#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCanaryManifest, validateManifestRows, writeManifest } from '../lib/phase33f-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'phase33f-capability-gauntlet-manifest.json');

const rows = buildCanaryManifest({ batchesPerCapability: 30 });
const validation = validateManifestRows(rows);
const body = writeManifest(OUT, rows);
process.stdout.write(
  `${JSON.stringify(
    {
      status: validation.status,
      out: OUT,
      manifest_sha: body.manifest_sha,
      summary: validation.summary,
      violations: validation.violations,
    },
    null,
    2,
  )}\n`,
);
process.exit(validation.status === 'PASS' ? 0 : 2);
