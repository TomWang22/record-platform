/**
 * Phase 33A — intelligence capability contract package validator (offline).
 */
import fs from 'node:fs';
import path from 'node:path';

export const REQUIRED_CAPABILITY_IDS = [
  'scarcity',
  'valuation',
  'auction_intelligence',
  'embeddings',
  'semantic_search',
  'negotiation_assistance',
  'recommendations',
  'market_analytics',
];

export const REQUIRED_PROTOCOLS = ['http1', 'http2', 'http3'];
export const IMPLEMENTATION_STATUSES = [
  'implemented',
  'partial',
  'planned',
  'unsupported',
  'blocked',
];

export const REQUIRED_MATRIX_FIELDS = [
  'capability_id',
  'display_name',
  'phase',
  'status',
  'product_surfaces',
  'input_contracts',
  'output_schema',
  'data_sources',
  'privacy_classes',
  'authorization_scope',
  'grounding_requirements',
  'abstention_conditions',
  'safety_requirements',
  'retrieval_metrics',
  'recall_metrics',
  'quality_metrics',
  'protocols',
  'latency_class',
  'current_implementation_status',
  'current_test_status',
  'known_gaps',
  'owner_decisions_required',
];

export const FORBIDDEN_TRAINING_PATTERNS = [
  /\bthe model was trained\b/i,
  /\bwe trained the model\b/i,
  /\bmodel training completed\b/i,
  /\bfoundation[- ]model training\b/i,
];

export const PRIVATE_FIELD_PATTERNS = [
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\bBearer\s+[A-Za-z0-9._\-]+\b/i,
  /\bsk-[A-Za-z0-9]{20,}\b/,
];

const CAPABILITY_SCHEMA_FILES = {
  scarcity: 'scarcity.schema.json',
  valuation: 'valuation.schema.json',
  auction_intelligence: 'auction-intelligence.schema.json',
  embeddings: 'embedding-metadata.schema.json',
  semantic_search: 'semantic-search.schema.json',
  negotiation_assistance: 'negotiation-assistance.schema.json',
  recommendations: 'recommendations.schema.json',
  market_analytics: 'market-analytics.schema.json',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function walkFiles(root, pred) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, pred));
    else if (pred(full)) out.push(full);
  }
  return out;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Structural Draft 2020-12 sanity checks (no external AJV dependency). */
export function assertSchemaShape(schema, filePath, violations) {
  if (!isPlainObject(schema)) {
    violations.push(`invalid_schema_object:${filePath}`);
    return;
  }
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    violations.push(`schema_missing_or_wrong_$schema:${filePath}`);
  }
  if (typeof schema.$id !== 'string' || !schema.$id) {
    violations.push(`schema_missing_$id:${filePath}`);
  }
  for (const key of ['title', 'description', 'type']) {
    if (typeof schema[key] !== 'string' || !schema[key]) {
      violations.push(`schema_missing_${key}:${filePath}`);
    }
  }
  if (!Array.isArray(schema.required) || schema.required.length === 0) {
    if (schema.type === 'object') violations.push(`schema_missing_required:${filePath}`);
  }
  if (schema.type === 'object' && !isPlainObject(schema.properties)) {
    violations.push(`schema_missing_properties:${filePath}`);
  }
  if (schema.type === 'object' && !('additionalProperties' in schema)) {
    violations.push(`schema_missing_additionalProperties_policy:${filePath}`);
  }
}

function resolvePackagePaths(packageRoot) {
  return {
    packageRoot,
    matrixPath: path.join(packageRoot, 'intelligence-capability-matrix.json'),
    schemasDir: path.join(packageRoot, 'intelligence-output-schemas'),
    fixturesDir: path.join(packageRoot, 'fixtures'),
    scenarioPreviewPath: path.join(
      packageRoot,
      'fixtures/scenario-preview/scenario-preview.json',
    ),
  };
}

function trainingClaimIsPolicyLanguage(window) {
  return /do not say|must not say|forbidden|rejects? unsupported|without artifacts|unless\b|only when|training_terminology_policy|forbidden_without_artifacts|is not\b|not foundation|generation is not|≠|!=|are not\b/.test(
    window,
  );
}

function stripTrainingPolicyBlocks(text) {
  // Allow documenting forbidden phrases inside policy objects/sections.
  return text
    .replace(/"training_terminology_policy"\s*:\s*\{[\s\S]*?\n\s*\},?/g, '')
    .replace(/## Training terminology[\s\S]*?(?=##|$)/gi, '');
}

function hasUnsupportedTrainingClaim(text) {
  const scanned = stripTrainingPolicyBlocks(text);
  for (const base of FORBIDDEN_TRAINING_PATTERNS) {
    const re = new RegExp(base.source, base.flags.includes('g') ? base.flags : `${base.flags}g`);
    let match;
    while ((match = re.exec(scanned)) !== null) {
      const start = Math.max(0, match.index - 96);
      const end = Math.min(scanned.length, match.index + match[0].length + 64);
      const window = scanned.slice(start, end).toLowerCase();
      if (trainingClaimIsPolicyLanguage(window)) continue;
      return true;
    }
  }
  return false;
}

function scanTextForViolations(text, filePath, violations) {
  if (hasUnsupportedTrainingClaim(text)) {
    violations.push(`unsupported_training_claim:${filePath}`);
  }
  for (const re of PRIVATE_FIELD_PATTERNS) {
    if (re.test(text)) violations.push(`private_field_fixture_violation:${filePath}`);
  }
  if (text.includes('/tmp/phase33-ai-platform-capability-plan')) {
    violations.push(`generated_tmp_report_referenced:${filePath}`);
  }
}

/**
 * Validate a Phase 33A contract package rooted at scripts/ai-platform (or a temp clone).
 * @param {string} repoRoot
 * @param {{ packageRoot?: string, docsRoots?: string[], allowTmpHistoricalRoots?: boolean }} [options]
 */
export function validateIntelligenceCapabilityContracts(repoRoot, options = {}) {
  const violations = [];
  const packageRoot = options.packageRoot || path.join(repoRoot, 'scripts/ai-platform');
  const paths = resolvePackagePaths(packageRoot);
  const docsRoots = options.docsRoots || [
    path.join(repoRoot, 'docs/ai-platform/AI_PLATFORM_PRODUCT_ACCEPTANCE_CHARTER.md'),
    path.join(repoRoot, 'docs/ai-platform/PHASE_33_INTELLIGENCE_CAPABILITY_GAUNTLET.md'),
  ];

  const duplicateMatrix = path.join(
    repoRoot,
    'docs/ai-platform/intelligence-capability-matrix.json',
  );
  if (fs.existsSync(duplicateMatrix)) {
    violations.push('duplicate_canonical_matrix:docs/ai-platform/intelligence-capability-matrix.json');
  }

  if (!fs.existsSync(paths.matrixPath)) {
    violations.push('missing_matrix');
    return {
      status: 'FAIL',
      violations,
      package_root: packageRoot,
      capability_count: 0,
      schema_count: 0,
      scenario_preview_count: 0,
    };
  }

  let matrix;
  try {
    matrix = readJson(paths.matrixPath);
  } catch (err) {
    violations.push(`matrix_json_parse:${err.message}`);
    return {
      status: 'FAIL',
      violations,
      package_root: packageRoot,
      capability_count: 0,
      schema_count: 0,
      scenario_preview_count: 0,
    };
  }

  const production = matrix.production_posture || {};
  if (production.default !== 'keyword') violations.push('production_default_not_keyword');
  if (production.PERCENT !== 0) violations.push('PERCENT_nonzero');
  if (production.ALLOW_PROD_PERCENT !== 0) violations.push('ALLOW_PROD_PERCENT_nonzero');
  if (production.hybrid_vector_production_default !== 'NOT_ENABLED') {
    violations.push('hybrid_vector_production_default_enabled');
  }
  if (production.enablement !== 'NOT_APPROVED') violations.push('production_enablement_not_locked');
  if (matrix.launch !== 'NOT_APPROVED') violations.push('phase33_launch_not_locked');
  if (matrix.acceptance_status === 'ACCEPTED') {
    violations.push('capability_package_marked_accepted');
  }

  const capabilities = Array.isArray(matrix.capabilities) ? matrix.capabilities : [];
  const ids = capabilities.map((c) => c.capability_id);
  const unique = new Set(ids);
  if (unique.size !== ids.length) violations.push('duplicate_capability_id');
  for (const required of REQUIRED_CAPABILITY_IDS) {
    if (!unique.has(required)) violations.push(`missing_capability:${required}`);
  }
  for (const id of unique) {
    if (!REQUIRED_CAPABILITY_IDS.includes(id)) violations.push(`unknown_capability_id:${id}`);
  }

  const schemaFiles = walkFiles(paths.schemasDir, (f) => f.endsWith('.schema.json'));
  const schemaById = new Map();
  for (const filePath of schemaFiles) {
    let schema;
    try {
      schema = readJson(filePath);
    } catch (err) {
      violations.push(`schema_json_parse:${filePath}:${err.message}`);
      continue;
    }
    assertSchemaShape(schema, filePath, violations);
    if (typeof schema.$id === 'string') {
      if (schemaById.has(schema.$id)) {
        violations.push(`duplicate_schema_$id:${schema.$id}`);
      }
      schemaById.set(schema.$id, filePath);
    }
    const rel = path.relative(repoRoot, filePath);
    if (rel.startsWith('..')) violations.push(`schema_outside_repository:${filePath}`);
  }

  for (const cap of capabilities) {
    for (const field of REQUIRED_MATRIX_FIELDS) {
      if (!(field in cap)) violations.push(`capability_missing_field:${cap.capability_id || '?'}:${field}`);
    }
    if (!IMPLEMENTATION_STATUSES.includes(cap.status)) {
      violations.push(`invalid_status:${cap.capability_id}:${cap.status}`);
    }
    if (!IMPLEMENTATION_STATUSES.includes(cap.current_implementation_status)) {
      violations.push(`invalid_implementation_status:${cap.capability_id}`);
    }
    const protocols = cap.protocols || [];
    for (const p of REQUIRED_PROTOCOLS) {
      if (!protocols.includes(p)) violations.push(`missing_protocol:${cap.capability_id}:${p}`);
    }
    for (const p of protocols) {
      if (!REQUIRED_PROTOCOLS.includes(p)) {
        violations.push(`unsupported_protocol:${cap.capability_id}:${p}`);
      }
    }
    if (cap.status === 'accepted' || cap.current_implementation_status === 'accepted') {
      violations.push(`accepted_capability_label_forbidden:${cap.capability_id}`);
    }
    if (
      (cap.status === 'implemented' || cap.current_implementation_status === 'implemented') &&
      cap.current_test_status === 'missing'
    ) {
      violations.push(`accepted_capability_without_tests:${cap.capability_id}`);
    }
    // "accepted" synonym guard used by tests
    if (cap.product_acceptance === 'accepted' && cap.current_test_status === 'missing') {
      violations.push(`accepted_capability_without_tests:${cap.capability_id}`);
    }

    const schemaRel = cap.output_schema;
    if (typeof schemaRel !== 'string') {
      violations.push(`missing_output_schema:${cap.capability_id}`);
    } else {
      const abs = path.join(packageRoot, schemaRel);
      if (!fs.existsSync(abs)) violations.push(`missing_schema:${cap.capability_id}:${schemaRel}`);
      else {
        const schema = readJson(abs);
        for (const key of ['evidence', 'confidence', 'limitations']) {
          const hasProp = schema.properties && key in schema.properties;
          const requiredHas = Array.isArray(schema.required) && schema.required.includes(key);
          if (!hasProp) violations.push(`missing_${key}_field:${schemaRel}`);
          if (!requiredHas) violations.push(`missing_${key}_required:${schemaRel}`);
        }
        const expectedName = CAPABILITY_SCHEMA_FILES[cap.capability_id];
        if (expectedName && !schemaRel.endsWith(expectedName)) {
          violations.push(`schema_filename_mismatch:${cap.capability_id}:${schemaRel}`);
        }
      }
    }

    const safety = (cap.safety_requirements || []).map(String);
    if (cap.capability_id === 'negotiation_assistance') {
      for (const req of [
        'never_auto_send',
        'never_impersonate',
        'never_fabricate_leverage',
        'no_cross_user_thread_retrieval',
      ]) {
        if (!safety.includes(req)) violations.push(`negotiation_missing_safety:${req}`);
      }
      if (cap.never_auto_send !== true) {
        violations.push('negotiation_auto_send_not_forbidden');
      }
      if (cap.never_auto_send === false || safety.includes('auto_send_enabled')) {
        violations.push('negotiation_auto_send_enabled');
      }
    }
    if (safety.includes('private_cross_user_retrieval_allowed')) {
      violations.push('private_cross_user_retrieval_allowed');
    }
    if (cap.acceptance === 'accepted' && cap.current_test_status === 'missing') {
      violations.push(`accepted_capability_without_tests:${cap.capability_id}`);
    }
  }

  // Scenario preview
  let scenarioCount = 0;
  if (!fs.existsSync(paths.scenarioPreviewPath)) {
    violations.push('missing_scenario_preview');
  } else {
    const preview = readJson(paths.scenarioPreviewPath);
    const scenarios = Array.isArray(preview.scenarios) ? preview.scenarios : [];
    scenarioCount = scenarios.length;
    const scenarioIds = new Set();
    for (const row of scenarios) {
      if (scenarioIds.has(row.scenario_id)) {
        violations.push(`duplicate_scenario_id:${row.scenario_id}`);
      }
      scenarioIds.add(row.scenario_id);
      if (!REQUIRED_CAPABILITY_IDS.includes(row.capability_id)) {
        violations.push(`invalid_scenario_capability_reference:${row.scenario_id}:${row.capability_id}`);
      }
      if (!REQUIRED_PROTOCOLS.includes(row.protocol)) {
        violations.push(`unsupported_protocol:scenario:${row.scenario_id}:${row.protocol}`);
      }
      const schemaPath = path.join(packageRoot, row.expected_schema || '');
      if (!row.expected_schema || !fs.existsSync(schemaPath)) {
        violations.push(`scenario_missing_schema:${row.scenario_id}`);
      }
    }
    const requiredClasses = preview.required_scenario_classes || [];
    const present = new Set(scenarios.map((s) => s.scenario_class));
    for (const cls of requiredClasses) {
      if (!present.has(cls)) violations.push(`missing_scenario_class:${cls}`);
    }
  }

  // Fixture privacy + training scans
  for (const filePath of walkFiles(paths.fixturesDir, () => true)) {
    if (!filePath.endsWith('.json') && !filePath.endsWith('.md')) continue;
    scanTextForViolations(fs.readFileSync(filePath, 'utf8'), path.relative(repoRoot, filePath), violations);
  }
  scanTextForViolations(JSON.stringify(matrix), 'intelligence-capability-matrix.json', violations);
  for (const doc of docsRoots) {
    if (fs.existsSync(doc)) {
      scanTextForViolations(fs.readFileSync(doc, 'utf8'), path.relative(repoRoot, doc), violations);
    }
  }

  // Valid examples parse
  const examplesDir = path.join(paths.fixturesDir, 'valid-examples');
  if (fs.existsSync(examplesDir)) {
    for (const file of fs.readdirSync(examplesDir).filter((f) => f.endsWith('.json'))) {
      try {
        readJson(path.join(examplesDir, file));
      } catch (err) {
        violations.push(`example_json_parse:${file}:${err.message}`);
      }
    }
  }

  const uniqueViolations = [...new Set(violations)];
  return {
    status: uniqueViolations.length === 0 ? 'PASS' : 'FAIL',
    package_root: packageRoot,
    canonical_matrix_path: path.relative(repoRoot, paths.matrixPath),
    duplicate_matrix_files: fs.existsSync(duplicateMatrix)
      ? ['docs/ai-platform/intelligence-capability-matrix.json']
      : [],
    capability_count: capabilities.length,
    schema_count: schemaFiles.length,
    scenario_preview_count: scenarioCount,
    production_posture: production,
    violations: uniqueViolations,
  };
}
