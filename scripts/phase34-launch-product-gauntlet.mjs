#!/usr/bin/env node
/**
 * Phase 34 — full end-to-end PRODUCT gauntlet launcher (scaffold).
 * Root: /tmp/phase34-product-gauntlet-v1
 * Requires frozen product canary PASS before --execute.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  buildInterleavedProductSchedule,
  validateProductSchedule,
  PRODUCT_SCALE,
} from './lib/phase34-product-schedule.mjs';
import {
  assertProductOutEligible,
  PRODUCT_GAUNTLET_ROOT,
  PRODUCT_CANARY_ROOT,
  PHASE33F_TARGET_FORBIDDEN,
} from './lib/phase34-product-ledgers.mjs';

function parseArgs(argv) {
  const opts = {
    out: PRODUCT_GAUNTLET_ROOT,
    canaryRoot: PRODUCT_CANARY_ROOT,
    seed: 'phase34-product-gauntlet-v1',
    drySchedule: false,
    execute: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--canary-root') opts.canaryRoot = argv[++i];
    else if (a === '--seed') opts.seed = argv[++i];
    else if (a === '--dry-schedule') opts.drySchedule = true;
    else if (a === '--execute') opts.execute = true;
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  assertProductOutEligible(opts.out);

  if (opts.execute) {
    const err = new Error(
      'full product gauntlet --execute gated until product canary FROZEN_PASS_EVIDENCE exists and v3 transport soak is frozen',
    );
    err.code = 'PHASE34_PRODUCT_EXECUTE_GATED';
    throw err;
  }

  const schedule = buildInterleavedProductSchedule({ scale: 'full', seed: opts.seed });
  const validation = validateProductSchedule(schedule);
  if (validation.status !== 'PASS') {
    const err = new Error('full product schedule validation failed');
    err.code = 'PHASE34_PRODUCT_SCHEDULE_BLOCKED';
    err.details = validation;
    throw err;
  }

  fs.mkdirSync(opts.out, { recursive: true });
  const { rows, ...meta } = schedule;
  fs.writeFileSync(
    path.join(opts.out, 'product-schedule.meta.json'),
    JSON.stringify({ ...meta, row_count: rows.length, canary_root: opts.canaryRoot }, null, 2) + '\n',
  );
  // Full 20k JSONL — schedule only, no execution
  const jsonl = path.join(opts.out, 'product-schedule.jsonl');
  const fd = fs.openSync(jsonl, 'w');
  for (const r of rows) {
    fs.writeSync(fd, `${JSON.stringify(r)}\n`);
  }
  fs.closeSync(fd);

  const summary = {
    phase: 34,
    kind: 'PRODUCT_GAUNTLET_FULL_SCAFFOLD',
    scope: 'END_TO_END_AI_PRODUCT_ACCEPTANCE',
    execution: 'NOT_EXECUTED',
    out: opts.out,
    schedule_sha256: schedule.schedule_sha256,
    logical_sessions: schedule.logical_sessions,
    CAPABILITY_SCHEDULING: schedule.CAPABILITY_SCHEDULING,
    multi_turn_sessions: schedule.multi_turn_sessions,
    scale: PRODUCT_SCALE.full,
    production: 'NOT APPROVED',
    phase33f_target: fs.existsSync(PHASE33F_TARGET_FORBIDDEN) ? 'PRESENT_ILLEGAL' : 'ABSENT',
    product_canary_root: opts.canaryRoot,
    product_canary_frozen_pass: fs.existsSync(path.join(opts.canaryRoot, 'FROZEN_PASS_EVIDENCE')),
  };
  fs.writeFileSync(path.join(opts.out, 'scaffold-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

try {
  main();
} catch (err) {
  console.error(JSON.stringify({ error: err.message, code: err.code, details: err.details }, null, 2));
  process.exit(1);
}
