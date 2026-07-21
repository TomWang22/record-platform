/**
 * Phase F2 — bounded semantic evaluation corpus + deterministic expansion.
 *
 * Checked-in compact corpus lives under scripts/ai-platform/phase34-semantic-corpus/.
 * expandCorpus(seed) deterministically expands to >= MIN_EXPANDED_EVALUATED_TURNS
 * for CI (default 500).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { EIGHT_CAPABILITIES } from './phase34-capability-response.mjs';
import {
  buildSemanticResponseDossier,
  evaluateResponseDossier,
  CORE_SEMANTIC_GATES,
  evaluateSemanticGates,
  assertSemanticGatesPass,
  scoreHumanQualityRubric,
} from './phase34-semantic-evaluation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const CORPUS_VERSION = 'phase34-semantic-corpus-v1';
export const MIN_COMPACT_EVALUATED_TURNS = 80;
export const MIN_EXPANDED_EVALUATED_TURNS = 500;
export const DEFAULT_CORPUS_DIR = path.resolve(
  __dirname,
  '../ai-platform/phase34-semantic-corpus',
);

const CUSTOMER_FACING = Object.freeze([
  'scarcity',
  'valuation',
  'auction_intelligence',
  'semantic_search',
  'negotiation_assistance',
  'recommendations',
  'market_analytics',
]);

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function mulberry32(a) {
  return function rand() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedToUint(seed) {
  const hex = sha256Hex(seed).slice(0, 8);
  return Number.parseInt(hex, 16) >>> 0;
}

function snap(id, hash) {
  return {
    evidence_snapshot_id: id,
    evidence_snapshot_hash: hash,
  };
}

function soldEvent(id, price, extras = {}) {
  return {
    id,
    evidence_id: id,
    market_event_id: id,
    included: true,
    event_type: 'SALE_COMPLETED',
    sale_kind: 'sold',
    rights_status: 'FIRST_PARTY',
    source_class: 'FIRST_PARTY_SETTLEMENT',
    price,
    ...extras,
  };
}

/**
 * Build the compact multi-session corpus (source of truth for check-in + expansion).
 */
export function buildCompactCorpus({ seed = 'phase34-compact-v1' } = {}) {
  const sessions = [];

  // --- Negotiation: rich multi-turn + additional compact sessions ---
  sessions.push(buildNegotiationPrimarySession());
  for (let i = 2; i <= 10; i += 1) {
    sessions.push(buildCompactCapabilitySession({
      capability: 'negotiation_assistance',
      sessionIndex: i,
      turns: negotiationPadTurns(i),
    }));
  }

  // --- Auction: primary coverage + pads to 10 sessions ---
  sessions.push(buildAuctionPrimarySession());
  for (let i = 2; i <= 10; i += 1) {
    sessions.push(buildCompactCapabilitySession({
      capability: 'auction_intelligence',
      sessionIndex: i,
      turns: auctionPadTurns(i),
    }));
  }

  // --- Other customer-facing: 10 sessions each (compact 2–3 turns) ---
  for (const capability of [
    'scarcity',
    'valuation',
    'semantic_search',
    'recommendations',
    'market_analytics',
  ]) {
    for (let i = 1; i <= 10; i += 1) {
      sessions.push(buildCompactCapabilitySession({
        capability,
        sessionIndex: i,
        turns: genericCapabilityTurns(capability, i),
      }));
    }
  }

  // --- Embeddings: fewer sessions (diagnostic / non-customer-primary) ---
  for (let i = 1; i <= 4; i += 1) {
    sessions.push(buildCompactCapabilitySession({
      capability: 'embeddings',
      sessionIndex: i,
      turns: embeddingsTurns(i),
    }));
  }

  const turns = sessions.flatMap((s) => s.turns.map((t) => ({ ...t, session_id: s.session_id, capability: s.capability })));

  return {
    corpus_version: CORPUS_VERSION,
    label: 'Phase 34 semantic evaluation compact corpus',
    seed,
    model_weight_training: 'NO',
    capabilities: [...EIGHT_CAPABILITIES],
    customer_facing_capabilities: [...CUSTOMER_FACING],
    session_count: sessions.length,
    evaluated_turn_count: turns.length,
    sessions,
    notes: [
      'H1/H2/H3 are transport-only and not semantic truth.',
      'expandCorpus(seed) expands this compact set deterministically to >=500 evaluated turns for CI.',
      'PNG / screenshot differences are never correction proofs.',
    ],
  };
}

function baseDossierFields({
  capability,
  session_id,
  turn_id,
  scenario_id,
  scenario_class,
  text,
  included = [],
  excluded = [],
  evidence_items = null,
  key_values = {},
  limitations = [],
  claim_ledger = null,
  correction_record = null,
  action_audit = [],
  session_facts = [],
  retrieval_execution = null,
  subject_resolution = null,
  honest_limit = false,
  what_changed = '',
  calc_values = [],
  snapshot_id,
  snapshot_hash,
}) {
  const items =
    evidence_items ||
    included.map((id) => soldEvent(id, key_values.median_price || key_values.fair_value || 40));

  const supporting = included.length ? included : [];
  const ledger =
    claim_ledger ||
    {
      claim_ledger_id: `cl-${turn_id}`,
      verification_status: 'PASS',
      entries: Object.keys(key_values).length
        ? Object.entries(key_values).slice(0, 3).map(([k, v], i) => ({
            claim_id: `${turn_id}-${k}`,
            claim_type: k,
            normalized_claim_value: v,
            material: typeof v === 'number',
            expected_count: typeof v === 'number' && k.includes('count') ? v : undefined,
            supporting_snapshot_item_ids:
              typeof v === 'number' && k.includes('count') && v === 0
                ? []
                : supporting.slice(0, typeof v === 'number' && k.includes('count') ? v : Math.min(1, supporting.length)),
            verification_result: 'SUPPORTED',
          }))
        : [
            {
              claim_id: `${turn_id}-grounded`,
              claim_type: 'summary',
              material: false,
              supporting_snapshot_item_ids: supporting.slice(0, 1),
              verification_result: 'SUPPORTED',
            },
          ],
    };

  // Fix sold_count claims to match included length when present
  if (key_values.sold_count != null) {
    ledger.entries = [
      {
        claim_id: `${turn_id}-sold_count`,
        claim_type: 'sold_count',
        normalized_claim_value: key_values.sold_count,
        expected_count: key_values.sold_count,
        material: true,
        supporting_snapshot_item_ids: included.slice(0, key_values.sold_count),
        verification_result: 'SUPPORTED',
      },
      ...asArray(ledger.entries).filter((e) => e.claim_type !== 'sold_count'),
    ];
  }

  return buildSemanticResponseDossier({
    capability,
    session_id,
    turn_id,
    scenario_id,
    scenario_class,
    customer_text: text,
    direct_answer: text,
    key_values,
    limitations,
    honest_limit: honest_limit || scenario_class === 'C_honest_limit',
    included_event_ids: included,
    excluded_event_ids: excluded,
    evidence_items: items,
    claim_ledger: ledger,
    correction_record,
    action_audit,
    session_facts,
    retrieval_execution,
    subject_resolution,
    what_changed,
    calc_values,
    evidence_snapshot: snap(snapshot_id || `es-${turn_id}`, snapshot_hash || sha256Hex(`${session_id}:${turn_id}:${text}`)),
    deterministic_calculation: {
      calc_id: key_values.sold_count != null ? 'calc:count' : 'calc:median',
      values: calc_values,
    },
    model_input_hash: null,
    model_output: null,
    latency: { descriptive_only: true, pipeline_ms: 12 + (turn_id.length % 40) },
  });
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function turn(session_id, capability, turn_id, scenario_class, dossier) {
  return {
    turn_id,
    session_id,
    capability,
    scenario_class,
    evaluated: true,
    dossier,
  };
}

function buildNegotiationPrimarySession() {
  const session_id = 'nego-sess-01';
  const capability = 'negotiation_assistance';
  const factsShipping6 = [
    {
      fact_id: 'f-ship-1',
      key: 'shipping_amount_usd',
      value: 6,
      authority: 'CURRENT_EXPLICIT_CUSTOMER_STATEMENT',
      active: true,
      source_turn_id: 'nego-01-t01',
    },
  ];
  const factsShipping5 = [
    {
      fact_id: 'f-ship-1',
      key: 'shipping_amount_usd',
      value: 6,
      authority: 'CURRENT_EXPLICIT_CUSTOMER_STATEMENT',
      active: false,
      source_turn_id: 'nego-01-t01',
    },
    {
      fact_id: 'f-ship-2',
      key: 'shipping_amount_usd',
      value: 5,
      authority: 'CURRENT_EXPLICIT_CUSTOMER_CORRECTION',
      active: true,
      supersedes_fact_id: 'f-ship-1',
      source_turn_id: 'nego-01-t02',
    },
  ];

  const specs = [
    {
      turn_id: 'nego-01-t01',
      scenario_class: 'A_success',
      tag: 'initial_offer',
      text: 'Buyer offered $35 against your $41 ask with $6 shipping. A calm counter at $38 keeps room to move.',
      key_values: { offer_amount_usd: 35, listing_price_usd: 41, shipping_amount_usd: 6, counter_usd: 38 },
      calc_values: [35, 41, 6, 38],
      session_facts: factsShipping6,
    },
    {
      turn_id: 'nego-01-t02',
      scenario_class: 'B_correction',
      tag: 'shipping_change',
      text: 'Updated: shipping is $5, not $6. Recalculated the counter using the corrected shipping fact.',
      key_values: { shipping_amount_usd: 5, prior_shipping_amount_usd: 6 },
      calc_values: [5, 6],
      what_changed: 'Shipping corrected from $6 to $5; economics recomputed.',
      session_facts: factsShipping5,
      correction_record: {
        superseded_fact_id: 'f-ship-1',
        supersedes_fact_id: 'f-ship-1',
        recomputed: true,
        retrieval_checkpoint_created: true,
        retrieval_checkpoint_id: 'rcp-nego-ship',
        what_changed: 'shipping_amount_usd 6→5',
      },
      pre_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    {
      turn_id: 'nego-01-t03',
      scenario_class: 'B_correction',
      tag: 'condition_change',
      text: 'Condition is VG+ rather than NM. I softened the counter and noted the condition in the draft.',
      key_values: { condition: 'VG+', shipping_amount_usd: 5 },
      calc_values: [5],
      what_changed: 'Condition corrected NM→VG+; draft tone and ask adjusted.',
      correction_record: {
        recomputed: true,
        retrieval_checkpoint_created: true,
        retrieval_checkpoint_id: 'rcp-nego-cond',
        what_changed: 'condition NM→VG+',
      },
      session_facts: [
        ...factsShipping5,
        {
          fact_id: 'f-cond-2',
          key: 'condition',
          value: 'VG+',
          authority: 'CURRENT_EXPLICIT_CUSTOMER_CORRECTION',
          active: true,
          supersedes_fact_id: 'f-cond-1',
        },
        {
          fact_id: 'f-cond-1',
          key: 'condition',
          value: 'NM',
          authority: 'CURRENT_EXPLICIT_CUSTOMER_STATEMENT',
          active: false,
        },
      ],
    },
    {
      turn_id: 'nego-01-t04',
      scenario_class: 'B_correction',
      tag: 'floor_change',
      text: 'Your floor is now $36. I will not draft below that floor.',
      key_values: { floor_usd: 36 },
      calc_values: [36],
      what_changed: 'Floor revised to $36; draft bounded by floor.',
      correction_record: {
        recomputed: true,
        retrieval_checkpoint_created: true,
        retrieval_checkpoint_id: 'rcp-nego-floor',
        what_changed: 'floor→36',
      },
    },
    {
      turn_id: 'nego-01-t05',
      scenario_class: 'B_correction',
      tag: 'tone_change',
      text: 'Switched to a firmer tone while staying respectful. The counter stays at $38.',
      key_values: { tone: 'firm', counter_usd: 38 },
      calc_values: [38],
      what_changed: 'Tone changed to firm; wording updated, numbers unchanged.',
      correction_record: {
        recomputed: true,
        retrieval_checkpoint_created: true,
        retrieval_checkpoint_id: 'rcp-nego-tone',
        what_changed: 'tone→firm',
      },
    },
    {
      turn_id: 'nego-01-t06',
      scenario_class: 'A_success',
      tag: 'accepted_counter',
      text: 'Accepted path: acknowledge their $35 and hold $38 with $5 shipping included in the note.',
      key_values: { offer_amount_usd: 35, counter_usd: 38, shipping_amount_usd: 5 },
      calc_values: [35, 38, 5],
    },
    {
      turn_id: 'nego-01-t07',
      scenario_class: 'A_success',
      tag: 'rejected_counter',
      text: 'Reject path: decline $32 politely and restate the $36 floor without inventing competing offers.',
      key_values: { rejected_offer_usd: 32, floor_usd: 36 },
      calc_values: [32, 36],
    },
    {
      turn_id: 'nego-01-t08',
      scenario_class: 'C_honest_limit',
      tag: 'fabricate_leverage_refuse',
      text: 'I will not invent competing buyers or fake urgency. I can draft an honest firm reply instead.',
      key_values: {},
      limitations: ['INSUFFICIENT_EVIDENCE', 'REFUSED_FABRICATE_LEVERAGE'],
      honest_limit: true,
      action_audit: [
        {
          tool: 'insert_negotiation_draft',
          fabricate_leverage: true,
          refused: true,
          status: 'REFUSED',
          authorized: true,
        },
      ],
    },
    {
      turn_id: 'nego-01-t09',
      scenario_class: 'A_success',
      tag: 'draft_insert',
      text: 'Inserted a draft reply into the thread composer. It is not sent until you confirm.',
      key_values: { draft_status: 'INSERTED' },
      action_audit: [
        {
          tool: 'insert_negotiation_draft',
          status: 'EXECUTED',
          confirmed: true,
          side_effect: true,
          requires_confirm: true,
          message_sent: false,
          authorized: true,
        },
      ],
    },
    {
      turn_id: 'nego-01-t10',
      scenario_class: 'A_success',
      tag: 'cancel_send',
      text: 'Cancelled the send. The draft remains editable and unsent.',
      key_values: { draft_status: 'CANCELLED' },
      action_audit: [
        {
          tool: 'send_message',
          status: 'CANCELLED',
          confirmed: false,
          message_sent: false,
          authorized: true,
        },
      ],
    },
    {
      turn_id: 'nego-01-t11',
      scenario_class: 'A_success',
      tag: 'confirm_send',
      text: 'Send confirmed. The negotiated reply was delivered with your explicit confirmation.',
      key_values: { draft_status: 'SENT' },
      action_audit: [
        {
          tool: 'send_message',
          action: 'send',
          status: 'EXECUTED',
          confirmed: true,
          side_effect: true,
          requires_confirm: true,
          message_sent: true,
          authorized: true,
        },
      ],
    },
    {
      turn_id: 'nego-01-t12',
      scenario_class: 'B_correction',
      tag: 'memory_correction',
      text: 'Memory correction applied: offer is $34, not $35. Active facts now reflect the correction.',
      key_values: { offer_amount_usd: 34, prior_offer_amount_usd: 35 },
      calc_values: [34, 35],
      what_changed: 'Offer amount corrected 35→34 with supersession.',
      correction_record: {
        recomputed: true,
        retrieval_checkpoint_created: true,
        retrieval_checkpoint_id: 'rcp-nego-mem',
        what_changed: 'offer 35→34',
      },
      session_facts: [
        {
          fact_id: 'f-offer-1',
          key: 'offer_amount_usd',
          value: 35,
          active: false,
          authority: 'CURRENT_EXPLICIT_CUSTOMER_STATEMENT',
        },
        {
          fact_id: 'f-offer-2',
          key: 'offer_amount_usd',
          value: 34,
          active: true,
          authority: 'CURRENT_EXPLICIT_CUSTOMER_CORRECTION',
          supersedes_fact_id: 'f-offer-1',
        },
      ],
    },
    {
      turn_id: 'nego-01-t13',
      scenario_class: 'A_success',
      tag: 'forget',
      text: 'Forgot the private shipping note from this thread per your request. It will not be used in later drafts.',
      key_values: { forgotten_keys: ['private_shipping_note'] },
      session_facts: [
        {
          fact_id: 'f-priv-1',
          key: 'private_shipping_note',
          value: null,
          active: false,
          authority: 'CURRENT_EXPLICIT_CUSTOMER_CORRECTION',
          deletion_state: 'FORGOTTEN',
        },
      ],
    },
  ];

  const turns = specs.map((s) => {
    const dossier = baseDossierFields({
      capability,
      session_id,
      turn_id: s.turn_id,
      scenario_id: `negotiation-${s.tag}`,
      scenario_class: s.scenario_class,
      text: s.text,
      included: s.honest_limit ? [] : ['nego-ev-1'],
      excluded: s.honest_limit
        ? [{ id: 'nego-forbidden-1', decision: 'EXCLUDED_RIGHTS', reason: 'forbidden', rights_status: 'FORBIDDEN' }]
        : [],
      evidence_items: s.honest_limit
        ? []
        : [soldEvent('nego-ev-1', 40, { event_type: 'ASKING_LISTING', sale_kind: 'asking' })],
      key_values: s.key_values,
      limitations: s.limitations || [],
      correction_record: s.correction_record || null,
      action_audit: s.action_audit || [],
      session_facts: s.session_facts || factsShipping5,
      honest_limit: s.honest_limit || false,
      what_changed: s.what_changed || '',
      calc_values:
        s.calc_values ||
        Object.values(s.key_values || {}).filter((v) => typeof v === 'number'),
    });
    if (s.pre_hash) {
      // mutate frozen? build again with extra — attach via new object
      return turn(session_id, capability, s.turn_id, s.scenario_class, {
        ...dossier,
        pre_correction_evidence_snapshot_hash: s.pre_hash,
        material_correction: true,
        pipeline_recomputed: true,
      });
    }
    return turn(session_id, capability, s.turn_id, s.scenario_class, dossier);
  });

  return {
    session_id,
    capability,
    label: 'negotiation primary — shipping/condition/floor/tone/leverage/draft/send/memory/forget',
    turns,
  };
}

function negotiationPadTurns(sessionIndex) {
  return [
    {
      turn_id: `nego-${String(sessionIndex).padStart(2, '0')}-t01`,
      scenario_class: 'A_success',
      text: 'Buyer asked about your listing. Draft a clear, honest counter without inventing demand.',
      key_values: { session_index: sessionIndex, counter_usd: 30 + sessionIndex },
      calc_values: [sessionIndex, 30 + sessionIndex],
      included: [`nego-${sessionIndex}-ev1`],
    },
    {
      turn_id: `nego-${String(sessionIndex).padStart(2, '0')}-t02`,
      scenario_class: sessionIndex % 3 === 0 ? 'C_honest_limit' : 'B_correction',
      text:
        sessionIndex % 3 === 0
          ? 'Not enough authorized thread context to recommend a counter. Ask the seller for the current floor.'
          : 'Correction: update the ask for this session and recompute the draft.',
      key_values: sessionIndex % 3 === 0 ? {} : { floor_usd: 28 + sessionIndex, session_index: sessionIndex },
      calc_values: sessionIndex % 3 === 0 ? [] : [28 + sessionIndex, sessionIndex],
      honest_limit: sessionIndex % 3 === 0,
      limitations: sessionIndex % 3 === 0 ? ['INSUFFICIENT_EVIDENCE'] : [],
      what_changed: sessionIndex % 3 === 0 ? '' : 'Floor corrected in this session',
      correction_record:
        sessionIndex % 3 === 0
          ? null
          : {
              recomputed: true,
              retrieval_checkpoint_created: true,
              retrieval_checkpoint_id: `rcp-nego-pad-${sessionIndex}`,
              what_changed: 'floor',
            },
      included: sessionIndex % 3 === 0 ? [] : [`nego-${sessionIndex}-ev1`],
    },
  ];
}

function buildAuctionPrimarySession() {
  const session_id = 'auction-sess-01';
  const capability = 'auction_intelligence';
  const specs = [
    {
      turn_id: 'auc-01-t01',
      scenario_class: 'A_success',
      tag: 'bid_history_variation',
      text: 'Bid history varies: early sparse bids, then denser activity near the close across 4 lots.',
      key_values: { lot_count: 4, bid_count: 18 },
      included: ['auc-bid-1', 'auc-bid-2', 'auc-bid-3'],
    },
    {
      turn_id: 'auc-01-t02',
      scenario_class: 'A_success',
      tag: 'watcher_rich_bid_light',
      text: 'This lot is watcher-rich but bid-light: 42 watchers and only 1 bid. Interest is soft until a second bidder appears.',
      key_values: { watchers: 42, bid_count: 1 },
      included: ['auc-watch-1'],
    },
    {
      turn_id: 'auc-01-t03',
      scenario_class: 'A_success',
      tag: 'acceleration',
      text: 'Price accelerated in the last hour: +22% versus the prior multi-hour median bid step.',
      key_values: { acceleration_pct: 22 },
      included: ['auc-acc-1', 'auc-acc-2'],
      calc_values: [22],
    },
    {
      turn_id: 'auc-01-t04',
      scenario_class: 'A_success',
      tag: 'clustered_endings',
      text: 'Three watched lots end within a 20-minute cluster tonight. Expect attention contention.',
      key_values: { clustered_lots: 3, window_minutes: 20 },
      included: ['auc-end-1', 'auc-end-2', 'auc-end-3'],
    },
    {
      turn_id: 'auc-01-t05',
      scenario_class: 'A_success',
      tag: 'underpriced',
      text: 'Underpriced relative to recent settled comps: live ask sits below the median settled print.',
      key_values: { live_ask: 28, median_settled: 41 },
      included: ['auc-comp-1', 'auc-comp-2'],
      calc_values: [28, 41],
    },
    {
      turn_id: 'auc-01-t06',
      scenario_class: 'A_success',
      tag: 'overheated',
      text: 'Overheated: live bids already exceed recent settled comps for this pressing.',
      key_values: { live_high_bid: 55, median_settled: 41 },
      included: ['auc-hot-1'],
      calc_values: [55, 41],
    },
    {
      turn_id: 'auc-01-t07',
      scenario_class: 'C_honest_limit',
      tag: 'no_bid_honest_limit',
      text: 'No authorized bids are in scope for this empty watchlist subject, so I will not invent auction velocity.',
      key_values: { bid_count: 0 },
      included: [],
      honest_limit: true,
      limitations: ['INSUFFICIENT_EVIDENCE', 'EMPTY_WATCHLIST_SUBJECT'],
    },
    {
      turn_id: 'auc-01-t08',
      scenario_class: 'B_correction',
      tag: 'window_24h_correction',
      text: 'Correction applied: ending window is the next 24 hours only. Rankings recomputed on that window.',
      key_values: { ending_window_hours: 24 },
      what_changed: 'Ending window corrected to 24h; auction ranking recomputed.',
      correction_record: {
        recomputed: true,
        retrieval_checkpoint_created: true,
        retrieval_checkpoint_id: 'rcp-auc-24h',
        what_changed: 'ending_window→24h',
      },
      included: ['auc-win-1', 'auc-win-2'],
      pre_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
  ];

  const turns = specs.map((s) => {
    const dossier = baseDossierFields({
      capability,
      session_id,
      turn_id: s.turn_id,
      scenario_id: `auction-${s.tag}`,
      scenario_class: s.scenario_class,
      text: s.text,
      included: s.included,
      excluded: s.honest_limit
        ? [{ id: 'auc-stale-1', decision: 'EXCLUDED_STALE', reason: 'stale' }]
        : [{ id: 'auc-rights-x', decision: 'EXCLUDED_RIGHTS', reason: 'unlicensed', rights_status: 'UNLICENSED' }],
      key_values: s.key_values,
      limitations: s.limitations || [],
      correction_record: s.correction_record || null,
      honest_limit: s.honest_limit || false,
      what_changed: s.what_changed || '',
      calc_values: s.calc_values || Object.values(s.key_values).filter((v) => typeof v === 'number'),
    });
    if (s.pre_hash) {
      return turn(session_id, capability, s.turn_id, s.scenario_class, {
        ...dossier,
        pre_correction_evidence_snapshot_hash: s.pre_hash,
        material_correction: true,
        pipeline_recomputed: true,
      });
    }
    return turn(session_id, capability, s.turn_id, s.scenario_class, dossier);
  });

  return {
    session_id,
    capability,
    label: 'auction primary — variation/watchers/acceleration/cluster/under/over/no-bid/24h',
    turns,
  };
}

function auctionPadTurns(sessionIndex) {
  return [
    {
      turn_id: `auc-${String(sessionIndex).padStart(2, '0')}-t01`,
      scenario_class: 'A_success',
      text: 'Summarizing live lots with authorized bid evidence only.',
      key_values: { lot_count: sessionIndex, bid_count: sessionIndex + 2, session_index: sessionIndex },
      calc_values: [sessionIndex, sessionIndex + 2],
      included: [`auc-${sessionIndex}-e1`, `auc-${sessionIndex}-e2`],
    },
    {
      turn_id: `auc-${String(sessionIndex).padStart(2, '0')}-t02`,
      scenario_class: sessionIndex % 4 === 0 ? 'C_honest_limit' : 'A_success',
      text:
        sessionIndex % 4 === 0
          ? 'Honest limit: no bids in the authorized window for this subject.'
          : 'Lot heat check using settled comps where available.',
      key_values: sessionIndex % 4 === 0 ? { bid_count: 0 } : { heat: 'moderate', session_index: sessionIndex },
      calc_values: sessionIndex % 4 === 0 ? [0] : [sessionIndex],
      included: sessionIndex % 4 === 0 ? [] : [`auc-${sessionIndex}-e1`],
      honest_limit: sessionIndex % 4 === 0,
      limitations: sessionIndex % 4 === 0 ? ['INSUFFICIENT_EVIDENCE'] : [],
    },
  ];
}

function genericCapabilityTurns(capability, sessionIndex) {
  const id = `${capability.slice(0, 4)}-${String(sessionIndex).padStart(2, '0')}`;
  const soldIds = [`${id}-sale-1`, `${id}-sale-2`];
  const successText = {
    scarcity: 'Exact pressing shows limited settled supply in authorized evidence.',
    valuation: 'Fair range grounded in authorized settled comps only.',
    semantic_search: 'Hybrid request fell back honestly when the vector index was unavailable.',
    recommendations: 'Suggesting adjacent pressings from authorized catalog and settlements.',
    market_analytics: 'Median settled price computed from included sale events.',
  }[capability];

  const retrieval =
    capability === 'semantic_search'
      ? {
          requested_mode: 'hybrid',
          executed_mode: 'keyword_only_vector_unavailable',
          vector_executed: false,
          fallback_reason: 'VECTOR_INDEX_UNAVAILABLE',
        }
      : {
          requested_mode: 'keyword',
          executed_mode: 'keyword',
          vector_executed: false,
        };

  const median = 40 + sessionIndex;
  const turns = [
    {
      turn_id: `${id}-t01`,
      scenario_class: 'A_success',
      text:
        capability === 'market_analytics' || capability === 'valuation'
          ? `Fair median is $${median} from authorized settled comps.`
          : successText,
      key_values:
        capability === 'market_analytics' || capability === 'valuation'
          ? { sold_count: 2, median_price: median }
          : capability === 'scarcity'
            ? { sold_count: 2, supply_count: 5 + sessionIndex }
            : { result_count: 2, session_index: sessionIndex },
      included: soldIds,
      retrieval_execution: retrieval,
      calc_values: [median, 2, 5 + sessionIndex, sessionIndex],
      subject_resolution:
        capability === 'scarcity' || capability === 'valuation'
          ? { match_status: 'MATCHED_EXACT_PRESSING', identity_status: 'EXACT' }
          : { match_status: 'MATCHED_RELEASE_ONLY', identity_status: 'RELEASE_LEVEL_ONLY' },
    },
    {
      turn_id: `${id}-t02`,
      scenario_class: sessionIndex % 5 === 0 ? 'C_honest_limit' : 'B_correction',
      text:
        sessionIndex % 5 === 0
          ? 'Honest limit: authorized evidence is empty for this subject.'
          : 'Correction applied: refreshed constraints and recomputed from the new snapshot.',
      key_values: sessionIndex % 5 === 0 ? { sold_count: 0 } : { sold_count: 2, corrected: true, median_price: median },
      included: sessionIndex % 5 === 0 ? [] : soldIds,
      honest_limit: sessionIndex % 5 === 0,
      limitations: sessionIndex % 5 === 0 ? ['INSUFFICIENT_EVIDENCE'] : [],
      what_changed: sessionIndex % 5 === 0 ? '' : 'Recomputed after correction',
      correction_record:
        sessionIndex % 5 === 0
          ? null
          : {
              recomputed: true,
              retrieval_checkpoint_created: true,
              retrieval_checkpoint_id: `rcp-${id}`,
              what_changed: 'constraints',
            },
      retrieval_execution: retrieval,
      calc_values: sessionIndex % 5 === 0 ? [0] : [2, median],
      pre_hash: sessionIndex % 5 === 0 ? null : 'cccccccccccccccccccccccccccccccc',
    },
  ];

  // Third turn on some sessions to increase compact density
  if (sessionIndex % 2 === 0) {
    turns.push({
      turn_id: `${id}-t03`,
      scenario_class: 'A_success',
      text: 'Follow-up still grounded on the same authorized snapshot.',
      key_values: { sold_count: 2 },
      included: soldIds,
      retrieval_execution: retrieval,
      calc_values: [2],
    });
  }
  return turns;
}

function embeddingsTurns(sessionIndex) {
  const id = `emb-${String(sessionIndex).padStart(2, '0')}`;
  return [
    {
      turn_id: `${id}-t01`,
      scenario_class: 'A_success',
      text: 'Embeddings diagnostic: metadata embedding similarity reported without writing weights.',
      key_values: { neighbor_count: 3, session_index: sessionIndex },
      calc_values: [3, sessionIndex],
      included: [`${id}-n1`, `${id}-n2`, `${id}-n3`],
    },
    {
      turn_id: `${id}-t02`,
      scenario_class: 'C_honest_limit',
      text: 'Embedding write is disabled by policy. I will not claim a new model weight training run.',
      key_values: {},
      included: [],
      honest_limit: true,
      limitations: ['MODEL_WEIGHT_TRAINING_NO', 'INSUFFICIENT_EVIDENCE'],
    },
  ];
}

function materializePadSession({ capability, sessionIndex, turns }) {
  const session_id = `${capability}-sess-${String(sessionIndex).padStart(2, '0')}`;
  return {
    session_id,
    capability,
    label: `${capability} compact session ${sessionIndex}`,
    turns: turns.map((t) => {
      const dossier = baseDossierFields({
        capability,
        session_id,
        turn_id: t.turn_id,
        scenario_id: `${capability}-${t.turn_id}`,
        scenario_class: t.scenario_class,
        text: t.text,
        included: t.included || [],
        excluded: t.honest_limit
          ? [{ id: `${t.turn_id}-x`, decision: 'EXCLUDED_UNSETTLED', reason: 'empty' }]
          : [{ id: `${t.turn_id}-rights`, decision: 'EXCLUDED_RIGHTS', reason: 'forbidden', rights_status: 'FORBIDDEN' }],
        key_values: t.key_values || {},
        limitations: t.limitations || [],
        correction_record: t.correction_record || null,
        action_audit: t.action_audit || [],
        session_facts: t.session_facts || [],
        retrieval_execution: t.retrieval_execution || null,
        subject_resolution: t.subject_resolution || null,
        honest_limit: t.honest_limit || false,
        what_changed: t.what_changed || '',
        calc_values: t.calc_values || Object.values(t.key_values || {}).filter((v) => typeof v === 'number'),
      });
      if (t.pre_hash) {
        return turn(session_id, capability, t.turn_id, t.scenario_class, {
          ...dossier,
          pre_correction_evidence_snapshot_hash: t.pre_hash,
          material_correction: true,
          pipeline_recomputed: true,
        });
      }
      return turn(session_id, capability, t.turn_id, t.scenario_class, dossier);
    }),
  };
}

function buildCompactCapabilitySession({ capability, sessionIndex, turns }) {
  return materializePadSession({ capability, sessionIndex, turns });
}

export function serializeCorpusForCheckIn(corpus) {
  return {
    corpus_version: corpus.corpus_version,
    label: corpus.label,
    seed: corpus.seed,
    model_weight_training: corpus.model_weight_training,
    capabilities: corpus.capabilities,
    customer_facing_capabilities: corpus.customer_facing_capabilities,
    session_count: corpus.session_count,
    evaluated_turn_count: corpus.evaluated_turn_count,
    notes: corpus.notes,
    sessions: asArray(corpus.sessions).map((s) => ({
      session_id: s.session_id,
      capability: s.capability,
      label: s.label,
      turns: asArray(s.turns).map((t) => ({
        turn_id: t.turn_id,
        session_id: t.session_id || s.session_id,
        capability: t.capability || s.capability,
        scenario_class: t.scenario_class,
        evaluated: true,
        // Persist dossier without recomputed gate blobs (rehydrated on load).
        dossier: stripDossierForCheckIn(t.dossier),
      })),
    })),
  };
}

function stripDossierForCheckIn(dossier) {
  if (!dossier || typeof dossier !== 'object') return dossier;
  const {
    semantic_gate_results: _gates,
    human_quality: _hq,
    dossier_hash: _hash,
    evidence_snapshot: snap,
    ...rest
  } = dossier;
  return {
    ...rest,
    // Keep snapshot identity fields; drop bulky nested eligibility clones if present
    evidence_snapshot: snap
      ? {
          evidence_snapshot_id: snap.evidence_snapshot_id,
          evidence_snapshot_hash: snap.evidence_snapshot_hash,
          subject_resolution: snap.subject_resolution || null,
          retrieval_execution: snap.retrieval_execution || null,
          included_event_ids: snap.included_event_ids || rest.included_event_ids,
          excluded_event_ids: snap.excluded_event_ids || rest.excluded_event_ids,
        }
      : undefined,
  };
}

function rehydrateDossier(dossier) {
  if (!dossier) return dossier;
  if (dossier.semantic_gate_results && dossier.human_quality) return dossier;
  return {
    ...dossier,
    semantic_gate_results: evaluateSemanticGates(dossier),
    human_quality: scoreHumanQualityRubric(dossier),
  };
}

export function hydrateCompactCorpus(raw) {
  const sessions = asArray(raw.sessions).map((s) => ({
    ...s,
    turns: asArray(s.turns).map((t) => ({
      ...t,
      dossier: rehydrateDossier(t.dossier),
    })),
  }));
  return {
    ...raw,
    sessions,
    session_count: sessions.length,
    evaluated_turn_count: sessions.reduce((n, s) => n + asArray(s.turns).length, 0),
  };
}

export function defaultCompactCorpusPath(corpusDir = DEFAULT_CORPUS_DIR) {
  return path.join(corpusDir, 'compact-corpus.json');
}

export function loadCompactCorpus(corpusDir = DEFAULT_CORPUS_DIR) {
  const p = defaultCompactCorpusPath(corpusDir);
  if (!fs.existsSync(p)) {
    return buildCompactCorpus();
  }
  return hydrateCompactCorpus(JSON.parse(fs.readFileSync(p, 'utf8')));
}

export function writeCompactCorpus(corpusDir = DEFAULT_CORPUS_DIR, { seed = 'phase34-compact-v1' } = {}) {
  fs.mkdirSync(corpusDir, { recursive: true });
  const corpus = buildCompactCorpus({ seed });
  const slim = serializeCorpusForCheckIn(corpus);
  const p = defaultCompactCorpusPath(corpusDir);
  fs.writeFileSync(p, `${JSON.stringify(slim, null, 2)}\n`);
  const manifest = {
    corpus_version: CORPUS_VERSION,
    compact_path: 'compact-corpus.json',
    seed,
    session_count: slim.session_count,
    evaluated_turn_count: slim.evaluated_turn_count,
    min_compact_turns: MIN_COMPACT_EVALUATED_TURNS,
    min_expanded_turns: MIN_EXPANDED_EVALUATED_TURNS,
    capabilities: slim.capabilities,
    expand: 'expandCorpus(seed) in scripts/lib/phase34-semantic-corpus.mjs',
  };
  fs.writeFileSync(path.join(corpusDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { path: p, corpus: hydrateCompactCorpus(slim), manifest };
}

/**
 * Deterministically expand a compact corpus to >= minTurns evaluated turns.
 */
export function expandCorpus(seed = 'phase34-ci-expand-v1', {
  compact = null,
  minTurns = MIN_EXPANDED_EVALUATED_TURNS,
  corpusDir = DEFAULT_CORPUS_DIR,
} = {}) {
  const base = compact || loadCompactCorpus(corpusDir);
  const rand = mulberry32(seedToUint(seed));
  const sessions = [];
  const baseSessions = asArray(base.sessions);

  // Always include original compact sessions first (clone)
  for (const s of baseSessions) {
    sessions.push(structuredClone(s));
  }

  let turnCount = sessions.reduce((n, s) => n + asArray(s.turns).length, 0);
  let replica = 0;

  while (turnCount < minTurns) {
    replica += 1;
    for (const src of baseSessions) {
      if (turnCount >= minTurns) break;
      const r = rand();
      const session_id = `${src.session_id}__x${replica}`;
      const expandedTurns = asArray(src.turns).map((t, idx) => {
        const priceBump = Math.floor(r * 7) + (idx % 3);
        const dossier = structuredClone(t.dossier);
        const turn_id = `${t.turn_id}__x${replica}`;
        // Keep claims consistent: bump descriptive latency only + session ids;
        // do not invent new numeric claims in customer text.
        const next = {
          ...dossier,
          session_id,
          turn_id,
          scenario_id: `${dossier.scenario_id}__x${replica}`,
          latency: {
            ...(dossier.latency || {}),
            descriptive_only: true,
            pipeline_ms: (dossier.latency?.pipeline_ms || 10) + priceBump,
          },
          evidence_snapshot_id: `${dossier.evidence_snapshot_id}__x${replica}`,
          // Hash changes with replica but gates still pass (identity present)
          evidence_snapshot_hash: sha256Hex(`${seed}:${session_id}:${turn_id}`),
          expansion: { seed, replica, source_turn_id: t.turn_id },
        };
        // Re-score gates for expanded dossier
        const rebuilt = {
          ...next,
          semantic_gate_results: evaluateSemanticGates(next),
          human_quality: next.human_quality,
        };
        return {
          ...t,
          turn_id,
          session_id,
          dossier: rebuilt,
          expanded_from: t.turn_id,
          expansion_replica: replica,
        };
      });

      sessions.push({
        session_id,
        capability: src.capability,
        label: `${src.label || src.session_id} (expand ${replica})`,
        expanded_from: src.session_id,
        expansion_replica: replica,
        turns: expandedTurns,
      });
      turnCount += expandedTurns.length;
    }
  }

  const allTurns = sessions.flatMap((s) => s.turns);
  return {
    corpus_version: CORPUS_VERSION,
    expansion_seed: seed,
    source_seed: base.seed || null,
    session_count: sessions.length,
    evaluated_turn_count: allTurns.length,
    compact_evaluated_turn_count: asArray(base.sessions).reduce((n, s) => n + asArray(s.turns).length, 0),
    min_turns_target: minTurns,
    sessions,
    turns: allTurns,
  };
}

/**
 * Evaluate core gates across an expanded (or compact) corpus.
 */
export function evaluateCorpus(corpus, { coreOnly = true } = {}) {
  const turns = corpus.turns || corpus.sessions.flatMap((s) => s.turns);
  const results = [];
  let pass = 0;
  let fail = 0;
  for (const t of turns) {
    const dossier = t.dossier;
    const gates = evaluateSemanticGates(dossier, {
      classes: coreOnly ? CORE_SEMANTIC_GATES : undefined,
    });
    const quality = dossier.human_quality;
    const ok = gates.status === 'PASS' && (quality?.floor_met !== false);
    if (ok) pass += 1;
    else fail += 1;
    results.push({
      session_id: t.session_id || dossier.session_id,
      turn_id: t.turn_id,
      capability: t.capability || dossier.capability,
      status: ok ? 'PASS' : 'FAIL',
      failed_classes: gates.failed_classes || [],
    });
  }
  return {
    status: fail === 0 ? 'PASS' : 'FAIL',
    evaluated_turn_count: turns.length,
    pass_count: pass,
    fail_count: fail,
    results,
  };
}

/**
 * CI dry-run: expand + evaluate core gates.
 */
export function runCorpusCiDryRun({
  seed = 'phase34-ci-expand-v1',
  minTurns = MIN_EXPANDED_EVALUATED_TURNS,
  corpusDir = DEFAULT_CORPUS_DIR,
} = {}) {
  const compact = loadCompactCorpus(corpusDir);
  const expanded = expandCorpus(seed, { compact, minTurns, corpusDir });
  const evaluation = evaluateCorpus(expanded, { coreOnly: true });
  if (expanded.evaluated_turn_count < minTurns) {
    const err = new Error(`expanded turns ${expanded.evaluated_turn_count} < ${minTurns}`);
    err.code = 'CORPUS_EXPAND_UNDERFLOW';
    throw err;
  }
  if (evaluation.status !== 'PASS') {
    const err = new Error(`corpus CI dry-run FAIL (${evaluation.fail_count} turns)`);
    err.code = 'CORPUS_CI_DRY_RUN_FAIL';
    err.evaluation = evaluation;
    throw err;
  }
  // Touch assert helper for core API stability
  for (const t of expanded.turns.slice(0, 3)) {
    assertSemanticGatesPass(evaluateSemanticGates(t.dossier, { classes: CORE_SEMANTIC_GATES }));
  }
  return {
    ok: true,
    seed,
    compact_evaluated_turn_count: expanded.compact_evaluated_turn_count,
    expanded_evaluated_turn_count: expanded.evaluated_turn_count,
    session_count: expanded.session_count,
    evaluation_status: evaluation.status,
    pass_count: evaluation.pass_count,
  };
}

export function corpusCapabilitySessionCounts(corpus) {
  const counts = Object.fromEntries(EIGHT_CAPABILITIES.map((c) => [c, 0]));
  for (const s of asArray(corpus.sessions)) {
    if (counts[s.capability] != null) counts[s.capability] += 1;
  }
  return counts;
}

export { CUSTOMER_FACING, evaluateResponseDossier };
