#!/usr/bin/env node
/**
 * Phase 34 — 24-scenario LIVE owner-proof rehearsal launcher.
 *
 * Root: /tmp/phase34-owner-proof-live-rehearsal-v2
 * Scale: 24 scenarios / 27 turns / 81 protocol rows
 *
 * Requires prior 24/24 LIVE_RESULT_PROVEN from live-action preflight.
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
import { assertSourceReconciliation, assertCiApproval } from './lib/phase32h-ci-approval.mjs';
import {
  buildOwnerProofSchedule,
  assertSeedFloors,
  executeOwnerProofLiveRehearsal,
} from './lib/phase34-owner-proof-live-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = {
    out: process.env.PHASE34_OWNER_PROOF_REHEARSAL_OUT || OWNER_PROOF_REHEARSAL_ROOT,
    execute: false,
    upstreamUrl: process.env.E2E_UPSTREAM_URL || 'https://record-platform.test',
    headless: true,
    proxyPort: Number(process.env.PHASE34_BROWSER_PROXY_PORT || 8443),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--execute') opts.execute = true;
    else if (a === '--base-url' || a === '--upstream-url') opts.upstreamUrl = argv[++i];
    else if (a === '--headed') opts.headless = false;
    else if (a === '--proxy-port') opts.proxyPort = Number(argv[++i]);
  }
  return opts;
}

export function buildRehearsalPlan(doc = loadOwnerProofScenarios()) {
  return buildOwnerProofSchedule(doc);
}

async function main() {
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
          plan: {
            logical_scenarios: plan.logical_scenarios,
            total_turns: plan.total_turns,
            protocol_rows: plan.protocol_rows,
            scenarios: plan.rows.map((r) => ({
              scenario_id: r.scenario_id,
              capability: r.capability,
              turns: r.smoke_turns,
              canonical_route: r.owner_proof_canonical_route,
              expected_endpoint: r.owner_proof_endpoint,
              user_intent: r.user_intent,
            })),
          },
          classification: [
            'OWNER_PROOF_REGISTRY_PRESENT',
            'OWNER_PROOF_EXECUTABLE_CONTRACT_PRESENT',
            'OWNER_PROOF_LIVE_RUNNER_PRESENT',
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

  const { headSha, originMainSha } = assertSourceReconciliation(REPO_ROOT);
  assertCiApproval({ headSha, originMainSha });
  const approved = process.env.PHASE34_OWNER_PROOF_REHEARSAL_APPROVED_SHA;
  if (approved !== headSha) {
    throw new Error(
      `rehearsal_not_approved: set PHASE34_OWNER_PROOF_REHEARSAL_APPROVED_SHA=${headSha}`,
    );
  }

  // Seed floors before creating the evidence root
  assertSeedFloors(seeds);

  const preflightRoot =
    process.env.PHASE34_OWNER_PROOF_LIVE_ACTION_PREFLIGHT_OUT ||
    '/tmp/phase34-owner-proof-live-action-preflight-v1';
  const preflightStatus = path.join(preflightRoot, 'LIVE_ACTION_PREFLIGHT_STATUS');
  if (!fs.existsSync(preflightStatus) || fs.readFileSync(preflightStatus, 'utf8').trim() !== 'PASS') {
    throw new Error(
      `rehearsal_requires_live_action_preflight_pass:${preflightRoot} ` +
        `(run scripts/phase34-verify-owner-proof-live-actions.mjs --execute first)`,
    );
  }
  const preflightSummaryPath = path.join(preflightRoot, 'reports', 'preflight-summary.json');
  if (fs.existsSync(preflightSummaryPath)) {
    const pf = JSON.parse(fs.readFileSync(preflightSummaryPath, 'utf8'));
    if (pf.live_result_proven !== 24) {
      throw new Error(`rehearsal_requires_24_live_result_proven_got_${pf.live_result_proven}`);
    }
  }

  if (fs.existsSync(opts.out)) {
    throw new Error(`rehearsal_root_exists:${opts.out}`);
  }
  fs.mkdirSync(path.join(opts.out, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(opts.out, 'screenshots'), { recursive: true });
  fs.mkdirSync(path.join(opts.out, 'review'), { recursive: true });

  fs.writeFileSync(path.join(opts.out, 'rehearsal-plan.json'), JSON.stringify(plan, null, 2) + '\n');
  fs.writeFileSync(
    path.join(opts.out, 'owner-proof-scenarios.json'),
    JSON.stringify(doc, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(opts.out, 'seed-manifest.json'),
    JSON.stringify(seeds, null, 2) + '\n',
  );

  const { summary, exportMeta } = await executeOwnerProofLiveRehearsal({
    outRoot: opts.out,
    headSha,
    upstreamUrl: opts.upstreamUrl,
    headless: opts.headless,
    proxyPort: opts.proxyPort,
  });

  console.log(
    JSON.stringify(
      {
        status: summary.freeze === 'FROZEN_PASS_EVIDENCE' ? 'PASS' : 'BLOCKED',
        ...summary,
        export: exportMeta,
      },
      null,
      2,
    ),
  );

  if (summary.freeze !== 'FROZEN_PASS_EVIDENCE') {
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(
      JSON.stringify({
        status: 'FAIL',
        error: String(err.message || err),
        code: err.code || null,
      }),
    );
    process.exit(2);
  });
}
