#!/usr/bin/env node
/**
 * Phase 32H — build targeted reproduction manifest (6 cases × 16 windows × 6 users × 10 runs × 3 protocols).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedGate, PROTOCOLS, loadN5Participants } from './lib/phase22-full-replay-common.mjs';
import { protocolLabel } from './lib/phase31-controlled-matrix-summary.mjs';
import {
  PHASE32H_EVIDENCE_LABEL,
  TARGETED_PROTOCOLS,
  TARGETED_RUNS,
  TARGETED_WINDOWS,
  TARGET_PER_PROTOCOL,
  TARGET_TOTAL,
  targetedPrompts,
  resolvePhase32hRoot,
} from './lib/phase32h-targeted-reproduction-config.mjs';

function parseArgs(argv) {
  const opts = { out: resolvePhase32hRoot() };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') opts.out = argv[++i];
  }
  return opts;
}

export function buildPhase32hManifest() {
  const users = loadN5Participants();
  const prompts = targetedPrompts();
  const rows = [];
  let probeId = 0;
  for (const protoKey of TARGETED_PROTOCOLS) {
    const proto = PROTOCOLS[protoKey];
    for (const window of TARGETED_WINDOWS) {
      for (const user of users) {
        for (const run of TARGETED_RUNS) {
          for (const [case_id, question] of prompts) {
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
              evidence_label: PHASE32H_EVIDENCE_LABEL,
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
  if (!opts.out.startsWith('/tmp/')) throw new Error('manifest output must be under /tmp');
  const rows = buildPhase32hManifest();
  if (rows.length !== TARGET_TOTAL) {
    throw new Error(`manifest size ${rows.length} != ${TARGET_TOTAL}`);
  }
  const perProto = rows.filter((r) => r.matrix_protocol === 'h1').length;
  if (perProto !== TARGET_PER_PROTOCOL) {
    throw new Error(`per-protocol ${perProto} != ${TARGET_PER_PROTOCOL}`);
  }
  fs.mkdirSync(opts.out, { recursive: true });
  const manifestPath = path.join(opts.out, 'phase32h-targeted-manifest.jsonl');
  fs.writeFileSync(manifestPath, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
  console.log(
    JSON.stringify(
      {
        manifest_path: manifestPath,
        total: rows.length,
        per_protocol: perProto,
        cases: [...new Set(rows.map((r) => r.case_id))],
        evidence_label: PHASE32H_EVIDENCE_LABEL,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
