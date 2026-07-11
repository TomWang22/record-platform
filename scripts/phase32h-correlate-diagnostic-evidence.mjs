#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { loadShardRows } from './lib/phase32h-targeted-summary.mjs';
import { writeCorrelationArtifacts } from './lib/phase32h-diagnostic-correlation.mjs';
import { resolvePhase32hRoot } from './lib/phase32h-targeted-reproduction-config.mjs';

function parseArgs(argv) {
  const opts = { in: resolvePhase32hRoot() };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--in') opts.in = argv[++i];
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const rows = loadShardRows(opts.in);
  let captureStatus = { pcap: 'PARTIAL', gateway: 'PARTIAL', application: 'PARTIAL' };
  const pcapStatusPath = path.join(opts.in, 'pcap', 'capture-status.json');
  if (fs.existsSync(pcapStatusPath)) {
    captureStatus = { ...captureStatus, ...JSON.parse(fs.readFileSync(pcapStatusPath, 'utf8')) };
  }
  const { verdict, paths } = writeCorrelationArtifacts(opts.in, rows, captureStatus);
  const reportPath = path.join(opts.in, 'phase32h-final-report.md');
  fs.writeFileSync(
    reportPath,
    `# Phase 32H Targeted Reproduction Correlation\n\nVerdict: ${verdict.verdict_label}\nExtremes: ${verdict.extreme_count}\n`,
  );
  console.log(JSON.stringify({ verdict, paths, reportPath }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
