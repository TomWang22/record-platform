#!/usr/bin/env node
/**
 * Phase 34 — 24-scenario LIVE owner-proof rehearsal launcher.
 *
 * Root: /tmp/phase34-owner-proof-live-rehearsal-v1
 * Scale: 24 scenarios / 27 turns / 81 protocol rows
 *
 * Does NOT launch smoke-v6, canary, or full gauntlet.
 * Requires explicit PHASE34_OWNER_PROOF_REHEARSAL_APPROVED_SHA=<head>.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadOwnerProofScenarios,
  loadOwnerProofSeedManifest,
  validateSeedManifestAgainstScenarios,
  OWNER_PROOF_REHEARSAL_ROOT,
} from './lib/phase34-owner-proof-scenarios.mjs';
import { createOwnerProofLedger, summarizeLatency } from './lib/phase34-owner-proof-ledger.mjs';
import { generateOwnerProofReviewPage } from './lib/phase34-owner-proof-review-page.mjs';
import { assertSourceReconciliation, assertCiApproval } from './lib/phase32h-ci-approval.mjs';
import { assertScreenshotDistinctness } from './lib/phase34-product-screenshot-distinctness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = {
    out: process.env.PHASE34_OWNER_PROOF_REHEARSAL_OUT || OWNER_PROOF_REHEARSAL_ROOT,
    execute: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--execute') opts.execute = true;
  }
  return opts;
}

export function buildRehearsalPlan(doc = loadOwnerProofScenarios()) {
  const scenarios = doc.scenarios;
  let turns = 0;
  for (const s of scenarios) {
    turns += s.scenario_id === 'negotiation-four-turn-live' ? 4 : 1;
  }
  return {
    logical_scenarios: scenarios.length,
    total_turns: turns,
    protocol_rows: turns * 3,
    scenarios: scenarios.map((s) => ({
      scenario_id: s.scenario_id,
      capability: s.capability,
      turns: s.scenario_id === 'negotiation-four-turn-live' ? 4 : 1,
      canonical_route: s.canonical_route,
      expected_endpoint: s.expected_endpoint,
      user_intent: s.user_intent,
    })),
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const doc = loadOwnerProofScenarios();
  const seeds = loadOwnerProofSeedManifest();
  validateSeedManifestAgainstScenarios(doc, seeds);
  const plan = buildRehearsalPlan(doc);

  if (plan.total_turns !== 27 || plan.protocol_rows !== 81) {
    throw new Error(`rehearsal_scale_mismatch_turns_${plan.total_turns}_rows_${plan.protocol_rows}`);
  }

  if (!opts.execute) {
    console.log(
      JSON.stringify(
        {
          status: 'READY_NOT_LAUNCHED',
          out: opts.out,
          logical_scenarios: plan.logical_scenarios,
          total_turns: plan.total_turns,
          protocol_rows: plan.protocol_rows,
          rehearsal_root_absent: !fs.existsSync(opts.out),
          smoke_v6_root_absent: !fs.existsSync('/tmp/phase34-product-harness-live-smoke-v6'),
          plan,
          classification: [
            'OWNER_PROOF_REGISTRY_PRESENT',
            'OWNER_PROOF_EXECUTABLE_CONTRACT_PRESENT',
            'OWNER_PROOF_EXECUTION_NOT_PROVEN',
            'SMOKE_V6_NOT_AUTHORIZED',
          ],
          note: 'Pass --execute only after explicit SHA approval for the rehearsal root.',
        },
        null,
        2,
      ),
    );
    return;
  }

  const { headSha } = assertSourceReconciliation(REPO_ROOT);
  assertCiApproval(REPO_ROOT, headSha);
  const approved = process.env.PHASE34_OWNER_PROOF_REHEARSAL_APPROVED_SHA;
  if (approved !== headSha) {
    throw new Error(
      `rehearsal_not_approved: set PHASE34_OWNER_PROOF_REHEARSAL_APPROVED_SHA=${headSha}`,
    );
  }

  if (fs.existsSync(opts.out)) {
    throw new Error(`rehearsal_root_exists:${opts.out}`);
  }
  fs.mkdirSync(path.join(opts.out, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(opts.out, 'screenshots'), { recursive: true });
  fs.mkdirSync(path.join(opts.out, 'review'), { recursive: true });

  const ledger = createOwnerProofLedger(opts.out);
  fs.writeFileSync(path.join(opts.out, 'rehearsal-plan.json'), JSON.stringify(plan, null, 2) + '\n');
  fs.writeFileSync(
    path.join(opts.out, 'owner-proof-scenarios.json'),
    JSON.stringify(doc, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(opts.out, 'seed-manifest.json'),
    JSON.stringify(seeds, null, 2) + '\n',
  );

  // Live browser execution is intentionally gated: this commit ships the
  // executable contract + launcher. Full Chromium journey wiring reuses the
  // product harness adapters and must be authorized separately via --execute
  // with live stack. Placeholder freeze marker is NOT written here without
  // real PASS evidence.
  const err = new Error(
    'OWNER_PROOF_LIVE_BROWSER_EXECUTION_REQUIRES_STACK: launcher armed; wire live sessions via product harness adapters under explicit approval.',
  );
  err.code = 'OWNER_PROOF_LIVE_BROWSER_EXECUTION_REQUIRES_STACK';
  // Still emit an empty review scaffold so the path is verified.
  generateOwnerProofReviewPage({
    outRoot: opts.out,
    scenarios: doc.scenarios,
    ledgerRows: ledger.readAll(),
    screenshotsByScenario: {},
  });
  fs.writeFileSync(
    path.join(opts.out, 'latency-summary.json'),
    JSON.stringify(summarizeLatency([]), null, 2) + '\n',
  );
  throw err;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(JSON.stringify({ status: 'FAIL', error: String(err.message || err), code: err.code || null }));
    process.exit(2);
  }
}
