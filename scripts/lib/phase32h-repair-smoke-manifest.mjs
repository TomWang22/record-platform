/**
 * Phase 32H-R1-C2 — 60-probe synchronized repair smoke manifest.
 */
import { CONTRACT, PROMPTS, PROTOCOLS, expectedGate, loadN5Participants } from './phase22-full-replay-common.mjs';
import { protocolLabel } from './phase31-controlled-matrix-summary.mjs';
import { SMOKE_QUESTION } from './phase32h-smoke-manifest.mjs';

export const REPAIR_SMOKE_EVIDENCE_LABEL =
  'Phase 32H-R1 preview-422 repair synchronized validation';
export const REPAIR_SMOKE_TOTAL = 60;
export const REPAIR_SMOKE_PER_PROTOCOL = 20;
export const REPAIR_SMOKE_BATCHES = 20;

const AUCTION_QUESTION = new Map(PROMPTS).get('auction_pressure');

export function buildRepairSmokeManifest() {
  const preview = loadN5Participants().find((u) => u.email === 'tom@example.com');
  if (!preview) throw new Error('repair smoke requires tom@example.com preview participant');
  const users = [
    { label: 'contract', user: CONTRACT },
    { label: 'preview_affected', user: preview },
  ];
  const payloads = [
    { label: 'smoke_known_good', case_id: 'final_tagged_plan', question: SMOKE_QUESTION },
    { label: 'auction_pressure', case_id: 'auction_pressure', question: AUCTION_QUESTION },
  ];
  const rows = [];
  let probeId = 0;
  for (let repetition = 1; repetition <= 5; repetition += 1) {
    for (const { user } of users) {
      for (const payload of payloads) {
        for (const protoKey of ['h1', 'h2', 'h3']) {
          const proto = PROTOCOLS[protoKey];
          probeId += 1;
          rows.push({
            probe_id: probeId,
            matrix_protocol: protoKey,
            protocol_label: protocolLabel(proto.expected),
            window: repetition,
            run: 1,
            case_id: payload.case_id,
            question: payload.question,
            payload_label: payload.label,
            repetition,
            user_uid: user.uid,
            user_email: user.email,
            user_class: user.user_class,
            role: user.role,
            expected_gate_reason: expectedGate(user),
            expected_retrieval_mode: 'hybrid_canary',
            sentiment_required: false,
            red_team_case: payload.case_id === 'final_tagged_plan',
            evidence_label: REPAIR_SMOKE_EVIDENCE_LABEL,
          });
        }
      }
    }
  }
  return {
    rows,
    evidence_label: REPAIR_SMOKE_EVIDENCE_LABEL,
    target_total: REPAIR_SMOKE_TOTAL,
    target_per_protocol: REPAIR_SMOKE_PER_PROTOCOL,
    triplet_batches: REPAIR_SMOKE_BATCHES,
  };
}
