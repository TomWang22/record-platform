/**
 * Runtime configuration pins from committed prompt registry (not synthetic ID strings).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REGISTRY_DIR = path.join(REPO_ROOT, 'scripts/ai-platform/phase34-prompt-registry');

export const PIN_SOURCE = Object.freeze({
  LIVE_REGISTRY: 'LIVE_REGISTRY',
  FIXTURE_SYNTHETIC_PIN: 'FIXTURE_SYNTHETIC_PIN',
});

function sha(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Load candidate from committed registry by slot (1..12) or candidate_id prefix.
 */
export function loadPromptCandidate(capability, promptSlotOrId) {
  const file = path.join(REGISTRY_DIR, `${capability}.json`);
  if (!fs.existsSync(file)) {
    const err = new Error(`prompt registry missing for ${capability}`);
    err.code = 'PHASE34_PRODUCT_PROMPT_REGISTRY_MISSING';
    throw err;
  }
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const candidates = doc.candidates || [];
  let candidate = null;
  if (typeof promptSlotOrId === 'number') {
    candidate = candidates[promptSlotOrId - 1] || null;
  } else {
    const id = String(promptSlotOrId);
    candidate =
      candidates.find((c) => c.candidate_id === id) ||
      candidates.find((c) => c.candidate_id?.startsWith(id)) ||
      candidates.find((c) => id.includes(String(c.primary_dimension))) ||
      null;
  }
  if (!candidate) {
    const err = new Error(`prompt candidate not found: ${capability} ${promptSlotOrId}`);
    err.code = 'PHASE34_PRODUCT_PROMPT_CANDIDATE_MISSING';
    throw err;
  }
  return { doc, candidate, registry_file: file };
}

/**
 * Hash actual committed configuration content for live pins.
 */
export function pinFromCommittedRegistry({
  capability,
  prompt_slot,
  retrieval_mode_requested = 'keyword',
  runtime_image_digest = null,
  certificate_fingerprint = null,
  schema_version = 'phase34-intelligence-v1',
} = {}) {
  const { candidate, registry_file } = loadPromptCandidate(capability, prompt_slot);
  const system = candidate.prompts?.system || '';
  const userTemplate = candidate.prompts?.user_template || '';
  const modelCfg = {
    model_tier: candidate.model_tier,
    model_provider: candidate.model_provider,
    model_id: candidate.model_id,
    policies: candidate.policies || {},
  };
  const retrievalCfg = {
    mode_requested: retrieval_mode_requested,
    capability,
  };
  const rerankerCfg = { version: 'rerank-v1', capability };
  const toolCfg = { policies: candidate.policies || {}, tools: candidate.tools || [] };

  const pins = {
    pin_source: PIN_SOURCE.LIVE_REGISTRY,
    prompt_configuration_id: candidate.candidate_id,
    prompt_hash: sha(JSON.stringify({ system, userTemplate, dimensions: candidate.dimensions })),
    system_prompt_hash: sha(system),
    model_tier: candidate.model_tier,
    model_identifier: candidate.model_id,
    model_configuration_hash: sha(JSON.stringify(modelCfg)),
    retrieval_mode_requested,
    retrieval_mode_executed: retrieval_mode_requested,
    retrieval_configuration_hash: sha(JSON.stringify(retrievalCfg)),
    reranker_version: 'rerank-v1',
    tool_configuration_hash: sha(JSON.stringify(toolCfg)),
    embedding_version: 'emb-v1',
    schema_version,
    runtime_image_pin: runtime_image_digest || 'RUNTIME_IMAGE_NOT_PROVIDED',
    certificate_pin: certificate_fingerprint || 'CERT_FINGERPRINT_NOT_PROVIDED',
    registry_file: path.relative(REPO_ROOT, registry_file),
    pinned_at: new Date().toISOString(),
  };
  const missing = Object.entries(pins)
    .filter(([k, v]) => k !== 'pinned_at' && (v == null || v === ''))
    .map(([k]) => k);
  pins.pin_status = missing.length === 0 ? 'COMPLETE' : 'INCOMPLETE';
  pins.missing = missing;
  pins.pin_set_hash = sha(JSON.stringify(pins));
  return pins;
}

/**
 * Explicit fixture synthetic pins — cannot satisfy live product evidence.
 */
export function pinFixtureSynthetic(partial = {}) {
  const pins = {
    pin_source: PIN_SOURCE.FIXTURE_SYNTHETIC_PIN,
    prompt_configuration_id: partial.prompt_configuration_id || 'fixture-c01',
    prompt_hash: sha(`prompt|${partial.prompt_configuration_id || 'fixture'}`),
    system_prompt_hash: sha(`system|fixture`),
    model_tier: partial.model_tier || 'deterministic',
    model_identifier: 'fixture-model',
    model_configuration_hash: sha('fixture-model-cfg'),
    retrieval_mode_requested: 'keyword',
    retrieval_mode_executed: 'keyword',
    retrieval_configuration_hash: sha('fixture-retrieval'),
    reranker_version: 'fixture-rerank',
    tool_configuration_hash: sha('fixture-tools'),
    embedding_version: 'fixture-emb',
    schema_version: 'phase34-intelligence-v1',
    runtime_image_pin: 'FIXTURE',
    certificate_pin: 'FIXTURE',
    pinned_at: new Date().toISOString(),
  };
  pins.pin_status = 'COMPLETE';
  pins.missing = [];
  pins.pin_set_hash = sha(JSON.stringify(pins));
  return pins;
}

export const INVOCATION_STATUS = Object.freeze({
  EXECUTED_AND_OBSERVED: 'EXECUTED_AND_OBSERVED',
  EXECUTED_NOT_TIMED: 'EXECUTED_NOT_TIMED',
  NOT_INVOKED_BY_POLICY: 'NOT_INVOKED_BY_POLICY',
  NOT_INSTRUMENTED: 'NOT_INSTRUMENTED',
  FAILED: 'FAILED',
});

/**
 * Build invocation ledger with honest status classification.
 * Deterministic rule engines → model NOT_INVOKED_BY_POLICY.
 */
export function buildObservedInvocationLedger({ session_id, turn_id, pins, pipelineObservation = {} }) {
  const deterministic = String(pins?.model_tier || '').includes('rule') || pins?.model_identifier === 'rule-engine';
  const components = [
    'evidence_assembler',
    'embedding',
    'retrieval',
    'reranker',
    'deterministic_engine',
    'model',
    'tool',
    'schema_validator',
    'evidence_validator',
    'privacy_validator',
    'safety_validator',
  ];

  return components.map((component) => {
    const obs = pipelineObservation[component] || {};
    let status = obs.status || INVOCATION_STATUS.NOT_INSTRUMENTED;
    if (component === 'model' && deterministic && !obs.status) {
      status = INVOCATION_STATUS.NOT_INVOKED_BY_POLICY;
    }
    if (component === 'deterministic_engine' && deterministic && !obs.status) {
      status = INVOCATION_STATUS.EXECUTED_NOT_TIMED;
    }
    if (['schema_validator', 'evidence_validator', 'privacy_validator', 'safety_validator'].includes(component) && !obs.status) {
      status = INVOCATION_STATUS.EXECUTED_NOT_TIMED;
    }
    return {
      invocation_id: `inv_${sha(`${session_id}|${turn_id}|${component}`).slice(0, 16)}`,
      session_id,
      turn_id,
      component,
      version: obs.version || pins?.embedding_version || null,
      configuration_hash: obs.configuration_hash || pins?.pin_set_hash || null,
      started_at: obs.started_at || null,
      finished_at: obs.finished_at || null,
      duration_us: obs.duration_us ?? null,
      sanitized_input_hash: obs.sanitized_input_hash || null,
      sanitized_output_hash: obs.sanitized_output_hash || null,
      result: status,
      failure_class: obs.failure_class || null,
      observation_status: status,
    };
  });
}

export function assertLivePinsNotSynthetic(pins) {
  if (pins?.pin_source === PIN_SOURCE.FIXTURE_SYNTHETIC_PIN) {
    const err = new Error('FIXTURE_SYNTHETIC_PIN cannot satisfy live product evidence');
    err.code = 'PHASE34_PRODUCT_FIXTURE_PIN_NOT_LIVE';
    throw err;
  }
  if (pins?.pin_source !== PIN_SOURCE.LIVE_REGISTRY) {
    const err = new Error('live pins must come from LIVE_REGISTRY');
    err.code = 'PHASE34_PRODUCT_PIN_SOURCE_INVALID';
    throw err;
  }
  return true;
}
