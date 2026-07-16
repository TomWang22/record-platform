/**
 * Phase 33F canonical cross-protocol capability-gauntlet manifest.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const CAPABILITIES = [
  'scarcity',
  'valuation',
  'auction_intelligence',
  'embeddings',
  'semantic_search',
  'negotiation_assistance',
  'recommendations',
  'market_analytics',
];

export const PROTOCOLS = ['h1', 'h2', 'h3'];

export const CAPABILITY_MODES = {
  scarcity: ['exact_pressing', 'release_level', 'low_data', 'stale_only', 'contradictory_evidence'],
  valuation: [
    'exact_pressing',
    'broad_release',
    'quick_sale',
    'patient_sale',
    'condition_adjusted',
    'currency_normalized',
    'weak_comparables',
  ],
  auction_intelligence: [
    'single_auction',
    'watchlist_temperature',
    'late_bid_pressure',
    'closing_cluster',
    'low_sample',
    'stale_auction',
  ],
  embeddings: [
    'lineage_validation',
    'version_validation',
    'deletion_state',
    'reembedding_required',
    'authorization_scope',
    'content_hash',
  ],
  semantic_search: [
    'keyword',
    'semantic_fixture_or_staging',
    'hybrid_fixture_or_staging',
    'exact_pressing',
    'misspelling',
    'abbreviation',
    'metadata_contradiction',
    'private_scope',
    'deleted_source',
  ],
  negotiation_assistance: [
    'buyer',
    'seller',
    'counteroffer',
    'correction',
    'weak_evidence',
    'safety_refusal',
    'unauthorized_thread',
    'deleted_message',
  ],
  recommendations: [
    'similar_release',
    'collection_gap',
    'budget_opportunity',
    'auction_watch',
    'condition_upgrade',
    'seller_restock',
    'sell_hold_watch',
    'diversification',
    'cold_start',
    'zero_candidate',
  ],
  market_analytics: [
    'release_summary',
    'pressing_summary',
    'price_distribution',
    'liquidity',
    'auction_trend',
    'watchlist_report',
    'seller_inventory',
    'collection_report',
    'temperature_history',
  ],
};

const PRIVATE_FIELD_RE =
  /(\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b)|([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})|(Bearer\s+[A-Za-z0-9._-]+)|(sk-[A-Za-z0-9]{20,})/i;

const REQUIRED_FIELDS = [
  'scenario_id',
  'probe_id',
  'batch_id',
  'capability',
  'capability_mode',
  'schema_version',
  'participant_side',
  'principal_fixture',
  'authorization_scopes',
  'prohibited_scopes',
  'conversation_or_session_id',
  'turns',
  'memory_classes',
  'request',
  'expected_behavior',
  'expected_schema',
  'expected_evidence',
  'expected_limitations',
  'expected_abstention',
  'expected_safety',
  'expected_ranking_or_retrieval',
  'expected_privacy',
  'expected_freshness',
  'protocol',
  'seed',
  'run',
  'gate',
  'production_mutation_allowed',
  'fixture_sources',
];

export function buildCanaryManifest({ batchesPerCapability = 30 } = {}) {
  const rows = [];
  let batchOrdinal = 0;
  // Tag/mode pattern unit matches the 30-batch canary so N=k*30 preserves shares.
  const PATTERN_UNIT = 30;
  for (const capability of CAPABILITIES) {
    const modes = CAPABILITY_MODES[capability];
    for (let i = 0; i < batchesPerCapability; i += 1) {
      batchOrdinal += 1;
      const patternIndex = i % PATTERN_UNIT;
      const mode = modes[patternIndex % modes.length];
      const batch_id = `batch_${String(batchOrdinal).padStart(4, '0')}_${capability}`;
      const multiTurn = patternIndex % 4 === 0;
      const adversarial = patternIndex % 5 === 0;
      const weakData = patternIndex % 5 === 1;
      const exactPressing = patternIndex % 5 === 2;
      const tile = Math.floor(i / PATTERN_UNIT);
      for (const protocol of PROTOCOLS) {
        const seed = 33000 + batchOrdinal * 10 + PROTOCOLS.indexOf(protocol);
        const probe_id = `${batch_id}_${protocol}`;
        // Keep tile-0 scenario_id identical to the frozen 30-batch canary contract.
        const scenario_id =
          tile === 0
            ? `${capability}_${mode}_${String(patternIndex).padStart(2, '0')}`
            : `${capability}_${mode}_${String(patternIndex).padStart(2, '0')}_t${tile}`;
        rows.push({
          scenario_id,
          probe_id,
          batch_id,
          capability,
          capability_mode: mode,
          schema_version: `phase33f-${capability}-1`,
          participant_side: capability === 'negotiation_assistance' ? (patternIndex % 2 ? 'seller' : 'buyer') : 'owner',
          principal_fixture: adversarial ? 'principal_a' : 'principal_a',
          authorization_scopes: adversarial
            ? ['authenticated_market']
            : ['authenticated_market', 'owner_private_fixture'],
          prohibited_scopes: ['cross_user_private', 'production_write'],
          conversation_or_session_id: multiTurn ? `session_${batch_id}` : null,
          turns: multiTurn ? 3 : 1,
          memory_classes: multiTurn ? ['session', 'conversation_only'] : ['conversation_only'],
          request: {
            capability,
            mode,
            fixture_band: 'development',
            retrieval_mode:
              capability === 'semantic_search'
                ? mode.includes('hybrid')
                  ? 'hybrid_fixture'
                  : mode.includes('semantic')
                    ? 'semantic_fixture'
                    : 'keyword'
                : 'keyword_metadata',
          },
          expected_behavior: weakData ? 'abstain_or_limit' : 'grounded_structured_result',
          expected_schema: `intelligence-output-schemas/${capability === 'auction_intelligence' ? 'auction-intelligence' : capability === 'semantic_search' ? 'semantic-search' : capability === 'negotiation_assistance' ? 'negotiation-assistance' : capability === 'market_analytics' ? 'market-analytics' : capability === 'embeddings' ? 'embedding-metadata' : capability}.schema.json`,
          expected_evidence: true,
          expected_limitations: true,
          expected_abstention: { may_abstain: weakData || adversarial },
          expected_safety: {
            automatic_send_allowed: false,
            production_mutation_allowed: false,
          },
          expected_ranking_or_retrieval: capability === 'recommendations' || capability === 'semantic_search',
          expected_privacy: { cross_user_leakage: 0 },
          expected_freshness: exactPressing ? 'exact_or_labeled' : 'labeled_ok',
          protocol,
          seed,
          run: 1,
          gate: protocol,
          production_mutation_allowed: false,
          fixture_sources: ['phase33b-retrieval-corpus', 'phase33c-scenarios', 'phase33d-scenarios', 'phase33e-scenarios'],
          tags: {
            multi_turn: multiTurn,
            privacy_adversarial: adversarial,
            weak_or_stale: weakData,
            exact_pressing: exactPressing,
          },
        });
      }
    }
  }
  return rows;
}

export function validateManifestRows(rows, options = {}) {
  const violations = [];
  if (!Array.isArray(rows) || rows.length === 0) return ['empty_manifest'];

  const batchesPerCapability = options.batchesPerCapability ?? 30;
  const expectedBatches = options.expectedBatches ?? batchesPerCapability * CAPABILITIES.length;
  const expectedProbes = options.expectedProbes ?? expectedBatches * PROTOCOLS.length;
  const expectedPerCapability = batchesPerCapability * PROTOCOLS.length;
  const expectedPerProtocol = expectedBatches;

  const probeIds = new Set();
  const coords = new Set();
  let multiTurn = 0;
  let adversarial = 0;
  let weak = 0;
  let exact = 0;
  const perCap = Object.fromEntries(CAPABILITIES.map((c) => [c, 0]));
  const perProto = { h1: 0, h2: 0, h3: 0 };

  for (const row of rows) {
    for (const f of REQUIRED_FIELDS) {
      if (!(f in row)) violations.push(`missing_field:${row.probe_id || '?'}:${f}`);
    }
    if (!CAPABILITIES.includes(row.capability)) violations.push(`unknown_capability:${row.capability}`);
    const modes = CAPABILITY_MODES[row.capability] || [];
    if (!modes.includes(row.capability_mode)) {
      violations.push(`unknown_mode:${row.capability}:${row.capability_mode}`);
    }
    if (!PROTOCOLS.includes(row.protocol)) violations.push(`unknown_protocol:${row.protocol}`);
    if (row.production_mutation_allowed !== false) {
      violations.push(`production_mutation_allowed:${row.probe_id}`);
    }
    if (row.expected_safety?.automatic_send_allowed !== false) {
      violations.push(`automatic_send_allowed:${row.probe_id}`);
    }
    if (!row.authorization_scopes?.length) violations.push(`missing_authorization_scope:${row.probe_id}`);
    if (!row.schema_version) violations.push(`missing_schema_version:${row.probe_id}`);
    if (!row.expected_behavior) violations.push(`missing_expected_behavior:${row.probe_id}`);

    const blob = JSON.stringify(row);
    if (PRIVATE_FIELD_RE.test(blob)) violations.push(`private_field:${row.probe_id}`);

    if (probeIds.has(row.probe_id)) violations.push(`duplicate_probe_id:${row.probe_id}`);
    probeIds.add(row.probe_id);
    const coord = `${row.batch_id}|${row.protocol}|${row.seed}|${row.run}`;
    if (coords.has(coord)) violations.push(`duplicate_coordinate:${coord}`);
    coords.add(coord);

    if (row.tags?.multi_turn) multiTurn += 1;
    if (row.tags?.privacy_adversarial) adversarial += 1;
    if (row.tags?.weak_or_stale) weak += 1;
    if (row.tags?.exact_pressing) exact += 1;
    if (perCap[row.capability] != null) perCap[row.capability] += 1;
    if (perProto[row.protocol] != null) perProto[row.protocol] += 1;
  }

  const batches = rows.length / 3;
  if (rows.length !== expectedProbes) {
    violations.push(`probe_count:${rows.length}:expected_${expectedProbes}`);
  }
  if (batches !== expectedBatches) {
    violations.push(`batch_count:${batches}:expected_${expectedBatches}`);
  }
  for (const c of CAPABILITIES) {
    if (perCap[c] !== expectedPerCapability) {
      violations.push(`capability_probe_allocation:${c}:${perCap[c]}`);
    }
  }
  for (const p of PROTOCOLS) {
    if (perProto[p] !== expectedPerProtocol) {
      violations.push(`protocol_allocation:${p}:${perProto[p]}`);
    }
  }

  const batchCount = new Set(rows.map((r) => r.batch_id)).size;
  const multiTurnBatchShare = rows.filter((r) => r.tags?.multi_turn).length / rows.length;
  const advShare = adversarial / rows.length;
  const weakShare = weak / rows.length;
  const exactShare = exact / rows.length;
  if (multiTurnBatchShare < 0.25) violations.push(`multi_turn_share_low:${multiTurnBatchShare}`);
  if (advShare < 0.2) violations.push(`adversarial_share_low:${advShare}`);
  if (weakShare < 0.2) violations.push(`weak_data_share_low:${weakShare}`);
  if (exactShare < 0.2) violations.push(`exact_pressing_share_low:${exactShare}`);

  return {
    violations,
    status: violations.length ? 'FAIL' : 'PASS',
    summary: {
      probes: rows.length,
      batches: batchCount,
      per_capability_probes: perCap,
      per_protocol: perProto,
      multi_turn_share: multiTurnBatchShare,
      adversarial_share: advShare,
      weak_data_share: weakShare,
      exact_pressing_share: exactShare,
      expected_probes: expectedProbes,
      expected_batches: expectedBatches,
      batches_per_capability: batchesPerCapability,
    },
  };
}

export function hashManifest(rows) {
  const canonical = JSON.stringify(rows);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function loadManifest(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const rows = Array.isArray(raw) ? raw : raw.probes || raw.rows || [];
  return { raw, rows };
}

export function writeManifest(filePath, rows, { batchesPerCapability = 30 } = {}) {
  const manifest_sha = hashManifest(rows);
  const body = {
    phase: '33F',
    kind: 'capability_gauntlet_canary_manifest',
    total_probes: rows.length,
    triplet_batches: rows.length / 3,
    batches_per_capability: batchesPerCapability,
    protocols: PROTOCOLS,
    capabilities: CAPABILITIES,
    production_mutation_allowed: false,
    automatic_send_allowed: false,
    manifest_sha,
    probes: rows,
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  return body;
}
