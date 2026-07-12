#!/usr/bin/env node
/**
 * Phase 32H-R1 — build 8640-probe three-protocol validation manifest.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedGate, PROTOCOLS, PROMPTS, loadN5Participants } from './lib/phase22-full-replay-common.mjs';
import { protocolLabel } from './lib/phase31-controlled-matrix-summary.mjs';
import {
  R1_CASE_IDS,
  R1_CANARY_CASE_IDS,
  R1_CANARY_PER_PROTOCOL,
  R1_CANARY_RUNS,
  R1_CANARY_TOTAL,
  R1_CANARY_WINDOWS,
  R1_PER_PROTOCOL,
  R1_PROTOCOLS,
  R1_RUNS,
  R1_TOTAL,
  R1_WINDOWS,
  evidenceLabelForArm,
  r1Dimensions,
} from './lib/phase32h-r1-config.mjs';
import { sha256File, initRunState, generateRunId } from './lib/phase32h-run-integrity.mjs';
import { gitSha } from './lib/phase22-full-replay-common.mjs';
import { assertManifestContract } from './lib/phase32h-manifest-contract.mjs';

function parseArgs(argv) {
  const opts = { out: '/tmp/phase32h-r1-baseline', arm: 'baseline', canary: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
    if (argv[i] === '--arm') opts.arm = argv[++i];
    if (argv[i] === '--canary') opts.canary = true;
  }
  return opts;
}

function buildManifestRows({
  evidenceLabel,
  windows,
  runs,
  caseIds,
}) {
  const users = loadN5Participants();
  const promptByCaseId = new Map(PROMPTS);
  const rows = [];
  let probeId = 0;
  for (const protoKey of R1_PROTOCOLS) {
    const proto = PROTOCOLS[protoKey];
    for (const window of windows) {
      for (const user of users) {
        for (const run of runs) {
          for (const caseId of caseIds) {
            const question = promptByCaseId.get(caseId);
            if (!question) {
              throw new Error(`missing prompt for case_id=${caseId}`);
            }
            probeId += 1;
            rows.push({
              probe_id: probeId,
              matrix_protocol: protoKey,
              protocol_label: protocolLabel(proto.expected),
              window,
              run,
              case_id: caseId,
              question,
              user_uid: user.uid,
              user_email: user.email,
              user_class: user.user_class,
              role: user.role,
              expected_gate_reason: expectedGate(user),
              expected_retrieval_mode: 'hybrid_canary',
              sentiment_required: caseId === 'buyer_psychology',
              red_team_case: caseId === 'red_team_overclaim' || caseId === 'final_tagged_plan',
              evidence_label: evidenceLabel,
            });
          }
        }
      }
    }
  }
  return rows;
}

export function buildR1Manifest({ evidenceLabel } = {}) {
  return buildManifestRows({
    evidenceLabel: evidenceLabel || 'Phase 32H-R1 baseline synchronized-stall validation',
    windows: R1_WINDOWS,
    runs: R1_RUNS,
    caseIds: R1_CASE_IDS,
  });
}

export function buildR1CanaryManifest({ evidenceLabel } = {}) {
  return buildManifestRows({
    evidenceLabel: evidenceLabel || 'Phase 32H-R1 baseline-r2 canary synchronized-stall validation',
    windows: R1_CANARY_WINDOWS,
    runs: R1_CANARY_RUNS,
    caseIds: R1_CANARY_CASE_IDS,
  });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.out.startsWith('/tmp/')) throw new Error('R1 manifest output must be under /tmp');
  const evidenceLabel = evidenceLabelForArm(opts.arm, { canary: opts.canary });
  const rows = opts.canary
    ? buildR1CanaryManifest({ evidenceLabel })
    : buildR1Manifest({ evidenceLabel });
  const expectedTotal = opts.canary ? R1_CANARY_TOTAL : R1_TOTAL;
  const expectedPerProto = opts.canary ? R1_CANARY_PER_PROTOCOL : R1_PER_PROTOCOL;
  if (rows.length !== expectedTotal) throw new Error(`manifest size ${rows.length} != ${expectedTotal}`);
  const perProto = rows.filter((r) => r.matrix_protocol === 'h1').length;
  if (perProto !== expectedPerProto) throw new Error(`per-protocol ${perProto} != ${expectedPerProto}`);
  assertManifestContract(rows, {
    evidenceLabel,
    expectedTotal,
    expectedPerProtocol: expectedPerProto,
  });

  fs.mkdirSync(opts.out, { recursive: true });
  const manifestPath = path.join(opts.out, 'phase32h-r1-manifest.jsonl');
  fs.writeFileSync(manifestPath, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
  if (opts.canary) {
    fs.writeFileSync(
      path.join(opts.out, 'phase32h-r1-canary.json'),
      `${JSON.stringify(
        {
          mode: 'canary',
          target_total: R1_CANARY_TOTAL,
          per_protocol: R1_CANARY_PER_PROTOCOL,
          triplet_batches: R1_CANARY_PER_PROTOCOL,
          evidence_label: evidenceLabel,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }

  const runId = generateRunId();
  const launchHead = gitSha();
  initRunState(opts.out, { runId, launchHead, evidenceLabel, manifestPath });

  console.log(
    JSON.stringify(
      {
        manifest_path: manifestPath,
        total: rows.length,
        per_protocol: perProto,
        cases: opts.canary ? R1_CANARY_CASE_IDS : R1_CASE_IDS,
        windows: opts.canary ? R1_CANARY_WINDOWS : R1_WINDOWS,
        evidence_label: evidenceLabel,
        run_id: runId,
        launch_head: launchHead,
        manifest_sha256: sha256File(manifestPath),
        dimensions: r1Dimensions({ canary: opts.canary }),
        mode: opts.canary ? 'canary' : 'full',
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
