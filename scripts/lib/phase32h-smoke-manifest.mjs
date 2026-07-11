/**
 * Phase 32H — six-probe capture-integrity smoke manifest.
 */
import { CONTRACT, PROTOCOLS, PROMPTS, expectedGate } from './phase22-full-replay-common.mjs';
import { protocolLabel } from './phase31-controlled-matrix-summary.mjs';
import { PHASE32H_EVIDENCE_LABEL } from './phase32h-targeted-reproduction-config.mjs';

export const SMOKE_CASE_ID = 'final_tagged_plan';
export const SMOKE_QUESTION = new Map(PROMPTS).get(SMOKE_CASE_ID);

export function buildPhase32hSmokeManifest(previewUser) {
  if (!previewUser?.uid || !previewUser?.email) {
    throw new Error('preview user required for smoke manifest');
  }
  const rows = [];
  let probeId = 0;
  for (const protoKey of ['h1', 'h2', 'h3']) {
    const proto = PROTOCOLS[protoKey];
    for (const user of [CONTRACT, previewUser]) {
      probeId += 1;
      rows.push({
        probe_id: probeId,
        matrix_protocol: protoKey,
        protocol_label: protocolLabel(proto.expected),
        window: 1,
        run: 1,
        case_id: SMOKE_CASE_ID,
        question: SMOKE_QUESTION,
        user_uid: user.uid,
        user_email: user.email,
        user_class: user.user_class,
        role: user.role,
        expected_gate_reason: expectedGate(user),
        expected_retrieval_mode: 'hybrid_canary',
        sentiment_required: false,
        red_team_case: true,
        evidence_label: PHASE32H_EVIDENCE_LABEL,
        smoke_probe: true,
      });
    }
  }
  return rows;
}
