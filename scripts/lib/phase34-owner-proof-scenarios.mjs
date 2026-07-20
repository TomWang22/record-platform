/**
 * Load and validate the committed 24 golden owner-proof scenarios (executable v2).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const OWNER_PROOF_SCENARIOS_PATH = path.join(
  __dirname,
  '../ai-platform/phase34-owner-proof-scenarios.json',
);
export const OWNER_PROOF_SEED_MANIFEST_PATH = path.join(
  __dirname,
  '../ai-platform/phase34-owner-proof-seed-manifest.json',
);

export const OWNER_PROOF_REHEARSAL_ROOT = '/tmp/phase34-owner-proof-live-rehearsal-v2';
export const OWNER_PROOF_RECAPTURE_V4_ROOT = '/tmp/phase34-owner-proof-live-recapture-v4';
export const OWNER_PROOF_RECAPTURE_V4_EXPORT = path.join(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  'owner-review-artifacts/phase34/owner-proof-live-v4',
);
export const OWNER_PROOF_RECAPTURE_V5_ROOT = '/tmp/phase34-owner-proof-live-recapture-v5';
export const OWNER_PROOF_RECAPTURE_V5_ATTEMPT2_ROOT =
  '/tmp/phase34-owner-proof-live-recapture-v5-attempt-2';
export const OWNER_PROOF_RECAPTURE_V5_EXPORT = path.join(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  'owner-review-artifacts/phase34/owner-proof-live-v5',
);
export const OWNER_PROOF_LIVE_ACTION_PREFLIGHT_ROOT =
  '/tmp/phase34-owner-proof-live-action-preflight-v1';
export const OWNER_PROOF_MINI_PROOF_ROOT = '/tmp/phase34-owner-proof-mini-proof-v1';

const REQUIRED_FIELDS = Object.freeze([
  'scenario_id',
  'capability',
  'scenario_class',
  'participant_side',
  'authentication_role',
  'viewport',
  'canonical_route',
  'seed_fixture_id',
  'subject_entity_id',
  'user_intent',
  'input_control_selector',
  'input_value',
  'initiating_action_selector',
  'initiating_action',
  'expected_endpoint',
  'expected_method',
  'expected_request_capability',
  'terminal_panel_selector',
  'required_visible_customer_fields',
  'required_hidden_internal_fields',
  'minimum_evidence',
  'expected_terminal_state',
  'required_screenshot_states',
  'required_protocols',
  'human_review_question',
  'action_proof_status',
]);

export const ACTION_PROOF_STATUSES = Object.freeze([
  'DECLARED',
  'STATICALLY_VALIDATED',
  'LIVE_ACTION_PROVEN',
  'LIVE_RESULT_PROVEN',
]);

export const OFFICIAL_REHEARSAL_MIN_ACTION_PROOF = 'LIVE_RESULT_PROVEN';

export function loadOwnerProofScenarios() {
  const raw = JSON.parse(fs.readFileSync(OWNER_PROOF_SCENARIOS_PATH, 'utf8'));
  validateOwnerProofExecutableRegistry(raw);
  return raw;
}

export function loadOwnerProofSeedManifest() {
  return JSON.parse(fs.readFileSync(OWNER_PROOF_SEED_MANIFEST_PATH, 'utf8'));
}

export function validateOwnerProofRegistry(raw) {
  return validateOwnerProofExecutableRegistry(raw);
}

export function validateOwnerProofExecutableRegistry(raw) {
  if (!raw || raw.schema_version !== 'phase34-owner-proof-scenarios-v2') {
    throw new Error('owner_proof_registry_schema_expected_v2');
  }
  if (!Array.isArray(raw.scenarios) || raw.scenarios.length !== 24) {
    throw new Error(`owner_proof_count_expected_24_got_${raw.scenarios?.length}`);
  }
  if (!raw.rehearsal || raw.rehearsal.total_turns !== 27 || raw.rehearsal.protocol_rows !== 81) {
    throw new Error('owner_proof_rehearsal_scale_invalid');
  }
  const byCap = new Map();
  const byClass = new Map();
  for (const s of raw.scenarios) {
    for (const f of REQUIRED_FIELDS) {
      if (s[f] === undefined || s[f] === null || s[f] === '') {
        throw new Error(`owner_proof_missing_field:${s.scenario_id || '?'}:${f}`);
      }
    }
    if (!ACTION_PROOF_STATUSES.includes(s.action_proof_status)) {
      throw new Error(`owner_proof_invalid_action_proof_status:${s.scenario_id}:${s.action_proof_status}`);
    }
    // Committed registry may be STATICALLY_VALIDATED; live preflight promotes to LIVE_RESULT_PROVEN.
    if (s.action_proof_status === 'DECLARED') {
      throw new Error(`owner_proof_still_declared:${s.scenario_id}`);
    }
    if (s.expected_request_capability !== s.capability) {
      throw new Error(`owner_proof_capability_mismatch:${s.scenario_id}`);
    }
    if (s.scenario_class === 'A_success' && s.allow_empty_evidence) {
      throw new Error(`owner_proof_success_empty_evidence:${s.scenario_id}`);
    }
    byCap.set(s.capability, (byCap.get(s.capability) || 0) + 1);
    byClass.set(s.scenario_class, (byClass.get(s.scenario_class) || 0) + 1);
  }
  for (const [cap, n] of byCap) {
    if (n !== 3) throw new Error(`owner_proof_capability_${cap}_expected_3_got_${n}`);
  }
  if (byCap.size !== 8) throw new Error(`owner_proof_capabilities_expected_8_got_${byCap.size}`);
  if (byClass.get('A_success') !== 8 || byClass.get('B_correction') !== 8 || byClass.get('C_honest_limit') !== 8) {
    throw new Error('owner_proof_class_balance_expected_8_each');
  }
  const nego = raw.scenarios.find((s) => s.scenario_id === 'negotiation-four-turn-live');
  if (!nego?.turns || nego.turns.length !== 4) {
    throw new Error('owner_proof_negotiation_four_turns_required');
  }
  return true;
}

export function validateSeedManifestAgainstScenarios(scenariosDoc, seedManifest) {
  const ids = new Set((seedManifest.fixtures || []).map((f) => f.seed_fixture_id));
  const missing = [];
  for (const s of scenariosDoc.scenarios) {
    if (!ids.has(s.seed_fixture_id)) missing.push(s.seed_fixture_id);
  }
  if (missing.length) {
    const err = new Error(`MISSING_OWNER_PROOF_EVIDENCE:${missing.join(',')}`);
    err.code = 'MISSING_OWNER_PROOF_EVIDENCE';
    throw err;
  }
  for (const f of seedManifest.fixtures || []) {
    const listing = f.listing;
    if (listing && /\[sold\]/i.test(String(listing.title || '')) && String(listing.status).toLowerCase() === 'active') {
      const err = new Error(`SOLD_STATUS_CONTRADICTION:${f.seed_fixture_id}`);
      err.code = 'SOLD_STATUS_CONTRADICTION';
      throw err;
    }
    const cover = f.record?.cover_image || '';
    if (/picsum\.photos|loremflickr|unsplash\.com/i.test(cover)) {
      const err = new Error(`ENTITY_MEDIA_MISMATCH:${f.seed_fixture_id}`);
      err.code = 'ENTITY_MEDIA_MISMATCH';
      throw err;
    }
  }
  return true;
}

export function ownerProofScenarioById(id) {
  return loadOwnerProofScenarios().scenarios.find((s) => s.scenario_id === id) || null;
}

export function ownerProofScenariosForCapability(capability) {
  return loadOwnerProofScenarios().scenarios.filter((s) => s.capability === capability);
}

export function rehearsalTurnCount(doc = null) {
  const d = doc || loadOwnerProofScenarios();
  return d.rehearsal.total_turns;
}
