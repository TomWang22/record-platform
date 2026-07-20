#!/usr/bin/env node
/**
 * Phase 34 — LIVE owner-proof recapture-v4 (24 scenarios / 27 turns / 81 protocol rows).
 *
 * Requires explicit PHASE34_OWNER_PROOF_RECAPTURE_V4_APPROVED_SHA=<head>.
 * Does NOT launch smoke-v6, canary, gauntlet, or mini-proof.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  loadOwnerProofScenarios,
  loadOwnerProofSeedManifest,
  validateSeedManifestAgainstScenarios,
  OWNER_PROOF_RECAPTURE_V4_ROOT,
  OWNER_PROOF_RECAPTURE_V4_EXPORT,
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

const BRIEF_APPROVAL_SHA256 =
  '6cf496b9f0a7dfba0f1f21b7ccea24523cd051eb2db05f99719ac9f6f84b7574';

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function parseArgs(argv) {
  const opts = {
    out: process.env.PHASE34_OWNER_PROOF_RECAPTURE_V4_OUT || OWNER_PROOF_RECAPTURE_V4_ROOT,
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
    throw new Error(`recapture_v4_scale_mismatch_turns_${plan.total_turns}_rows_${plan.protocol_rows}`);
  }
  if (plan.rows[0]?.scenario_id !== RECAPTURE_V4_KNOWN_FIRST_SCENARIO_ID) {
    throw new Error(`recapture_v4_known_first_mismatch:${plan.rows[0]?.scenario_id}`);
  }

  if (!opts.execute) {
    console.log(
      JSON.stringify(
        {
          status: 'READY_NOT_LAUNCHED',
          out: opts.out,
          export: OWNER_PROOF_RECAPTURE_V4_EXPORT,
          known_first_scenario: RECAPTURE_V4_KNOWN_FIRST_SCENARIO_ID,
          recapture_v4_root_absent: !fs.existsSync(opts.out),
        },
        null,
        2,
      ),
    );
    return;
  }

  const { headSha, originMainSha } = assertSourceReconciliation(REPO_ROOT);
  assertCiApproval({ headSha, originMainSha });
  const approved = process.env.PHASE34_OWNER_PROOF_RECAPTURE_V4_APPROVED_SHA;
  if (approved !== headSha) {
    throw new Error(
      `recapture_v4_not_approved: set PHASE34_OWNER_PROOF_RECAPTURE_V4_APPROVED_SHA=${headSha}`,
    );
  }

  const approvalPath = approvalPathForSha(headSha);
  if (!fs.existsSync(approvalPath)) {
    const err = new Error(`APPROVAL_CHECKSUM_MISMATCH:missing_approval_file:${approvalPath}`);
    err.code = 'APPROVAL_CHECKSUM_MISMATCH';
    throw err;
  }
  const approvalSha256 = sha256File(approvalPath);
  const boundChecksum = process.env.PHASE34_OWNER_PROOF_APPROVAL_SHA256 || BRIEF_APPROVAL_SHA256;
  if (approvalSha256 !== boundChecksum) {
    const err = new Error(
      `APPROVAL_CHECKSUM_MISMATCH:on_disk=${approvalSha256}:expected=${boundChecksum}`,
    );
    err.code = 'APPROVAL_CHECKSUM_MISMATCH';
    throw err;
  }

  assertLaterRootsAbsent();
  if (fs.existsSync(opts.out)) {
    throw new Error(`recapture_v4_root_exists:${opts.out}`);
  }
  if (fs.existsSync('/tmp/phase34-owner-proof-live-recapture-v3/FROZEN_BLOCKED_EVIDENCE')) {
    // v3 remains frozen; do not mutate.
  }

  assertSeedFloors(seeds);
  process.env.PHASE34_OWNER_PROOF_EXPORT_DIR = OWNER_PROOF_RECAPTURE_V4_EXPORT;

  fs.mkdirSync(path.join(opts.out, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(opts.out, 'screenshots'), { recursive: true });
  fs.mkdirSync(path.join(opts.out, 'review'), { recursive: true });

  fs.writeFileSync(path.join(opts.out, 'recapture-v4-plan.json'), JSON.stringify(plan, null, 2) + '\n');
  fs.writeFileSync(
    path.join(opts.out, 'approval-binding.json'),
    JSON.stringify(
      {
        head_sha: headSha,
        origin_main_sha: originMainSha,
        approval_path: approvalPath,
        approval_sha256: approvalSha256,
        export_root: OWNER_PROOF_RECAPTURE_V4_EXPORT,
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
    recaptureV4: true,
  });

  const terminalHeading =
    summary.freeze === 'FROZEN_PASS_EVIDENCE'
      ? 'PHASE 34 LIVE OWNER-PROOF RECAPTURE-V4 PASS — 24 REAL PRODUCT SCENARIOS DOCUMENTED — 20-PNG OWNER PACKAGE READY — OWNER VISUAL REVIEW REQUIRED — LATER LAUNCHES NOT STARTED'
      : 'PHASE 34 LIVE OWNER-PROOF RECAPTURE-V4 BLOCKED — ACTUAL FAILURE EVIDENCE FROZEN — OWNER PACKAGE DIAGNOSTIC ONLY — LATER LAUNCHES NOT STARTED';

  console.log(
    JSON.stringify(
      {
        terminal_heading: terminalHeading,
        status: summary.freeze === 'FROZEN_PASS_EVIDENCE' ? 'PASS' : 'BLOCKED',
        ...summary,
        export: exportMeta,
        approval_sha256: approvalSha256,
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
