#!/usr/bin/env node
/**
 * Phase 34 — end-to-end PRODUCT canary launcher.
 *
 * --dry-schedule / --fixture-smoke: offline executable path (safe while v3 runs)
 * --execute: GATED until v3 freeze + commit + CI approval (refuses for now)
 *
 * Never writes /tmp/phase34-product-gauntlet-canary-v1 unless --out points there
 * AND execute is authorized. Default fixture smoke uses scaffold out.
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
  PRODUCT_CANARY_ROOT,
  PHASE33F_TARGET_FORBIDDEN,
} from './lib/phase34-product-ledgers.mjs';
import {
  runProductSessionBatch,
  ProductFailClosedGate,
  ProductLedgerWriter,
} from './lib/phase34-product-session-runner.mjs';
import {
  buildProductCapacityPlan,
  writeCapacityPlan,
  pinExecutionConfig,
} from './lib/phase34-product-execution.mjs';
import { listJourneyAdapters } from './lib/phase34-product-journeys/adapters.mjs';
import { transportSoakTerminalPhrase } from './lib/phase34-product-journey-protocol-link.mjs';

function parseArgs(argv) {
  const opts = {
    out: '/tmp/phase34-product-gauntlet-scaffold/canary-fixture',
    seed: 'phase34-product-canary-v1',
    drySchedule: false,
    fixtureSmoke: false,
    fixtureLimit: 8,
    execute: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--seed') opts.seed = argv[++i];
    else if (a === '--dry-schedule') opts.drySchedule = true;
    else if (a === '--fixture-smoke') opts.fixtureSmoke = true;
    else if (a === '--fixture-limit') opts.fixtureLimit = Number(argv[++i]);
    else if (a === '--execute') opts.execute = true;
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  assertProductOutEligible(opts.out);

  if (opts.execute) {
    const err = new Error(
      'live product canary --execute gated until transport soak-v3 freezes, scratch is committed, exact-SHA CI + approval',
    );
    err.code = 'PHASE34_PRODUCT_EXECUTE_GATED';
    throw err;
  }

  if (opts.out === PRODUCT_CANARY_ROOT) {
    const err = new Error(
      'refusing to populate official canary root before authorization; use scaffold out',
    );
    err.code = 'PHASE34_PRODUCT_OFFICIAL_ROOT_GATED';
    throw err;
  }

  const schedule = buildInterleavedProductSchedule({ scale: 'canary', seed: opts.seed });
  const validation = validateProductSchedule(schedule);
  if (validation.status !== 'PASS') {
    const err = new Error('schedule validation failed');
    err.code = 'PHASE34_PRODUCT_SCHEDULE_BLOCKED';
    err.details = validation;
    throw err;
  }

  fs.mkdirSync(opts.out, { recursive: true });
  const { rows, ...meta } = schedule;
  fs.writeFileSync(path.join(opts.out, 'product-schedule.json'), JSON.stringify({ ...meta, row_count: rows.length }, null, 2) + '\n');
  fs.writeFileSync(path.join(opts.out, 'product-schedule.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const plan = buildProductCapacityPlan({
    logicalSessions: PRODUCT_SCALE.canary.logicalSessions,
    multiTurnSessions: PRODUCT_SCALE.canary.minMultiTurnSessions,
    avgMultiTurns: 4,
  });
  writeCapacityPlan(opts.out, plan);

  const adapters = listJourneyAdapters().map((a) => a.capability);
  let smoke = null;
  if (opts.fixtureSmoke || opts.drySchedule) {
    const ledger = new ProductLedgerWriter(opts.out).ensure();
    const gate = new ProductFailClosedGate();
    // one session per capability for smoke
    const sample = [];
    for (const cap of adapters) {
      const row = rows.find((r) => r.capability === cap);
      if (row) sample.push(row);
    }
    const multi = rows.find((r) => r.multi_turn_class === 'multi_4_12');
    if (multi) sample.push(multi);
    smoke = await runProductSessionBatch(sample.slice(0, opts.fixtureLimit), {
      fixtureMode: true,
      gate,
      ledger,
    });
  }

  const summary = {
    phase: 34,
    kind: 'PRODUCT_GAUNTLET_CANARY_EXECUTABLE_FIXTURE',
    scope: 'END_TO_END_AI_PRODUCT_ACCEPTANCE',
    execution: smoke ? 'FIXTURE_SMOKE' : 'SCHEDULE_ONLY',
    live_execute: 'NOT_LAUNCHED',
    out: opts.out,
    schedule_sha256: schedule.schedule_sha256,
    logical_sessions: schedule.logical_sessions,
    CAPABILITY_SCHEDULING: schedule.CAPABILITY_SCHEDULING,
    adapters,
    fixture_smoke: smoke
      ? {
          sessions: smoke.results.length,
          pass: smoke.results.filter((r) => r.session.session_outcome === 'PASS').length,
          gate: smoke.gate,
          next_session_started_after_hard_failure: smoke.next_session_started_after_hard_failure,
        }
      : null,
    capacity_plan: plan,
    pin_example: pinExecutionConfig({
      prompt_configuration_id: 'scarcity-c01',
      prompt_hash: 'x',
      system_prompt_hash: 'y',
      model_tier: 'deterministic',
      model_identifier: 'det',
      model_configuration_hash: 'z',
      retrieval_mode_requested: 'keyword',
      retrieval_mode_executed: 'keyword',
      retrieval_configuration_hash: 'r',
      reranker_version: 'rerank-v1',
      tool_configuration_hash: 't',
      embedding_version: 'emb-v1',
      schema_version: 'phase34-intelligence-v1',
      runtime_image_pin: 'offline',
      certificate_pin: 'offline',
    }).pin_status,
    production: 'NOT APPROVED',
    phase33f_target: fs.existsSync(PHASE33F_TARGET_FORBIDDEN) ? 'PRESENT_ILLEGAL' : 'ABSENT',
    transport_soak_note: transportSoakTerminalPhrase(true),
  };
  fs.writeFileSync(path.join(opts.out, 'executable-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message, code: err.code, details: err.details }, null, 2));
  process.exit(1);
});
