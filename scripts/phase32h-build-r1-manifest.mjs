#!/usr/bin/env node
/**
 * Phase 32H-R1 — build 8640-probe three-protocol validation manifest.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedGate, PROTOCOLS, loadN5Participants } from './lib/phase22-full-replay-common.mjs';
import { protocolLabel } from './lib/phase31-controlled-matrix-summary.mjs';
import {
  R1_CASE_IDS,
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

function parseArgs(argv) {
  const opts = { out: '/tmp/phase32h-r1-baseline', arm: 'baseline' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
    if (argv[i] === '--arm') opts.arm = argv[++i];
  }
  return opts;
}

export function buildR1Manifest({ evidenceLabel } = {}) {
  const users = loadN5Participants();
  const label = evidenceLabel || 'Phase 32H-R1 baseline synchronized-stall validation';
  const rows = [];
  let probeId = 0;
  for (const protoKey of R1_PROTOCOLS) {
    const proto = PROTOCOLS[protoKey];
    for (const window of R1_WINDOWS) {
      for (const user of users) {
        for (const run of R1_RUNS) {
          for (const caseId of R1_CASE_IDS) {
            probeId += 1;
            rows.push({
              probe_id: probeId,
              matrix_protocol: protoKey,
              protocol_label: protocolLabel(proto.expected),
              window,
              run,
              case_id: caseId,
              user_uid: user.uid,
              user_email: user.email,
              user_class: user.user_class,
              role: user.role,
              expected_gate_reason: expectedGate(user),
              expected_retrieval_mode: 'hybrid_canary',
              sentiment_required: caseId === 'buyer_psychology',
              red_team_case: caseId === 'red_team_overclaim' || caseId === 'final_tagged_plan',
              evidence_label: label,
            });
          }
        }
      }
    }
  }
  return rows;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.out.startsWith('/tmp/')) throw new Error('R1 manifest output must be under /tmp');
  const evidenceLabel = evidenceLabelForArm(opts.arm);
  const rows = buildR1Manifest({ evidenceLabel });
  if (rows.length !== R1_TOTAL) throw new Error(`manifest size ${rows.length} != ${R1_TOTAL}`);
  const perProto = rows.filter((r) => r.matrix_protocol === 'h1').length;
  if (perProto !== R1_PER_PROTOCOL) throw new Error(`per-protocol ${perProto} != ${R1_PER_PROTOCOL}`);

  fs.mkdirSync(opts.out, { recursive: true });
  const manifestPath = path.join(opts.out, 'phase32h-r1-manifest.jsonl');
  fs.writeFileSync(manifestPath, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');

  const runId = generateRunId();
  const launchHead = gitSha();
  initRunState(opts.out, { runId, launchHead, evidenceLabel, manifestPath });

  console.log(
    JSON.stringify(
      {
        manifest_path: manifestPath,
        total: rows.length,
        per_protocol: perProto,
        cases: R1_CASE_IDS,
        windows: R1_WINDOWS,
        evidence_label: evidenceLabel,
        run_id: runId,
        launch_head: launchHead,
        manifest_sha256: sha256File(manifestPath),
        dimensions: r1Dimensions(),
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
