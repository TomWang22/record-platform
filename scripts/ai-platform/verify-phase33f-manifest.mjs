#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest, validateManifestRows } from '../lib/phase33f-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(__dirname, 'phase33f-capability-gauntlet-manifest.json');
const { rows, raw } = loadManifest(file);
const result = validateManifestRows(rows);
const out = {
  status: result.status,
  manifest_sha: raw.manifest_sha,
  summary: result.summary,
  violations: result.violations,
};
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
process.exit(result.status === 'PASS' ? 0 : 2);
