#!/usr/bin/env node
/**
 * Phase 31M — build targeted preview lifecycle replay manifest.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedGate, PROMPTS, PROTOCOLS } from './lib/phase22-full-replay-common.mjs';
import { protocolLabel } from './lib/phase31-controlled-matrix-summary.mjs';
import {
  DEFAULT_OUT,
  TARGETED_EVIDENCE_LABEL,
  TARGETED_REPLAY_PROTOCOLS,
  TARGETED_REPLAY_RUNS,
  TARGETED_REPLAY_TOTAL,
  TARGETED_REPLAY_WINDOWS,
  resolveTargetedReplayUsers,
} from './lib/phase31-targeted-replay-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') opts.out = argv[++i];
  }
  return opts;
}

export function buildTargetedReplayManifest() {
  const users = resolveTargetedReplayUsers();
  const rows = [];
  let probeId = 0;
  for (const protoKey of TARGETED_REPLAY_PROTOCOLS) {
    const proto = PROTOCOLS[protoKey];
    for (const window of TARGETED_REPLAY_WINDOWS) {
      for (const user of users) {
        for (const run of TARGETED_REPLAY_RUNS) {
          for (const [case_id, question] of PROMPTS) {
            probeId += 1;
            rows.push({
              probe_id: probeId,
              matrix_protocol: protoKey,
              protocol_label: protocolLabel(proto.expected),
              window,
              run,
              case_id,
              question,
              user_uid: user.uid,
              user_email: user.email,
              user_class: user.user_class,
              role: user.role,
              expected_gate_reason: expectedGate(user),
              expected_retrieval_mode: 'hybrid_canary',
              sentiment_required: case_id === 'buyer_psychology',
              red_team_case: case_id === 'red_team_overclaim' || case_id === 'final_tagged_plan',
              evidence_label: TARGETED_EVIDENCE_LABEL,
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
  const rows = buildTargetedReplayManifest();
  if (rows.length !== TARGETED_REPLAY_TOTAL) {
    throw new Error(`manifest size ${rows.length} != expected ${TARGETED_REPLAY_TOTAL}`);
  }
  fs.mkdirSync(opts.out, { recursive: true });
  const manifestPath = path.join(opts.out, 'phase31m-targeted-manifest.jsonl');
  fs.writeFileSync(manifestPath, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
  console.log(
    JSON.stringify(
      {
        manifest_path: manifestPath,
        total: rows.length,
        windows: TARGETED_REPLAY_WINDOWS,
        runs: TARGETED_REPLAY_RUNS,
        per_protocol: rows.length / TARGETED_REPLAY_PROTOCOLS.length,
      },
      null,
      2,
    ),
  );
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main());
}
