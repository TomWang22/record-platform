#!/usr/bin/env node
/**
 * Phase 34 — 24-scenario live client-action preflight.
 *
 * Proves click → expected POST → terminal panel for every scenario.
 * Does NOT create the official rehearsal root or mini-proof root.
 *
 * Output: /tmp/phase34-owner-proof-live-action-preflight-v1/
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OWNER_PROOF_LIVE_ACTION_PREFLIGHT_ROOT,
  loadOwnerProofScenarios,
} from './lib/phase34-owner-proof-scenarios.mjs';
import {
  writeClientActionContracts,
  assertContractsMatchScenarios,
} from './lib/phase34-owner-proof-client-action-contracts.mjs';
import { executeOwnerProofLiveActionPreflight } from './lib/phase34-owner-proof-live-action-preflight.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = {
    out: process.env.PHASE34_OWNER_PROOF_LIVE_ACTION_PREFLIGHT_OUT || OWNER_PROOF_LIVE_ACTION_PREFLIGHT_ROOT,
    execute: false,
    upstreamUrl: process.env.E2E_UPSTREAM_URL || 'https://record-platform.test',
    headless: true,
    proxyPort: Number(process.env.PHASE34_BROWSER_PROXY_PORT || 28443),
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

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  writeClientActionContracts();
  assertContractsMatchScenarios();
  const doc = loadOwnerProofScenarios();

  if (!opts.execute) {
    console.log(
      JSON.stringify(
        {
          status: 'READY_NOT_LAUNCHED',
          out: opts.out,
          scenarios: doc.scenarios.length,
          contracts: 24,
          preflight_root_absent: !fs.existsSync(opts.out),
          mini_proof_root_absent: !fs.existsSync('/tmp/phase34-owner-proof-mini-proof-v1'),
          rehearsal_v2_root_absent: !fs.existsSync('/tmp/phase34-owner-proof-live-rehearsal-v2'),
          note: 'Pass --execute against a stack running the repaired client to prove 24/24 LIVE_RESULT_PROVEN.',
        },
        null,
        2,
      ),
    );
    return;
  }

  const summary = await executeOwnerProofLiveActionPreflight({
    outRoot: opts.out,
    upstreamUrl: opts.upstreamUrl,
    headless: opts.headless,
    proxyPort: opts.proxyPort,
  });

  console.log(JSON.stringify(summary, null, 2));
  if (summary.freeze !== 'FROZEN_PASS_EVIDENCE') process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err?.stack || err);
    process.exit(1);
  });
}
