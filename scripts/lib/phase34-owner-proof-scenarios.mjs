/**
 * Load and validate the committed 24 golden owner-proof scenarios.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const OWNER_PROOF_SCENARIOS_PATH = path.join(
  __dirname,
  '../ai-platform/phase34-owner-proof-scenarios.json',
);

export function loadOwnerProofScenarios() {
  const raw = JSON.parse(fs.readFileSync(OWNER_PROOF_SCENARIOS_PATH, 'utf8'));
  validateOwnerProofRegistry(raw);
  return raw;
}

export function validateOwnerProofRegistry(raw) {
  if (!raw || raw.schema_version !== 'phase34-owner-proof-scenarios-v1') {
    throw new Error('owner_proof_registry_schema');
  }
  if (!Array.isArray(raw.scenarios) || raw.scenarios.length !== 24) {
    throw new Error(`owner_proof_count_expected_24_got_${raw.scenarios?.length}`);
  }
  const byCap = new Map();
  for (const s of raw.scenarios) {
    if (!s.id || !s.capability || !s.class || !s.user_intent) {
      throw new Error(`owner_proof_incomplete:${s?.id || '?'}`);
    }
    byCap.set(s.capability, (byCap.get(s.capability) || 0) + 1);
  }
  for (const [cap, n] of byCap) {
    if (n !== 3) throw new Error(`owner_proof_capability_${cap}_expected_3_got_${n}`);
  }
  if (byCap.size !== 8) throw new Error(`owner_proof_capabilities_expected_8_got_${byCap.size}`);
  const nego = raw.scenarios.find((s) => s.id === 'negotiation-four-turn-live');
  if (!nego?.turns || nego.turns.length !== 4) {
    throw new Error('owner_proof_negotiation_four_turns_required');
  }
  return true;
}

export function ownerProofScenarioById(id) {
  return loadOwnerProofScenarios().scenarios.find((s) => s.id === id) || null;
}

export function ownerProofScenariosForCapability(capability) {
  return loadOwnerProofScenarios().scenarios.filter((s) => s.capability === capability);
}
