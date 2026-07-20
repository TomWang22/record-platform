#!/usr/bin/env node
/**
 * Phase 34 — LIVE owner-proof recapture-v5 (24 scenarios / 27 turns / 81 protocol rows).
 *
 * Requires PHASE34_OWNER_PROOF_RECAPTURE_V5_APPROVED_SHA=<head>.
 * Does NOT mutate frozen v3/v4 roots. Does NOT launch smoke-v6/canary/gauntlet.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  loadOwnerProofScenarios,
  loadOwnerProofSeedManifest,
  validateSeedManifestAgainstScenarios,
  OWNER_PROOF_RECAPTURE_V5_ROOT,
  OWNER_PROOF_RECAPTURE_V5_ATTEMPT2_ROOT,
  OWNER_PROOF_RECAPTURE_V5_ATTEMPT3_ROOT,
  OWNER_PROOF_RECAPTURE_V5_EXPORT,
} from './lib/phase34-owner-proof-scenarios.mjs';
import {
  assertSourceReconciliation,
  assertCiApproval,
  approvalPathForSha,
} from './lib/phase32h-ci-approval.mjs';
import {
  buildOwnerProofSchedule,
  assertSeedFloors,
  executeOwnerProofLiveRehearsal,
  reorderRecaptureV4Schedule,
  RECAPTURE_V4_KNOWN_FIRST_SCENARIO_ID,
} from './lib/phase34-owner-proof-live-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function parseArgs(argv) {
  const opts = {
    out: process.env.PHASE34_OWNER_PROOF_RECAPTURE_V5_OUT || OWNER_PROOF_RECAPTURE_V5_ROOT,
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
    else if (a === '--attempt-2') opts.out = OWNER_PROOF_RECAPTURE_V5_ATTEMPT2_ROOT;
    else if (a === '--attempt-3') opts.out = OWNER_PROOF_RECAPTURE_V5_ATTEMPT3_ROOT;
    else if (a === '--attempt' && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 2) throw new Error(`invalid_attempt:${n}`);
      opts.out =
        n === 2
          ? OWNER_PROOF_RECAPTURE_V5_ATTEMPT2_ROOT
          : `/tmp/phase34-owner-proof-live-recapture-v5-attempt-${n}`;
    }
  }
  return opts;
}

function assertFrozenPriorsIntact() {
  for (const root of [
    '/tmp/phase34-owner-proof-live-recapture-v3',
    '/tmp/phase34-owner-proof-live-recapture-v4',
    '/tmp/phase34-owner-proof-live-recapture-v5',
    '/tmp/phase34-owner-proof-live-recapture-v5-attempt-2',
  ]) {
    if (!fs.existsSync(root)) continue;
    const marker = path.join(root, 'FROZEN_BLOCKED_EVIDENCE');
    const summary = path.join(root, 'execution-summary.json');
    if (!fs.existsSync(marker) && !fs.existsSync(summary)) {
      throw new Error(`frozen_prior_missing:${root}`);
    }
  }
}

function assertLaterRootsAbsent() {
  for (const forbidden of [
    '/tmp/phase34-product-harness-live-smoke-v6',
    '/tmp/phase34-product-gauntlet-canary-v1',
    '/tmp/phase34-product-gauntlet-v1',
    '/tmp/phase34-owner-proof-mini-proof-v1',
  ]) {
    if (fs.existsSync(forbidden)) {
      throw new Error(`later_launch_root_present:${forbidden}`);
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const doc = loadOwnerProofScenarios();
  const seeds = loadOwnerProofSeedManifest();
  validateSeedManifestAgainstScenarios(doc, seeds);
  const plan = reorderRecaptureV4Schedule(buildOwnerProofSchedule(doc));

  if (plan.total_turns !== 27 || plan.protocol_rows !== 81) {
    throw new Error(`recapture_v5_scale_mismatch_turns_${plan.total_turns}_rows_${plan.protocol_rows}`);
  }
  if (plan.rows[0]?.scenario_id !== RECAPTURE_V4_KNOWN_FIRST_SCENARIO_ID) {
    throw new Error(`recapture_v5_known_first_mismatch:${plan.rows[0]?.scenario_id}`);
  }

  if (!opts.execute) {
    console.log(
      JSON.stringify(
        {
          status: 'READY_NOT_LAUNCHED',
          out: opts.out,
          export: OWNER_PROOF_RECAPTURE_V5_EXPORT,
          known_first_scenario: RECAPTURE_V4_KNOWN_FIRST_SCENARIO_ID,
          recapture_v5_root_absent: !fs.existsSync(opts.out),
        },
        null,
        2,
      ),
    );
    return;
  }

  const { headSha, originMainSha } = assertSourceReconciliation(REPO_ROOT);
  assertCiApproval({ headSha, originMainSha });
  const approved = process.env.PHASE34_OWNER_PROOF_RECAPTURE_V5_APPROVED_SHA;
  if (approved !== headSha) {
    throw new Error(
      `recapture_v5_not_approved: set PHASE34_OWNER_PROOF_RECAPTURE_V5_APPROVED_SHA=${headSha}`,
    );
  }

  const approvalPath = approvalPathForSha(headSha);
  if (!fs.existsSync(approvalPath)) {
    const err = new Error(`APPROVAL_CHECKSUM_MISMATCH:missing_approval_file:${approvalPath}`);
    err.code = 'APPROVAL_CHECKSUM_MISMATCH';
    throw err;
  }
  const approvalSha256 = sha256File(approvalPath);
  const boundChecksum = process.env.PHASE34_OWNER_PROOF_APPROVAL_SHA256;
  if (boundChecksum && approvalSha256 !== boundChecksum) {
    const err = new Error(
      `APPROVAL_CHECKSUM_MISMATCH:on_disk=${approvalSha256}:expected=${boundChecksum}`,
    );
    err.code = 'APPROVAL_CHECKSUM_MISMATCH';
    throw err;
  }

  assertFrozenPriorsIntact();
  assertLaterRootsAbsent();
  if (fs.existsSync(opts.out)) {
    throw new Error(`recapture_v5_root_exists:${opts.out}`);
  }

  assertSeedFloors(seeds);
  process.env.PHASE34_OWNER_PROOF_EXPORT_DIR = OWNER_PROOF_RECAPTURE_V5_EXPORT;

  fs.mkdirSync(path.join(opts.out, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(opts.out, 'screenshots'), { recursive: true });
  fs.mkdirSync(path.join(opts.out, 'review'), { recursive: true });
  fs.mkdirSync(path.join(opts.out, 'dossiers'), { recursive: true });
  fs.mkdirSync(path.join(opts.out, 'transcripts'), { recursive: true });

  fs.writeFileSync(path.join(opts.out, 'recapture-v5-plan.json'), JSON.stringify(plan, null, 2) + '\n');
  fs.writeFileSync(
    path.join(opts.out, 'approval-binding.json'),
    JSON.stringify(
      {
        head_sha: headSha,
        origin_main_sha: originMainSha,
        approval_path: approvalPath,
        approval_sha256: approvalSha256,
        export_root: OWNER_PROOF_RECAPTURE_V5_EXPORT,
      },
      null,
      2,
    ) + '\n',
  );

  const { summary, exportMeta } = await executeOwnerProofLiveRehearsal({
    outRoot: opts.out,
    headSha,
    upstreamUrl: opts.upstreamUrl,
    headless: opts.headless,
    proxyPort: opts.proxyPort,
    recaptureV5: true,
  });

  const terminalHeading =
    summary.freeze === 'FROZEN_PASS_EVIDENCE'
      ? 'PHASE 34 OWNER-PROOF LIVE RECAPTURE-V5 PASS — COMPLETE 20-PNG OWNER PACKAGE READY'
      : 'PHASE 34 OWNER-PROOF LIVE RECAPTURE-V5 BLOCKED — ACTUAL FAILURE EVIDENCE FROZEN';

  console.log(
    JSON.stringify(
      {
        terminal_heading: terminalHeading,
        status: summary.freeze === 'FROZEN_PASS_EVIDENCE' ? 'PASS' : 'BLOCKED',
        ...summary,
        export: exportMeta,
        approval_sha256: approvalSha256,
        production: 'NOT APPROVED',
        smoke_v6: 'ABSENT_NOT_LAUNCHED',
      },
      null,
      2,
    ),
  );

  if (summary.freeze === 'FROZEN_PASS_EVIDENCE') {
    const uploadDir = path.join(OWNER_PROOF_RECAPTURE_V5_EXPORT, 'upload-20');
    if (fs.existsSync(uploadDir)) {
      spawnSync('open', [uploadDir], { encoding: 'utf8' });
    }
  }

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
