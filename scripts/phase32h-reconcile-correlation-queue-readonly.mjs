#!/usr/bin/env node
/**
 * Read-only classification of legacy correlation backlog fixtures (e.g. frozen baseline-r3).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyLegacyBacklogFixture,
  legacyCorrelationBacklogPath,
  readCorrelationBacklog,
} from './lib/phase32h-correlation-queue.mjs';
import { batchIndexDir } from './lib/phase32h-batch-packet-index.mjs';
import { probeIndexDir } from './lib/phase32h-probe-packet-index.mjs';

function parseArgs(argv) {
  const opts = { out: '/tmp/phase32h-r1-baseline-r3' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
  }
  return opts;
}

function countIndexes(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const legacy = readCorrelationBacklog(opts.out);
  const report = classifyLegacyBacklogFixture({
    outRoot: opts.out,
    legacyBacklog: legacy,
    probeIndexCount: countIndexes(probeIndexDir(opts.out)),
    batchIndexCount: countIndexes(batchIndexDir(opts.out)),
  });
  report.legacy_backlog_path = legacyCorrelationBacklogPath(opts.out);
  console.log(JSON.stringify(report, null, 2));
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return (
      fs.realpathSync(fileURLToPath(import.meta.url)) ===
      fs.realpathSync(path.resolve(process.argv[1]))
    );
  } catch {
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  }
}

if (isMainModule()) main();
