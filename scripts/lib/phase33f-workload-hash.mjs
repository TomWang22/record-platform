/**
 * Phase 33F canonical workload hashing.
 *
 * Manifest SHA hashes exact probe-row JSON (or manifest file bytes when asked).
 * Canonical workload hash hashes only normalized logical coordinates — never run ID,
 * evidence paths, launch SHA, or other volatile launch metadata.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { hashManifest } from './phase33f-manifest.mjs';

export const WORKLOAD_HASH_SERIALIZATION_VERSION = 'phase33f-workload-v1';

/** Stable JSON with sorted object keys (arrays preserve order). */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function fixtureInputHash(row) {
  const payload = {
    request: row.request ?? null,
    fixture_sources: row.fixture_sources ?? null,
    conversation_or_session_id: row.conversation_or_session_id ?? null,
    turns: row.turns ?? null,
    memory_classes: row.memory_classes ?? null,
    principal_fixture: row.principal_fixture ?? null,
  };
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

/**
 * Normalize one probe into a logical coordinate (excludes volatile fields).
 * Protocol is retained because the gauntlet contract is cross-protocol parity
 * over the same scenario family; probe_id is excluded in favor of scenario + protocol.
 */
export function normalizeWorkloadCoordinate(row) {
  return {
    capability: row.capability ?? null,
    scenario_id: row.scenario_id ?? null,
    capability_mode: row.capability_mode ?? null,
    participant_side: row.participant_side ?? null,
    authorization_scopes: [...(row.authorization_scopes || [])].sort(),
    prohibited_scopes: [...(row.prohibited_scopes || [])].sort(),
    case_class: row.tags ?? null,
    prompt_input_fixture_hash: fixtureInputHash(row),
    expected_schema: row.expected_schema ?? null,
    expected_behavior: row.expected_behavior ?? null,
    expected_authorization: {
      scopes: [...(row.authorization_scopes || [])].sort(),
      prohibited: [...(row.prohibited_scopes || [])].sort(),
    },
    expected_safety: row.expected_safety ?? null,
    expected_evidence: row.expected_evidence ?? null,
    expected_privacy: row.expected_privacy ?? null,
    expected_abstention: row.expected_abstention ?? null,
    memory_recall: {
      turns: row.turns ?? null,
      memory_classes: [...(row.memory_classes || [])].sort(),
      conversation_or_session_id_present: row.conversation_or_session_id != null,
    },
    protocol: row.protocol ?? null,
    seed: row.seed ?? null,
    schema_version: row.schema_version ?? null,
    production_mutation_allowed: row.production_mutation_allowed === false ? false : row.production_mutation_allowed,
  };
}

export function orderWorkloadCoordinates(coordinates) {
  return [...coordinates].sort((a, b) => {
    const ka = `${a.capability}\0${a.scenario_id}\0${a.protocol}\0${a.seed}`;
    const kb = `${b.capability}\0${b.scenario_id}\0${b.protocol}\0${b.seed}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

export function hashCanonicalWorkload(rows, { version = WORKLOAD_HASH_SERIALIZATION_VERSION } = {}) {
  const coordinates = orderWorkloadCoordinates(rows.map(normalizeWorkloadCoordinate));
  const duplicateKeys = new Map();
  for (const c of coordinates) {
    const key = `${c.capability}|${c.scenario_id}|${c.protocol}|${c.seed}`;
    duplicateKeys.set(key, (duplicateKeys.get(key) || 0) + 1);
  }
  const duplicates = [...duplicateKeys.values()].filter((n) => n > 1).length;
  const body = {
    serialization_version: version,
    coordinate_count: coordinates.length,
    coordinates,
  };
  const digest = crypto.createHash('sha256').update(stableStringify(body)).digest('hex');
  return {
    serialization_version: version,
    canonical_workload_hash: digest,
    coordinate_count: coordinates.length,
    duplicate_coordinate_keys: duplicates,
    coordinates,
  };
}

/** Hash of exact in-memory probe-row array (manifest content hash). */
export function computeManifestShaFromRows(rows) {
  return hashManifest(rows);
}

/** Hash of exact on-disk manifest file bytes. */
export function computeManifestFileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Legacy accidental hash used in early canary reports: probe_id/batch_id/capability/protocol/seed.
 * Retained only for audit classification against historical 0e20147d… values.
 */
export function legacyProbeIdWorkloadHash(rows) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(rows.map((r) => ({
      probe_id: r.probe_id,
      batch_id: r.batch_id,
      capability: r.capability,
      protocol: r.protocol,
      seed: r.seed,
    }))))
    .digest('hex');
}

export function classifyWorkloadHashReport({
  reportedWorkloadHash,
  manifestSha,
  recomputedWorkloadHash,
  previousWorkloadHash = null,
  legacyHash = null,
}) {
  if (reportedWorkloadHash && reportedWorkloadHash === manifestSha && reportedWorkloadHash !== recomputedWorkloadHash) {
    return {
      classification: 'CANONICAL_WORKLOAD_HASH_REPORTING_DEFECT',
      reason: 'reported workload hash equaled manifest SHA instead of canonical workload coordinates',
    };
  }
  if (legacyHash && previousWorkloadHash && previousWorkloadHash === legacyHash) {
    return {
      classification: 'LEGACY_COORDINATE_SUBSET_HASH',
      reason: 'previous hash matched legacy probe_id/batch_id/capability/protocol/seed serialization',
    };
  }
  if (reportedWorkloadHash === recomputedWorkloadHash) {
    return {
      classification: 'MATCH',
      reason: 'reported workload hash matches recomputed canonical hash',
    };
  }
  return {
    classification: 'MISMATCH',
    reason: 'reported workload hash does not match recomputed canonical hash',
  };
}
