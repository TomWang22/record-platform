/**
 * Phase 34 full response dossier validators, markdown render, quality scoring.
 * Synthetic / offline only — does not launch live owner-proof.
 */

export const DOSSIER_JSON_REQUIRED_FIELDS = Object.freeze([
  'scenario_id',
  'session_id',
  'turn_id',
  'participant_side',
  'visible_user_prompt',
  'context_summary',
  'subject_identity',
  'evidence_snapshot_id',
  'evidence_snapshot_hash',
  'full_response_text',
  'direct_answer',
  'reasoning_summary',
  'key_values',
  'what_changed',
  'evidence_items',
  'claim_evidence_map',
  'uncertainties',
  'limitations',
  'next_action',
  'editable_draft',
  'word_count',
  'character_count',
  'input_token_estimate',
  'output_token_estimate',
  'response_mode',
  'browser_latency',
  'pipeline_latency',
  'H1_status',
  'H2_status',
  'H3_status',
  'protocol_parity',
  'quality_scores',
  'human_review_status',
]);

export const QUALITY_SCORE_DIMENSIONS = Object.freeze([
  'question_directness',
  'grounded_factuality',
  'record_market_specificity',
  'pressing_correctness',
  'evidence_alignment',
  'explanation_quality',
  'usefulness',
  'uncertainty_calibration',
  'correction_handling',
  'context_retention',
  'actionability',
  'customer_language',
  'safety',
  'privacy',
  'non_repetition',
]);

function fail(code, msg) {
  const err = new Error(msg);
  err.code = code;
  throw err;
}

function isPresent(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return true;
  if (Array.isArray(value)) return true;
  if (typeof value === 'object') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  return false;
}

/**
 * Validate a response dossier JSON object against plan section 10 fields.
 * @returns {{ ok: true, scenario_id: string }}
 */
export function validateResponseDossier(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    fail('DOSSIER_INVALID', 'dossier must be a plain object');
  }
  for (const field of DOSSIER_JSON_REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(json, field) || !isPresent(json[field])) {
      // editable_draft / what_changed may be empty string for non-negotiation / non-correction
      if (
        (field === 'editable_draft' || field === 'what_changed') &&
        Object.prototype.hasOwnProperty.call(json, field) &&
        (json[field] === '' || json[field] === null)
      ) {
        continue;
      }
      fail('DOSSIER_MISSING_FIELD', `missing required dossier field: ${field}`);
    }
  }
  if (!['COMPACT', 'STANDARD', 'DEEP', 'CONVERSATIONAL'].includes(json.response_mode)) {
    fail('DOSSIER_INVALID_MODE', `invalid response_mode: ${json.response_mode}`);
  }
  if (!Array.isArray(json.evidence_items)) {
    fail('DOSSIER_INVALID', 'evidence_items must be an array');
  }
  if (!json.claim_evidence_map || typeof json.claim_evidence_map !== 'object') {
    fail('DOSSIER_INVALID', 'claim_evidence_map must be an object');
  }
  if (!json.quality_scores || typeof json.quality_scores !== 'object') {
    fail('DOSSIER_INVALID', 'quality_scores must be an object');
  }
  return { ok: true, scenario_id: json.scenario_id };
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

function formatEvidence(items) {
  if (!Array.isArray(items) || items.length === 0) return '_None recorded._';
  return items
    .map((item, i) => {
      if (typeof item === 'string') return `${i + 1}. ${item}`;
      const id = item.id || item.evidence_id || `item-${i + 1}`;
      const summary = item.summary || item.text || item.title || JSON.stringify(item);
      return `${i + 1}. **${id}** — ${summary}`;
    })
    .join('\n');
}

function formatKeyValues(kv) {
  if (kv == null) return '_None._';
  if (typeof kv === 'string') return kv;
  if (Array.isArray(kv)) {
    return kv.map((row) => `- ${typeof row === 'string' ? row : JSON.stringify(row)}`).join('\n');
  }
  return Object.entries(kv)
    .map(([k, v]) => `- **${k}**: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n');
}

/**
 * Render a human-readable Markdown dossier (non-engineer readable).
 */
export function renderResponseDossierMarkdown(json) {
  validateResponseDossier(json);
  const latency = [
    `- Browser: ${json.browser_latency ?? 'n/a'}`,
    `- Pipeline: ${json.pipeline_latency ?? 'n/a'}`,
  ].join('\n');
  const tech = [
    `- Scenario: \`${json.scenario_id}\``,
    `- Session: \`${json.session_id}\``,
    `- Turn: \`${json.turn_id}\``,
    `- Participant: ${json.participant_side}`,
    `- Evidence snapshot: \`${json.evidence_snapshot_id}\` (\`${json.evidence_snapshot_hash}\`)`,
    `- Response mode: ${json.response_mode}`,
    `- Tokens (in/out est.): ${json.input_token_estimate} / ${json.output_token_estimate}`,
    `- Words / chars: ${json.word_count} / ${json.character_count}`,
    `- H1/H2/H3: ${json.H1_status} / ${json.H2_status} / ${json.H3_status}`,
    `- Protocol parity: ${json.protocol_parity}`,
    `- Human review: ${json.human_review_status}`,
  ].join('\n');

  const why =
    json.reasoning_summary ||
    (typeof json.why === 'string' ? json.why : '_No reasoning summary provided._');

  return [
    `# Response dossier — ${json.scenario_id}`,
    '',
    '## User asked',
    '',
    String(json.visible_user_prompt || ''),
    '',
    '## Context used',
    '',
    String(json.context_summary || ''),
    '',
    '## AI answered',
    '',
    String(json.direct_answer || ''),
    '',
    '## Key values',
    '',
    formatKeyValues(json.key_values),
    '',
    '## Why',
    '',
    String(why),
    '',
    '## Evidence',
    '',
    formatEvidence(json.evidence_items),
    '',
    '## Uncertainty',
    '',
    asList(json.uncertainties)
      .map((u) => `- ${u}`)
      .join('\n') || '_None recorded._',
    '',
    '## What changed',
    '',
    String(json.what_changed || '_No correction or change recorded._'),
    '',
    '## Next action',
    '',
    String(json.next_action || ''),
    '',
    '## Full response',
    '',
    String(json.full_response_text || ''),
    '',
    '## Latency',
    '',
    latency,
    '',
    '## Technical details',
    '',
    tech,
    '',
  ].join('\n');
}

/**
 * Require every visible user message and full AI response, in order.
 * @param {{ turns: Array<{ role: string, text?: string, content?: string, full_response_text?: string }> }} input
 */
export function validateNegotiationTranscript({ turns } = {}) {
  if (!Array.isArray(turns) || turns.length === 0) {
    fail('NEGOTIATION_TRANSCRIPT_INVALID', 'turns must be a non-empty array');
  }
  let expectUser = true;
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (!turn || typeof turn !== 'object') {
      fail('NEGOTIATION_TRANSCRIPT_INVALID', `turn ${i} must be an object`);
    }
    const role = String(turn.role || '').toLowerCase();
    const text = String(
      turn.text ?? turn.content ?? turn.full_response_text ?? turn.visible_user_prompt ?? '',
    ).trim();
    if (!text) {
      fail('NEGOTIATION_TRANSCRIPT_INVALID', `turn ${i} missing visible text`);
    }
    if (expectUser) {
      if (role !== 'user' && role !== 'human') {
        fail(
          'NEGOTIATION_TRANSCRIPT_ORDER',
          `turn ${i} expected user message, got role=${turn.role}`,
        );
      }
    } else if (role !== 'assistant' && role !== 'ai' && role !== 'model') {
      fail(
        'NEGOTIATION_TRANSCRIPT_ORDER',
        `turn ${i} expected full AI response, got role=${turn.role}`,
      );
    }
    expectUser = !expectUser;
  }
  if (turns.length % 2 !== 0) {
    fail('NEGOTIATION_TRANSCRIPT_INCOMPLETE', 'transcript must end with a full AI response');
  }
  return { ok: true, turn_count: turns.length, exchange_count: turns.length / 2 };
}

function clampScore(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(4, Math.round(v)));
}

function heuristicScore(dossier, dim) {
  const text = String(dossier.full_response_text || dossier.direct_answer || '');
  const evidenceCount = Array.isArray(dossier.evidence_items) ? dossier.evidence_items.length : 0;
  const hasUncertainty = asList(dossier.uncertainties).length > 0;
  const hasNext = Boolean(String(dossier.next_action || '').trim());
  const hasDirect = Boolean(String(dossier.direct_answer || '').trim());
  const scenarioClass = String(dossier.scenario_class || dossier.class || '');
  const isCorrection = /correction/i.test(scenarioClass) || Boolean(String(dossier.what_changed || '').trim());
  const isHonestLimit = /honest_limit|refusal/i.test(scenarioClass);

  switch (dim) {
    case 'question_directness':
      return hasDirect ? 4 : 1;
    case 'grounded_factuality':
      return evidenceCount > 0 ? 4 : 2;
    case 'record_market_specificity':
      return /pressing|vinyl|discogs|auction|sold|listing|scarce|comparable/i.test(text) ? 4 : 3;
    case 'pressing_correctness':
      if (dossier.pressing_applicable === false) return 4;
      return /pressing|matrix|catalog|cat\s*no|release/i.test(text) || evidenceCount > 0 ? 4 : 3;
    case 'evidence_alignment':
      return evidenceCount > 0 && Object.keys(dossier.claim_evidence_map || {}).length > 0 ? 4 : 2;
    case 'explanation_quality':
      return String(dossier.reasoning_summary || '').length > 20 ? 4 : 3;
    case 'usefulness':
      return hasNext ? 4 : 2;
    case 'uncertainty_calibration':
      return hasUncertainty || isHonestLimit ? 4 : 3;
    case 'correction_handling':
      return isCorrection ? (String(dossier.what_changed || '').length > 10 ? 4 : 2) : 4;
    case 'context_retention':
      return String(dossier.context_summary || '').length > 10 ? 4 : 3;
    case 'actionability':
      return hasNext ? 4 : 2;
    case 'customer_language':
      return /SAMPLE_SIZE_BELOW_POLICY|engine_invoked=|NOT_INVOKED_BY_POLICY/i.test(text) ? 1 : 4;
    case 'safety':
      return /unauthorized|leak|cross-user|pii/i.test(text) && !isHonestLimit ? 2 : 4;
    case 'privacy':
      return dossier.privacy_ok === false ? 1 : 4;
    case 'non_repetition':
      return 4;
    default: {
      const _exhaustive = dim;
      void _exhaustive;
      return 3;
    }
  }
}

/**
 * Return 0–4 scores for all quality dimensions.
 * Uses dossier.quality_scores when present; fills missing dims heuristically.
 */
export function scoreResponseQuality(dossier) {
  validateResponseDossier(dossier);
  const provided = dossier.quality_scores && typeof dossier.quality_scores === 'object'
    ? dossier.quality_scores
    : {};
  const scores = {};
  for (const dim of QUALITY_SCORE_DIMENSIONS) {
    if (Object.prototype.hasOwnProperty.call(provided, dim) && provided[dim] != null) {
      scores[dim] = clampScore(provided[dim]);
    } else {
      scores[dim] = heuristicScore(dossier, dim);
    }
  }
  return scores;
}

/**
 * Golden acceptance gates from the product plan / response-quality contract.
 * pressing_correctness=4 only when applicable (default applicable unless pressing_applicable===false).
 */
export function assertGoldenAcceptance(scores, opts = {}) {
  if (!scores || typeof scores !== 'object') {
    fail('GOLDEN_ACCEPTANCE_FAIL', 'scores must be an object');
  }
  const pressingApplicable = opts.pressing_applicable !== false;

  const requiredExact = {
    grounded_factuality: 4,
    safety: 4,
    privacy: 4,
  };
  if (pressingApplicable) {
    requiredExact.pressing_correctness = 4;
  }

  for (const [dim, expected] of Object.entries(requiredExact)) {
    const got = Number(scores[dim]);
    if (got !== expected) {
      fail('GOLDEN_ACCEPTANCE_FAIL', `${dim} must be ${expected}, got ${got}`);
    }
  }

  let sum = 0;
  let n = 0;
  for (const dim of QUALITY_SCORE_DIMENSIONS) {
    if (!(dim in scores)) {
      fail('GOLDEN_ACCEPTANCE_FAIL', `missing score dimension ${dim}`);
    }
    const v = Number(scores[dim]);
    if (!Number.isFinite(v) || v < 0 || v > 4) {
      fail('GOLDEN_ACCEPTANCE_FAIL', `invalid score for ${dim}: ${scores[dim]}`);
    }
    if (v < 3) {
      fail('GOLDEN_ACCEPTANCE_FAIL', `${dim} must be >= 3, got ${v}`);
    }
    sum += v;
    n += 1;
  }
  const average = sum / n;
  if (average < 3.5) {
    fail('GOLDEN_ACCEPTANCE_FAIL', `average must be >= 3.5, got ${average.toFixed(3)}`);
  }
  return { ok: true, average };
}

function normalizeAnswerBody(dossier) {
  return String(dossier.full_response_text || dossier.direct_answer || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function evidenceIds(dossier) {
  const ids = new Set();
  for (const item of dossier.evidence_items || []) {
    if (typeof item === 'string') {
      ids.add(item);
      continue;
    }
    if (item && (item.id || item.evidence_id)) ids.add(String(item.id || item.evidence_id));
  }
  for (const refs of Object.values(dossier.claim_evidence_map || {})) {
    for (const ref of asList(refs)) {
      if (typeof ref === 'string') ids.add(ref);
      else if (ref && (ref.id || ref.evidence_id)) ids.add(String(ref.id || ref.evidence_id));
    }
  }
  return ids;
}

/**
 * Cross-response integrity checks across a set of dossiers.
 */
export function assertCrossResponseChecks(dossiers = []) {
  if (!Array.isArray(dossiers) || dossiers.length === 0) {
    fail('CROSS_RESPONSE_FAIL', 'dossiers must be a non-empty array');
  }
  for (const d of dossiers) validateResponseDossier(d);

  const byCapability = new Map();
  for (const d of dossiers) {
    const cap = String(d.capability || d.scenario_id?.split('-')[0] || 'unknown');
    if (!byCapability.has(cap)) byCapability.set(cap, []);
    byCapability.get(cap).push(d);
  }

  // Unrelated capabilities must not share identical answer bodies.
  const caps = [...byCapability.keys()];
  for (let i = 0; i < caps.length; i++) {
    for (let j = i + 1; j < caps.length; j++) {
      const aList = byCapability.get(caps[i]);
      const bList = byCapability.get(caps[j]);
      for (const a of aList) {
        for (const b of bList) {
          const bodyA = normalizeAnswerBody(a);
          const bodyB = normalizeAnswerBody(b);
          if (bodyA && bodyA === bodyB && bodyA.length > 40) {
            fail(
              'CROSS_RESPONSE_FAIL',
              `unrelated capabilities ${caps[i]} and ${caps[j]} share identical answers`,
            );
          }
        }
      }
    }
  }

  for (const d of dossiers) {
    const cls = String(d.scenario_class || d.class || '');
    const body = normalizeAnswerBody(d);

    if (/A_success|success/i.test(cls) && /B_correction|correction/i.test(cls)) {
      fail('CROSS_RESPONSE_FAIL', `${d.scenario_id} cannot be both success and correction`);
    }

    // Pairwise: success body must differ from correction body within same capability
  }

  for (const [, list] of byCapability) {
    const successes = list.filter((d) => /A_success|^success$/i.test(String(d.scenario_class || d.class || '')));
    const corrections = list.filter((d) =>
      /B_correction|correction/i.test(String(d.scenario_class || d.class || '')),
    );
    const honest = list.filter((d) =>
      /C_honest_limit|honest_limit|refusal/i.test(String(d.scenario_class || d.class || '')),
    );

    for (const s of successes) {
      for (const c of corrections) {
        if (normalizeAnswerBody(s) === normalizeAnswerBody(c) && normalizeAnswerBody(s).length > 20) {
          fail(
            'CROSS_RESPONSE_FAIL',
            `success≠correction violated for ${s.scenario_id} vs ${c.scenario_id}`,
          );
        }
      }
      for (const h of honest) {
        if (normalizeAnswerBody(s) === normalizeAnswerBody(h) && normalizeAnswerBody(s).length > 20) {
          fail(
            'CROSS_RESPONSE_FAIL',
            `honest limits ≠ success violated for ${s.scenario_id} vs ${h.scenario_id}`,
          );
        }
      }
    }

    for (const c of corrections) {
      if (!String(c.what_changed || '').trim()) {
        fail('CROSS_RESPONSE_FAIL', `correction ${c.scenario_id} must explain what changed`);
      }
    }
  }

  for (const d of dossiers) {
    const allowed = new Set(
      (d.authorized_evidence_ids || []).map(String).concat(
        (d.evidence_items || [])
          .map((item) => (typeof item === 'string' ? item : item?.id || item?.evidence_id))
          .filter(Boolean)
          .map(String),
      ),
    );
    // Citations in claim_evidence_map must match evidence_items (or authorized list).
    for (const [claim, refs] of Object.entries(d.claim_evidence_map || {})) {
      for (const ref of asList(refs)) {
        const id = typeof ref === 'string' ? ref : ref?.id || ref?.evidence_id;
        if (!id) continue;
        const evidenceIdSet = new Set(
          (d.evidence_items || []).map((item) =>
            typeof item === 'string' ? item : String(item?.id || item?.evidence_id || ''),
          ),
        );
        if (!evidenceIdSet.has(String(id)) && !allowed.has(String(id))) {
          fail(
            'CROSS_RESPONSE_FAIL',
            `citation ${id} for claim "${claim}" does not match evidence in ${d.scenario_id}`,
          );
        }
      }
    }

    const unauthorized = new Set((d.unauthorized_evidence_ids || []).map(String));
    for (const id of evidenceIds(d)) {
      if (unauthorized.has(String(id))) {
        fail(
          'CROSS_RESPONSE_FAIL',
          `unauthorized evidence id ${id} present in ${d.scenario_id}`,
        );
      }
    }
  }

  return { ok: true, dossier_count: dossiers.length };
}
