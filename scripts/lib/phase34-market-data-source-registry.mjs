/**
 * Phase 34 rights-aware market-data source registry helpers.
 * Load / hash / enablement checks without reading secret values.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REGISTRY_PATH = path.resolve(
  __dirname,
  '../ai-platform/phase34-market-data-source-registry.json',
);

export const REGISTRY_VERSION = 'phase34-market-data-source-v1';

export const SOURCE_REQUIRED_FIELDS = [
  'source_id',
  'source_name',
  'source_owner',
  'source_type',
  'access_method',
  'credentials_reference',
  'rights_status',
  'license',
  'terms_verified_at',
  'allowed_uses',
  'prohibited_uses',
  'allowed_fields',
  'prohibited_fields',
  'retention_policy',
  'cache_policy',
  'refresh_policy',
  'attribution_requirement',
  'commercial_use_status',
  'model_training_status',
  'retrieval_use_status',
  'analytics_use_status',
  'display_use_status',
  'connector_status',
  'approval_reference',
  'contact_reference',
  'notes',
];

export const RIGHTS_MAY_ENABLE = new Set([
  'FIRST_PARTY',
  'USER_AUTHORIZED',
  'CC0',
  'PUBLIC_DOMAIN',
  'LICENSED',
]);

export const CONNECTOR_DISABLED_PREFIX = 'DISABLED';

/** Rights that must never have connector_status ENABLED. */
export const RIGHTS_MUST_DISABLE = new Set(['UNKNOWN', 'PROHIBITED']);

/**
 * Discogs restricted marketplace must stay disabled regardless of any narrow
 * RESTRICTED exception path used elsewhere.
 */
export const DISCOGS_RESTRICTED_SOURCE_ID = 'discogs-restricted-marketplace';

export function defaultRegistryPath() {
  return DEFAULT_REGISTRY_PATH;
}

export function loadRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  const abs = path.resolve(registryPath);
  const raw = fs.readFileSync(abs, 'utf8');
  const doc = JSON.parse(raw);
  if (!doc || typeof doc !== 'object') {
    throw new Error('registry_not_object');
  }
  if (!Array.isArray(doc.sources)) {
    throw new Error('registry_sources_missing');
  }
  return doc;
}

export function sha256Registry(registryPath = DEFAULT_REGISTRY_PATH) {
  const abs = path.resolve(registryPath);
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

export function enabledSources(registry) {
  return (registry.sources || []).filter((s) => s.connector_status === 'ENABLED');
}

export function disabledSources(registry) {
  return (registry.sources || []).filter((s) =>
    String(s.connector_status || '').startsWith(CONNECTOR_DISABLED_PREFIX),
  );
}

function textDocumentsNarrowApprovedUse(source) {
  const blob = `${source.approval_reference || ''}\n${source.notes || ''}`.toLowerCase();
  return (
    blob.includes('narrow approved use') ||
    blob.includes('narrowly documented approved use') ||
    blob.includes('written narrow approval') ||
    (Boolean(source.approval_reference) &&
      source.approval_reference !== 'none' &&
      blob.includes('approved use'))
  );
}

/**
 * Enforce connector enablement rules for one source row.
 * Throws Error with code CONNECTOR_ENABLEMENT_FAIL on violation.
 */
export function assertConnectorEnablement(source) {
  const rights = source.rights_status;
  const status = source.connector_status;
  const enabled = status === 'ENABLED';
  const disabled = String(status || '').startsWith(CONNECTOR_DISABLED_PREFIX);

  if (!enabled && !disabled) {
    const err = new Error(`invalid_connector_status:${source.source_id}:${status}`);
    err.code = 'CONNECTOR_ENABLEMENT_FAIL';
    throw err;
  }

  if (source.source_id === DISCOGS_RESTRICTED_SOURCE_ID && enabled) {
    const err = new Error(
      `discogs_restricted_must_remain_disabled:${source.source_id}:${status}`,
    );
    err.code = 'CONNECTOR_ENABLEMENT_FAIL';
    throw err;
  }

  if (RIGHTS_MUST_DISABLE.has(rights) && enabled) {
    const err = new Error(`rights_requires_disabled:${source.source_id}:${rights}:${status}`);
    err.code = 'CONNECTOR_ENABLEMENT_FAIL';
    throw err;
  }

  if (enabled && !RIGHTS_MAY_ENABLE.has(rights)) {
    if (rights === 'RESTRICTED') {
      if (!textDocumentsNarrowApprovedUse(source)) {
        const err = new Error(
          `restricted_enabled_without_narrow_approval:${source.source_id}`,
        );
        err.code = 'CONNECTOR_ENABLEMENT_FAIL';
        throw err;
      }
    } else {
      const err = new Error(`rights_cannot_enable:${source.source_id}:${rights}:${status}`);
      err.code = 'CONNECTOR_ENABLEMENT_FAIL';
      throw err;
    }
  }

  return true;
}

export function assertAllConnectorEnablement(registry) {
  for (const source of registry.sources || []) {
    assertConnectorEnablement(source);
  }
  return true;
}

export function assertRequiredSourceFields(source) {
  const missing = SOURCE_REQUIRED_FIELDS.filter((f) => !(f in source));
  if (missing.length) {
    const err = new Error(`missing_fields:${source.source_id || '?'}:${missing.join(',')}`);
    err.code = 'REGISTRY_FIELD_FAIL';
    throw err;
  }
  return true;
}

/**
 * Summarize Discogs / restricted posture for verify output.
 * Never reads env secret values — only credential reference strings.
 */
export function summarizeRestrictedPosture(registry) {
  const byId = Object.fromEntries((registry.sources || []).map((s) => [s.source_id, s]));
  const cc0 = byId['discogs-cc0-catalog'];
  const restricted = byId[DISCOGS_RESTRICTED_SOURCE_ID];
  const popsike = byId['popsike-historical-auction-archive'];
  const gripsweat = byId['gripsweat-historical-sales-archive'];

  return {
    discogs_cc0: cc0
      ? {
          source_id: cc0.source_id,
          rights_status: cc0.rights_status,
          license: cc0.license,
          connector_status: cc0.connector_status,
          access_method: cc0.access_method,
          credentials_reference: cc0.credentials_reference,
          retrieval_use_status: cc0.retrieval_use_status,
          model_training_status: cc0.model_training_status,
        }
      : null,
    discogs_restricted: restricted
      ? {
          source_id: restricted.source_id,
          rights_status: restricted.rights_status,
          connector_status: restricted.connector_status,
          credentials_reference: restricted.credentials_reference,
          note: 'secret_value_never_read',
        }
      : null,
    popsike: popsike
      ? {
          source_id: popsike.source_id,
          rights_status: popsike.rights_status,
          connector_status: popsike.connector_status,
          source_type: popsike.source_type,
        }
      : null,
    gripsweat: gripsweat
      ? {
          source_id: gripsweat.source_id,
          rights_status: gripsweat.rights_status,
          connector_status: gripsweat.connector_status,
          source_type: gripsweat.source_type,
        }
      : null,
  };
}
