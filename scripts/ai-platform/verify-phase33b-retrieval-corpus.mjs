#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePhase33bRetrievalCorpus } from '../lib/phase33b-retrieval-corpus.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const report = validatePhase33bRetrievalCorpus(REPO_ROOT);
for (const d of report.diagnostics || []) {
  console.error(d);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.status === 'PASS' ? 0 : 2);
