#!/usr/bin/env node
/**
 * Phase 34C — generate/validate versioned prompt+model configuration registry.
 * MODEL_WEIGHT_TRAINING: NO
 * OPTIMIZATION: PROMPT_RETRIEVAL_RERANKER_TOOL_CALIBRATION_AND_MODEL_SELECTION
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'phase34-prompt-registry');
const POLICY_PATH = path.join(__dirname, 'phase34-eval-policy.json');

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

/** Material primary dimensions — one distinct strategy per candidate slot (no punctuation-only variants). */
export const CANDIDATE_SPECS = [
  {
    slot: '01',
    primary_dimension: 'evidence_first',
    secondary_dimensions: ['limitation_placement'],
    rationale: 'Lead with cited evidence IDs before any scarcity/valuation conclusion.',
  },
  {
    slot: '02',
    primary_dimension: 'conclusion_first',
    secondary_dimensions: ['schema_strategy'],
    rationale: 'State the structured conclusion first, then attach supporting evidence blocks.',
  },
  {
    slot: '03',
    primary_dimension: 'tool_ordering',
    secondary_dimensions: ['structured_decomposition'],
    rationale: 'Require tool/assembler calls before narrative; order: scope check → evidence fetch → synthesize.',
  },
  {
    slot: '04',
    primary_dimension: 'concise',
    secondary_dimensions: ['safety_placement'],
    rationale: 'Default to short actionable output; expand only when evidence conflicts.',
  },
  {
    slot: '05',
    primary_dimension: 'explanatory',
    secondary_dimensions: ['confidence'],
    rationale: 'Explain methodology and caveats inline for collector education.',
  },
  {
    slot: '06',
    primary_dimension: 'novice',
    secondary_dimensions: ['clarification'],
    rationale: 'Use plain-language vinyl terms and ask clarifying questions on ambiguous pressings.',
  },
  {
    slot: '07',
    primary_dimension: 'expert',
    secondary_dimensions: ['schema_strategy'],
    rationale: 'Assume matrix/runout fluency; prioritize catalog precision over pedagogy.',
  },
  {
    slot: '08',
    primary_dimension: 'buyer',
    secondary_dimensions: ['abstention'],
    rationale: 'Frame outputs for purchase decisions: risk, condition, budget fit.',
  },
  {
    slot: '09',
    primary_dimension: 'seller',
    secondary_dimensions: ['negative_examples'],
    rationale: 'Frame outputs for listing/pricing decisions; include anti-patterns for overclaiming.',
  },
  {
    slot: '10',
    primary_dimension: 'few_shot',
    secondary_dimensions: ['negative_examples', 'confidence'],
    rationale: 'Include positive and negative few-shot exemplars for grounded vs unsupported claims.',
  },
  {
    slot: '11',
    primary_dimension: 'structured_decomposition',
    secondary_dimensions: ['safety_placement', 'limitation_placement'],
    rationale: 'Force stepwise decomposition: authorize → retrieve → score → abstain-or-answer → schema.',
  },
  {
    slot: '12',
    primary_dimension: 'schema_strategy',
    secondary_dimensions: ['abstention', 'clarification'],
    rationale: 'Schema-first: emit only schema fields; abstain via structured empty evidence rather than prose.',
  },
];

export const REQUIRED_DIMENSION_COVERAGE = [
  'evidence_first',
  'conclusion_first',
  'tool_ordering',
  'concise',
  'explanatory',
  'novice',
  'expert',
  'buyer',
  'seller',
  'clarification',
  'confidence',
  'abstention',
  'few_shot',
  'negative_examples',
  'structured_decomposition',
  'safety_placement',
  'limitation_placement',
  'schema_strategy',
];

const CAPABILITY_BLURBS = {
  scarcity:
    'Assess scarcity using authorized listing/sold/auction evidence. Never infer rarity from zero current listings.',
  valuation:
    'Produce quick-sale, fair-market, and patient-sale ranges with sold vs asking separation. Never auto-submit prices.',
  auction_intelligence:
    'Report market temperature and pressure signals without bidder identity or unsupported collusion claims.',
  embeddings:
    'Describe embedding lineage metadata only. No production vector writes. Deletion must propagate.',
  semantic_search:
    'Honor requested search mode (keyword/semantic/hybrid/owner-scoped). Silent fallback is forbidden.',
  negotiation_assistance:
    'Draft advisory negotiation text only. automatic_send_allowed=false. No impersonation or fabricated leverage.',
  recommendations:
    'Rank with reason codes, budget and negative-preference compliance. No pay-to-rank or appreciation prediction.',
  market_analytics:
    'Require time range, population, sample size, currency, methodology, freshness, limitations. No causal/future claims.',
};

const SAFETY_BLOCK = [
  'Refuse cross-user and cross-thread retrieval.',
  'Exclude deleted sources from influence.',
  'Label inferred intent as inference.',
  'Surface limitations and confidence explicitly.',
].join(' ');

function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function contentForHash(candidate) {
  return JSON.stringify({
    capability_id: candidate.capability_id,
    version: candidate.version,
    primary_dimension: candidate.primary_dimension,
    secondary_dimensions: candidate.secondary_dimensions,
    model_tier: candidate.model_tier,
    prompts: candidate.prompts,
    policies: candidate.policies,
    few_shot: candidate.few_shot,
  });
}

function buildPrompts(capabilityId, spec) {
  const blurb = CAPABILITY_BLURBS[capabilityId];
  const dim = spec.primary_dimension;
  const systemParts = [
    `You are the Record Platform ${capabilityId} intelligence configuration.`,
    blurb,
    SAFETY_BLOCK,
  ];

  switch (dim) {
    case 'evidence_first':
      systemParts.push(
        'RESPONSE ORDER: (1) evidence[] citations (2) limitations (3) confidence (4) conclusions. Never conclude before evidence.',
      );
      break;
    case 'conclusion_first':
      systemParts.push(
        'RESPONSE ORDER: (1) structured conclusion fields (2) evidence[] that justify them (3) limitations. Conclusions must still be evidence-backed.',
      );
      break;
    case 'tool_ordering':
      systemParts.push(
        'TOOL ORDER: authorize_scope → fetch_evidence → filter_deleted_stale → synthesize_schema. Do not synthesize before tools complete.',
      );
      break;
    case 'concise':
      systemParts.push(
        'STYLE: concise. Max 4 short sentences of prose outside schema fields. Prefer structured fields over narrative.',
      );
      break;
    case 'explanatory':
      systemParts.push(
        'STYLE: explanatory. Include methodology notes for how sold vs asking and pressing matches were treated.',
      );
      break;
    case 'novice':
      systemParts.push(
        'AUDIENCE: novice collectors. Define pressing/catalog terms briefly. Prefer clarification over guessing ambiguous pressings.',
      );
      break;
    case 'expert':
      systemParts.push(
        'AUDIENCE: expert dealers. Use catalog numbers, matrix/runout, and variant codes without tutoring.',
      );
      break;
    case 'buyer':
      systemParts.push(
        'ROLE LENS: buyer. Emphasize purchase risk, condition sensitivity, and budget fit. Abstain when evidence is weak.',
      );
      break;
    case 'seller':
      systemParts.push(
        'ROLE LENS: seller. Emphasize listing competitiveness and pricing bands. Include negative examples of overclaiming rarity.',
      );
      break;
    case 'few_shot':
      systemParts.push(
        'Use the attached few-shot positives and negatives. Mimic grounded positives; refuse patterns in negatives.',
      );
      break;
    case 'structured_decomposition':
      systemParts.push(
        'DECOMPOSE: Step A authorization, Step B evidence inventory, Step C conflict check, Step D answer-or-abstain, Step E schema emit.',
      );
      break;
    case 'schema_strategy':
      systemParts.push(
        'SCHEMA-FIRST: output must validate against the capability schema with additionalProperties false. Prefer structured abstention over free text.',
      );
      break;
    default: {
      const _exhaustive = dim;
      throw new Error(`unhandled_primary_dimension:${_exhaustive}`);
    }
  }

  if (spec.secondary_dimensions.includes('safety_placement')) {
    systemParts.push('Place safety refusals immediately after authorization failures, before any market content.');
  }
  if (spec.secondary_dimensions.includes('limitation_placement')) {
    systemParts.push('Place limitations immediately after evidence and before confidence.');
  }
  if (spec.secondary_dimensions.includes('confidence')) {
    systemParts.push('Calibrate confidence to evidence count, freshness, and pressing match state.');
  }
  if (spec.secondary_dimensions.includes('abstention')) {
    systemParts.push('Prefer abstention when evidence is missing, stale, or unauthorized.');
  }
  if (spec.secondary_dimensions.includes('clarification')) {
    systemParts.push('When pressing identity is ambiguous, ask one clarifying question instead of inventing an exact match.');
  }

  const userTemplate = [
    `Capability: ${capabilityId}`,
    'Authorized context JSON: {{authorized_context}}',
    'Evidence bundle JSON: {{evidence_bundle}}',
    'User turn: {{user_turn}}',
    `Apply primary dimension: ${dim}.`,
    'Return schema-valid JSON only.',
  ].join('\n');

  return {
    system: systemParts.join(' '),
    user_template: userTemplate,
  };
}

function buildFewShot(capabilityId, spec) {
  if (spec.primary_dimension !== 'few_shot' && !spec.secondary_dimensions.includes('negative_examples')) {
    return { positives: [], negatives: [] };
  }
  return {
    positives: [
      {
        label: 'grounded_with_evidence',
        input: `${capabilityId}: 3 sold comps same pressing`,
        output_sketch: 'Cite evidence IDs; state limitation if n<5; no rarity-from-zero.',
      },
    ],
    negatives: [
      {
        label: 'unsupported_claim',
        input: `${capabilityId}: zero listings`,
        bad_output_sketch: 'This pressing is extremely rare because nothing is listed.',
        refusal: 'Abstain; never infer rarity from zero listings.',
      },
    ],
  };
}

function buildCandidate(capabilityId, spec, modelTier) {
  const version = '1.0.0';
  const candidateId = `${capabilityId}-c${spec.slot}-${spec.primary_dimension}`;
  const prompts = buildPrompts(capabilityId, spec);
  const few_shot = buildFewShot(capabilityId, spec);
  const policies = {
    automatic_send_allowed: false,
    silent_fallback_forbidden: true,
    production_mutations_allowed: false,
    cross_user_retrieval_allowed: false,
    MODEL_WEIGHT_TRAINING: 'NO',
    require_evidence: true,
    require_confidence: true,
    require_limitations: true,
    schema_additional_properties: false,
  };

  const draft = {
    candidate_id: candidateId,
    capability_id: capabilityId,
    version,
    primary_dimension: spec.primary_dimension,
    secondary_dimensions: spec.secondary_dimensions,
    dimensions: [spec.primary_dimension, ...spec.secondary_dimensions],
    rationale: spec.rationale,
    model_tier: modelTier.tier_id,
    model_provider: modelTier.provider,
    model_id: modelTier.model_id,
    prompts,
    policies,
    few_shot,
  };

  const hashInput = contentForHash(draft);
  draft.content_sha256 = sha256Hex(hashInput);
  draft.content_sha256_alg = 'sha256';
  return draft;
}

function loadAvailableTiers() {
  const policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
  return policy.available_model_tiers.tiers;
}

export function buildRegistry() {
  const tiers = loadAvailableTiers();
  const ruleTier = tiers.find((t) => t.tier_id === 'rule_deterministic');
  const ollamaTier = tiers.find((t) => t.tier_id === 'ollama_optional');
  if (!ruleTier || !ollamaTier) {
    throw new Error('expected rule_deterministic and ollama_optional tiers in phase34-eval-policy.json');
  }

  const byCapability = {};
  const allCandidates = [];

  for (const capabilityId of CAPABILITIES) {
    const candidates = CANDIDATE_SPECS.map((spec, idx) => {
      // Alternate model tier assignment across slots so both tiers appear; still only two real tiers.
      const tier = idx % 2 === 0 ? ruleTier : ollamaTier;
      return buildCandidate(capabilityId, spec, tier);
    });
    byCapability[capabilityId] = {
      capability_id: capabilityId,
      version: '1.0.0',
      candidate_count: candidates.length,
      candidates,
    };
    allCandidates.push(...candidates);
  }

  const dimensionSet = new Set();
  for (const c of allCandidates) {
    for (const d of c.dimensions) dimensionSet.add(d);
  }

  const index = {
    registry_id: 'phase34-prompt-registry-v1',
    version: '1.0.0',
    status: 'SCAFFOLDING',
    MODEL_WEIGHT_TRAINING: 'NO',
    OPTIMIZATION: 'PROMPT_RETRIEVAL_RERANKER_TOOL_CALIBRATION_AND_MODEL_SELECTION',
    generated_at: new Date().toISOString(),
    capability_count: CAPABILITIES.length,
    candidates_per_capability: CANDIDATE_SPECS.length,
    total_candidates: allCandidates.length,
    available_model_tiers: {
      tier_count: tiers.length,
      three_tier_comparison: tiers.length >= 3 ? 'AVAILABLE' : 'NOT_AVAILABLE',
      tiers: tiers.map((t) => ({
        tier_id: t.tier_id,
        provider: t.provider,
        model_id: t.model_id,
      })),
    },
    required_dimension_coverage: REQUIRED_DIMENSION_COVERAGE,
    dimension_coverage_present: [...dimensionSet].sort(),
    capabilities: CAPABILITIES.map((id) => ({
      capability_id: id,
      file: `${id}.json`,
      candidate_count: byCapability[id].candidate_count,
    })),
    content_manifest_sha256: sha256Hex(
      allCandidates
        .map((c) => `${c.candidate_id}:${c.content_sha256}`)
        .sort()
        .join('|'),
    ),
  };

  return { index, byCapability, allCandidates };
}

export function validateRegistry(registry = buildRegistry()) {
  const violations = [];
  const { index, byCapability, allCandidates } = registry;

  if (allCandidates.length < 96) {
    violations.push(`candidate_count_below_96:${allCandidates.length}`);
  }

  for (const capabilityId of CAPABILITIES) {
    const file = byCapability[capabilityId];
    if (!file || file.candidates.length < 12) {
      violations.push(`capability_below_12:${capabilityId}:${file?.candidates?.length ?? 0}`);
    }
    const primaries = new Set(file.candidates.map((c) => c.primary_dimension));
    if (primaries.size !== file.candidates.length) {
      violations.push(`duplicate_primary_dimension:${capabilityId}`);
    }
  }

  const hashes = new Set();
  for (const c of allCandidates) {
    const expected = sha256Hex(contentForHash(c));
    if (c.content_sha256 !== expected) {
      violations.push(`hash_mismatch:${c.candidate_id}`);
    }
    if (hashes.has(c.content_sha256)) {
      violations.push(`duplicate_hash:${c.content_sha256}`);
    }
    hashes.add(c.content_sha256);

    // Reject punctuation-only "variants": system prompts must differ materially across primaries.
    if ((c.prompts.system || '').length < 120) {
      violations.push(`system_prompt_too_short:${c.candidate_id}`);
    }
  }

  const covered = new Set(index.dimension_coverage_present);
  for (const dim of REQUIRED_DIMENSION_COVERAGE) {
    if (!covered.has(dim)) violations.push(`missing_dimension_coverage:${dim}`);
  }

  if (index.available_model_tiers.tier_count !== 2) {
    violations.push(`unexpected_tier_count:${index.available_model_tiers.tier_count}`);
  }
  if (index.available_model_tiers.three_tier_comparison !== 'NOT_AVAILABLE') {
    violations.push('must_document_three_tier_not_available');
  }

  return {
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    violations,
    counts: {
      total_candidates: allCandidates.length,
      unique_hashes: hashes.size,
      capabilities: CAPABILITIES.length,
      dimensions_covered: covered.size,
    },
  };
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function writeRegistry(outDir = OUT_DIR) {
  const registry = buildRegistry();
  const validation = validateRegistry(registry);
  if (validation.status !== 'PASS') {
    throw new Error(`registry_validation_failed:\n${validation.violations.join('\n')}`);
  }

  writeJson(path.join(outDir, 'index.json'), registry.index);
  for (const capabilityId of CAPABILITIES) {
    writeJson(path.join(outDir, `${capabilityId}.json`), registry.byCapability[capabilityId]);
  }

  return { outDir, validation, index: registry.index };
}

function main() {
  const args = process.argv.slice(2);
  const validateOnly = args.includes('--validate');
  if (validateOnly) {
    // Load from disk if present, else build.
    const indexPath = path.join(OUT_DIR, 'index.json');
    let registry;
    if (fs.existsSync(indexPath)) {
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      const byCapability = {};
      const allCandidates = [];
      for (const cap of index.capabilities) {
        const doc = JSON.parse(fs.readFileSync(path.join(OUT_DIR, cap.file), 'utf8'));
        byCapability[cap.capability_id] = doc;
        allCandidates.push(...doc.candidates);
      }
      registry = { index, byCapability, allCandidates };
    } else {
      registry = buildRegistry();
    }
    const report = validateRegistry(registry);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(report.status === 'PASS' ? 0 : 1);
  }

  const result = writeRegistry();
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'WROTE',
        outDir: result.outDir,
        total_candidates: result.index.total_candidates,
        content_manifest_sha256: result.index.content_manifest_sha256,
        available_model_tiers: result.index.available_model_tiers,
        validation: result.validation,
      },
      null,
      2,
    )}\n`,
  );
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
