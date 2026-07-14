#!/usr/bin/env node
/**
 * Phase 32H — parse single-document monitor summary JSON (not JSONL).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSingleJsonDocument } from './lib/phase32h-json-document.mjs';

function parseArgs(argv) {
  const opts = { file: null, human: false, fields: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--file') opts.file = argv[++i];
    if (argv[i] === '--human') opts.human = true;
    if (argv[i] === '--fields') opts.fields = argv[++i];
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.file) {
    console.error('usage: phase32h-parse-summary-json.mjs --file <path> [--human] [--fields k1,k2]');
    process.exit(2);
  }
  const text = fs.readFileSync(path.resolve(opts.file), 'utf8');
  const summary = parseSingleJsonDocument(text, { source: opts.file });
  if (opts.human) {
    const total = summary.total ?? summary.probe_total ?? 0;
    const status = summary.status ?? 'IN_PROGRESS';
    const wrongGate = summary.wrong_gate ?? 0;
    const leakage = summary.leakage_failures ?? 0;
    const response = summary.response_pass_rate ?? 0;
    console.log(`monitor tick: total=${total} status=${status} wrong_gate=${wrongGate} leakage=${leakage} response=${response}`);
    return;
  }
  if (opts.fields) {
    const keys = opts.fields.split(',').map((k) => k.trim()).filter(Boolean);
    const out = {};
    for (const key of keys) out[key] = summary[key];
    console.log(JSON.stringify(out));
    return;
  }
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}

export { parseArgs };
