/**
 * Phase G — real-data and rights posture.
 *
 * Connector contracts, license gates, Discogs catalog-only policy,
 * deletion propagation, and owner-dossier rights/provenance helpers.
 *
 * Preferred evidence only. Popsike / Gripsweat stay disabled without a
 * written license record. Discogs marketplace/sales stay blocked.
 * API keys are referenced via env/secret names only — never printed.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const RIGHTS_CONNECTORS_VERSION = 'phase34-rights-connectors-v1';

/** Typed error codes used by gates and tests. */
export const RIGHTS_ERROR_CODES = Object.freeze({
  CONNECTOR_CONTRACT_REQUIRES_ID: 'CONNECTOR_CONTRACT_REQUIRES_ID',
  CONNECTOR_CONTRACT_REQUIRES_RIGHTS_STATUS: 'CONNECTOR_CONTRACT_REQUIRES_RIGHTS_STATUS',
  FORBIDDEN_CONNECTOR_ENABLEMENT: 'FORBIDDEN_CONNECTOR_ENABLEMENT',
  UNLICENSED_CONNECTOR_ENABLEMENT: 'UNLICENSED_CONNECTOR_ENABLEMENT',
  LICENSE_GATE_REQUIRED: 'LICENSE_GATE_REQUIRED',
  DISCOGS_RESTRICTED_MUST_STAY_DISABLED: 'DISCOGS_RESTRICTED_MUST_STAY_DISABLED',
  DISCOGS_CATALOG_ONLY_VIOLATION: 'DISCOGS_CATALOG_ONLY_VIOLATION',
  DISCOGS_MARKET_ENDPOINTS_BLOCKED: 'DISCOGS_MARKET_ENDPOINTS_BLOCKED',
  DISCOGS_SECRET_LEAK_FORBIDDEN: 'DISCOGS_SECRET_LEAK_FORBIDDEN',
  MISSING_RIGHTS_CLASS: 'MISSING_RIGHTS_CLASS',
  CONNECTOR_DISABLED: 'CONNECTOR_DISABLED',
  PRODUCTION_FORBIDDEN_CONNECTOR_ENV: 'PRODUCTION_FORBIDDEN_CONNECTOR_ENV',
});

export const CONNECTOR_CONTRACT_IDS = Object.freeze([
  'FIRST_PARTY_SETTLEMENTS',
  'FIRST_PARTY_LISTINGS',
  'FIRST_PARTY_OFFERS',
  'FIRST_PARTY_AUCTIONS',
  'FIRST_PARTY_BIDS',
  'FIRST_PARTY_WATCHLISTS',
  'FIRST_PARTY_COLLECTIONS',
  'FIRST_PARTY_PREFERENCES',
  'FIRST_PARTY_MESSAGES',
  'PERMITTED_PUBLIC_CATALOG',
  'LICENSED_EXTERNAL_ARCHIVE',
]);

export const EVIDENCE_CLASSES = Object.freeze([
  'COMPLETED_SETTLEMENT',
  'ASKING_LISTING',
  'OFFER',
  'AUCTION_ACTIVITY',
  'BID_EVENT',
  'CATALOG_METADATA',
  'USER_COLLECTION',
  'WATCHLIST',
  'USER_PREFERENCE',
  'AUTHORIZED_MESSAGE',
  'LICENSED_ARCHIVE_SALE',
]);

/** Rights statuses that may yield INCLUDED evidence when connector is ENABLED. */
export const PERMITTED_RIGHTS_STATUSES = Object.freeze([
  'FIRST_PARTY',
  'USER_AUTHORIZED',
  'CC0',
  'PUBLIC_DOMAIN',
  'LICENSED',
]);

/** Rights that must never produce INCLUDED evidence. */
export const FORBIDDEN_RIGHTS_STATUSES = Object.freeze([
  'FORBIDDEN',
  'UNLICENSED',
  'PROHIBITED',
  'UNKNOWN',
]);

/** Sources that must stay disabled without a written license grant record. */
export const DISABLED_WITHOUT_WRITTEN_RIGHTS = Object.freeze([
  'popsike-historical-auction-archive',
  'gripsweat-historical-sales-archive',
  'discogs-restricted-marketplace',
]);

export const POPSIKE_SOURCE_ID = 'popsike-historical-auction-archive';
export const GRIPSWEAT_SOURCE_ID = 'gripsweat-historical-sales-archive';
export const DISCOGS_RESTRICTED_SOURCE_ID = 'discogs-restricted-marketplace';
export const DISCOGS_CATALOG_SOURCE_ID = 'discogs-cc0-catalog';

/** Env vars that cannot enable forbidden archives via ordinary runtime config. */
export const FORBIDDEN_ENABLE_ENV_KEYS = Object.freeze([
  'POPSIKE_ENABLED',
  'GRIPSWEAT_ENABLED',
  'DISCOGS_MARKETPLACE_ENABLED',
]);

export const DISCOGS_API_KEY_ENV = 'DISCOGS_API_KEY';
export const DISCOGS_API_KEY_REF = `env:${DISCOGS_API_KEY_ENV}`;

/** Discogs marketplace/sales path prefixes that stay blocked. */
export const DISCOGS_BLOCKED_MARKET_PATHS = Object.freeze([
  '/marketplace/',
  '/orders',
  '/inventory',
  '/fee/',
  '/price_suggestions/',
]);

export const DISCOGS_CATALOG_ONLY_POLICY = Object.freeze({
  source_id: DISCOGS_CATALOG_SOURCE_ID,
  allowed_evidence_class: 'CATALOG_METADATA',
  prohibited_evidence_classes: [
    'COMPLETED_SETTLEMENT',
    'ASKING_LISTING',
    'AUCTION_ACTIVITY',
    'BID_EVENT',
    'LICENSED_ARCHIVE_SALE',
    'OFFER',
  ],
  catalog_presence_is_not: Object.freeze([
    'market_availability',
    'sale_evidence',
    'completed_settlement',
  ]),
  notes:
    'Discogs CC0 / permitted catalog metadata only. Catalog presence is not market availability or sale evidence. Restricted marketplace stays disabled. API key via env/secret only — never print or commit.',
});

function rightsError(code, message, extra = {}) {
  const err = new Error(message || code);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

/**
 * Connector contract shape for Phase G enablement reviews.
 */
export function buildConnectorContract({
  connector_id,
  rights_status,
  permitted_purposes = [],
  retention_policy = 'product_lifecycle_with_deletion_honored',
  deletion_policy = 'propagate_to_retrieval_and_snapshots',
  attribution_requirement = 'none_internal',
  freshness_policy = 'bounded_ttl',
  rate_limits = { requests_per_minute: null },
  evidence_classes = [],
  connector_status = 'DISABLED_PENDING_RIGHTS',
  approval_reference = null,
  notes = '',
  source_ids = [],
  credentials_reference = 'none',
} = {}) {
  if (!connector_id) {
    throw rightsError(
      RIGHTS_ERROR_CODES.CONNECTOR_CONTRACT_REQUIRES_ID,
      'CONNECTOR_CONTRACT_REQUIRES_ID',
    );
  }
  if (!rights_status) {
    throw rightsError(
      RIGHTS_ERROR_CODES.CONNECTOR_CONTRACT_REQUIRES_RIGHTS_STATUS,
      'CONNECTOR_CONTRACT_REQUIRES_RIGHTS_STATUS',
    );
  }
  return Object.freeze({
    contract_version: RIGHTS_CONNECTORS_VERSION,
    connector_id,
    rights_status,
    permitted_purposes: [...permitted_purposes],
    retention_policy,
    deletion_policy,
    attribution_requirement,
    freshness_policy,
    rate_limits: { ...rate_limits },
    evidence_classes: [...evidence_classes],
    connector_status,
    approval_reference,
    notes,
    source_ids: [...source_ids],
    credentials_reference,
  });
}

/**
 * Default contracts for every preferred source class + licensed archive slot.
 */
export function defaultConnectorContracts() {
  return Object.freeze({
    FIRST_PARTY_SETTLEMENTS: buildConnectorContract({
      connector_id: 'FIRST_PARTY_SETTLEMENTS',
      rights_status: 'FIRST_PARTY',
      permitted_purposes: ['retrieval', 'analytics', 'display', 'evidence_snapshots'],
      evidence_classes: ['COMPLETED_SETTLEMENT'],
      connector_status: 'ENABLED',
      approval_reference: 'phase34-first-party-platform-data',
      source_ids: ['fp-completed-sales'],
      notes: 'Preferred completed-sale evidence from platform settlements only.',
    }),
    FIRST_PARTY_LISTINGS: buildConnectorContract({
      connector_id: 'FIRST_PARTY_LISTINGS',
      rights_status: 'FIRST_PARTY',
      permitted_purposes: ['retrieval', 'analytics', 'display', 'evidence_snapshots'],
      evidence_classes: ['ASKING_LISTING'],
      connector_status: 'ENABLED',
      approval_reference: 'phase34-first-party-platform-data',
      source_ids: ['fp-marketplace-listings', 'fp-seller-inventory', 'fp-availability-changes'],
    }),
    FIRST_PARTY_OFFERS: buildConnectorContract({
      connector_id: 'FIRST_PARTY_OFFERS',
      rights_status: 'FIRST_PARTY',
      permitted_purposes: ['retrieval_scoped', 'display_scoped', 'evidence_snapshots_scoped'],
      evidence_classes: ['OFFER'],
      connector_status: 'ENABLED',
      approval_reference: 'phase34-first-party-platform-data',
      source_ids: ['fp-offers'],
    }),
    FIRST_PARTY_AUCTIONS: buildConnectorContract({
      connector_id: 'FIRST_PARTY_AUCTIONS',
      rights_status: 'FIRST_PARTY',
      permitted_purposes: ['retrieval', 'analytics', 'display', 'evidence_snapshots'],
      evidence_classes: ['AUCTION_ACTIVITY'],
      connector_status: 'ENABLED',
      approval_reference: 'phase34-first-party-platform-data',
      source_ids: ['fp-auction-events'],
    }),
    FIRST_PARTY_BIDS: buildConnectorContract({
      connector_id: 'FIRST_PARTY_BIDS',
      rights_status: 'FIRST_PARTY',
      permitted_purposes: ['retrieval', 'analytics', 'display', 'evidence_snapshots'],
      evidence_classes: ['BID_EVENT'],
      connector_status: 'ENABLED',
      approval_reference: 'phase34-first-party-platform-data',
      source_ids: ['fp-auction-events'],
      notes: 'Authorized first-party bid history only.',
    }),
    FIRST_PARTY_WATCHLISTS: buildConnectorContract({
      connector_id: 'FIRST_PARTY_WATCHLISTS',
      rights_status: 'USER_AUTHORIZED',
      permitted_purposes: ['retrieval_scoped', 'display_scoped'],
      evidence_classes: ['WATCHLIST'],
      connector_status: 'ENABLED',
      approval_reference: 'phase34-user-authorized-scope',
      source_ids: ['fp-watchlists'],
    }),
    FIRST_PARTY_COLLECTIONS: buildConnectorContract({
      connector_id: 'FIRST_PARTY_COLLECTIONS',
      rights_status: 'USER_AUTHORIZED',
      permitted_purposes: ['retrieval_scoped', 'display_scoped'],
      evidence_classes: ['USER_COLLECTION'],
      connector_status: 'ENABLED',
      approval_reference: 'phase34-user-authorized-scope',
      source_ids: ['fp-collections'],
    }),
    FIRST_PARTY_PREFERENCES: buildConnectorContract({
      connector_id: 'FIRST_PARTY_PREFERENCES',
      rights_status: 'USER_AUTHORIZED',
      permitted_purposes: ['retrieval_scoped', 'display_scoped'],
      evidence_classes: ['USER_PREFERENCE'],
      connector_status: 'ENABLED',
      approval_reference: 'phase34-user-authorized-scope',
      source_ids: ['fp-preferences'],
    }),
    FIRST_PARTY_MESSAGES: buildConnectorContract({
      connector_id: 'FIRST_PARTY_MESSAGES',
      rights_status: 'USER_AUTHORIZED',
      permitted_purposes: ['retrieval_scoped', 'display_scoped'],
      evidence_classes: ['AUTHORIZED_MESSAGE'],
      connector_status: 'ENABLED',
      approval_reference: 'phase34-user-authorized-scope',
      source_ids: ['fp-authorized-message-threads'],
    }),
    PERMITTED_PUBLIC_CATALOG: buildConnectorContract({
      connector_id: 'PERMITTED_PUBLIC_CATALOG',
      rights_status: 'CC0',
      permitted_purposes: ['retrieval', 'display', 'evidence_snapshots', 'entity_resolution'],
      evidence_classes: ['CATALOG_METADATA'],
      connector_status: 'ENABLED',
      approval_reference: 'discogs-data-dumps-cc0',
      source_ids: [DISCOGS_CATALOG_SOURCE_ID, 'fp-records'],
      credentials_reference: 'none',
      notes: DISCOGS_CATALOG_ONLY_POLICY.notes,
      attribution_requirement: 'source_url_and_license_cc0_in_provenance',
      freshness_policy: 'monthly_dump_when_enabled',
    }),
    LICENSED_EXTERNAL_ARCHIVE: buildConnectorContract({
      connector_id: 'LICENSED_EXTERNAL_ARCHIVE',
      rights_status: 'LICENSED',
      permitted_purposes: ['retrieval', 'analytics', 'display'],
      evidence_classes: ['LICENSED_ARCHIVE_SALE'],
      connector_status: 'DISABLED_PENDING_LICENSE',
      approval_reference: null,
      source_ids: [],
      notes:
        'Enable only with written license grant on file. Popsike/Gripsweat are not this connector by default.',
    }),
  });
}

export function popsikeConnectorContract() {
  return buildConnectorContract({
    connector_id: POPSIKE_SOURCE_ID,
    rights_status: 'PROHIBITED',
    permitted_purposes: [],
    evidence_classes: [],
    connector_status: 'DISABLED_NO_WRITTEN_RIGHTS',
    approval_reference: null,
    source_ids: [POPSIKE_SOURCE_ID],
    notes: 'Do not scrape or simulate Popsike data without written permission.',
  });
}

export function gripsweatConnectorContract() {
  return buildConnectorContract({
    connector_id: GRIPSWEAT_SOURCE_ID,
    rights_status: 'PROHIBITED',
    permitted_purposes: [],
    evidence_classes: [],
    connector_status: 'DISABLED_NO_WRITTEN_RIGHTS',
    approval_reference: null,
    source_ids: [GRIPSWEAT_SOURCE_ID],
    notes: 'Do not scrape or simulate Gripsweat data without written permission.',
  });
}

export function discogsRestrictedConnectorContract() {
  return buildConnectorContract({
    connector_id: DISCOGS_RESTRICTED_SOURCE_ID,
    rights_status: 'RESTRICTED',
    permitted_purposes: [],
    evidence_classes: [],
    connector_status: 'DISABLED_BY_POLICY',
    approval_reference: null,
    source_ids: [DISCOGS_RESTRICTED_SOURCE_ID],
    credentials_reference: DISCOGS_API_KEY_REF,
    notes:
      'Discogs marketplace/user surfaces remain DISABLED_BY_POLICY. credentials_reference names env only — never read/print/commit the secret value.',
  });
}

/** Aliases kept for stub compatibility. */
export const popsikeConnectorStub = popsikeConnectorContract;
export const gripsweatConnectorStub = gripsweatConnectorContract;

/**
 * In-memory append-only license grant store (mirrors SQL registry semantics).
 */
const licenseGrants = [];

export function clearLicenseGrantsForTests() {
  licenseGrants.length = 0;
}

export function listLicenseGrants() {
  return licenseGrants.map((g) => ({ ...g }));
}

/**
 * Record a written license grant (append-only). Does not auto-enable connectors.
 */
export function recordLicenseGrant({
  source_id,
  license_id,
  grantor,
  grantee = 'record-platform',
  permitted_purposes = [],
  evidence_classes = [],
  effective_at = new Date().toISOString(),
  expires_at = null,
  document_reference,
  notes = '',
} = {}) {
  if (!source_id || !license_id || !document_reference) {
    throw rightsError(
      RIGHTS_ERROR_CODES.LICENSE_GATE_REQUIRED,
      'LICENSE_GRANT_REQUIRES_SOURCE_LICENSE_AND_DOCUMENT',
    );
  }
  const grant = Object.freeze({
    grant_id: `lic-${crypto
      .createHash('sha256')
      .update(`${source_id}|${license_id}|${effective_at}|${document_reference}`)
      .digest('hex')
      .slice(0, 24)}`,
    source_id,
    license_id,
    grantor: grantor || 'unknown',
    grantee,
    permitted_purposes: [...permitted_purposes],
    evidence_classes: [...evidence_classes],
    effective_at,
    expires_at,
    document_reference,
    notes,
    recorded_at: new Date().toISOString(),
  });
  licenseGrants.push(grant);
  return grant;
}

export function hasActiveLicenseGrant(sourceId, { now = Date.now(), grants = licenseGrants } = {}) {
  const sid = String(sourceId || '');
  return grants.some((g) => {
    if (g.source_id !== sid) return false;
    if (g.expires_at) {
      const exp = Date.parse(g.expires_at);
      if (Number.isFinite(exp) && exp < now) return false;
    }
    return Boolean(g.document_reference);
  });
}

/**
 * Load optional on-disk license file (JSON array or {grants:[]}).
 * Path via LICENSE_GRANTS_FILE or PHASE34_LICENSE_GRANTS_FILE.
 * Never treats ordinary POPSIKE_ENABLED env as a license.
 */
export function loadLicenseGrantsFromEnv(env = process.env) {
  const filePath = env.LICENSE_GRANTS_FILE || env.PHASE34_LICENSE_GRANTS_FILE;
  if (!filePath) return [];
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw rightsError(
      RIGHTS_ERROR_CODES.LICENSE_GATE_REQUIRED,
      `LICENSE_GRANTS_FILE_MISSING:${abs}`,
    );
  }
  const raw = fs.readFileSync(abs, 'utf8');
  const doc = JSON.parse(raw);
  const grants = Array.isArray(doc) ? doc : Array.isArray(doc.grants) ? doc.grants : [];
  return grants.filter((g) => g && g.source_id && g.document_reference);
}

function resolveLicenseContext(options = {}) {
  const env = options.env || process.env;
  const memory = options.grants || licenseGrants;
  const fromFile = options.skipFile ? [] : loadLicenseGrantsFromEnvSafe(env);
  return [...memory, ...fromFile];
}

function loadLicenseGrantsFromEnvSafe(env) {
  try {
    if (!env.LICENSE_GRANTS_FILE && !env.PHASE34_LICENSE_GRANTS_FILE) return [];
    return loadLicenseGrantsFromEnv(env);
  } catch {
    return [];
  }
}

/**
 * Fail closed: forbidden scrapers cannot be enabled by ordinary config.
 * Requires a written license grant record (memory or LICENSE file) — not env alone.
 */
export function assertConnectorEnablementAllowed(source = {}, options = {}) {
  const sourceId = String(source.source_id || source.connector_id || '');
  const status = String(source.connector_status || '');
  const enabled = status === 'ENABLED';
  const rights = String(source.rights_status || '');
  const grants = resolveLicenseContext(options);

  if (enabled && sourceId === DISCOGS_RESTRICTED_SOURCE_ID) {
    throw rightsError(
      RIGHTS_ERROR_CODES.DISCOGS_RESTRICTED_MUST_STAY_DISABLED,
      'DISCOGS_RESTRICTED_MUST_STAY_DISABLED',
      { source_id: sourceId },
    );
  }

  if (enabled && (sourceId === POPSIKE_SOURCE_ID || sourceId === GRIPSWEAT_SOURCE_ID)) {
    if (!hasActiveLicenseGrant(sourceId, { grants })) {
      throw rightsError(
        RIGHTS_ERROR_CODES.FORBIDDEN_CONNECTOR_ENABLEMENT,
        `FORBIDDEN_CONNECTOR_ENABLEMENT:${sourceId}`,
        { source_id: sourceId },
      );
    }
  }

  if (enabled && DISABLED_WITHOUT_WRITTEN_RIGHTS.includes(sourceId)) {
    if (!hasActiveLicenseGrant(sourceId, { grants })) {
      if (!source.approval_reference || source.approval_reference === 'none') {
        throw rightsError(
          RIGHTS_ERROR_CODES.UNLICENSED_CONNECTOR_ENABLEMENT,
          `UNLICENSED_CONNECTOR_ENABLEMENT:${sourceId}`,
          { source_id: sourceId },
        );
      }
    }
  }

  if (enabled && FORBIDDEN_RIGHTS_STATUSES.includes(rights)) {
    throw rightsError(
      RIGHTS_ERROR_CODES.FORBIDDEN_CONNECTOR_ENABLEMENT,
      `FORBIDDEN_CONNECTOR_ENABLEMENT:${sourceId}:${rights}`,
      { source_id: sourceId, rights_status: rights },
    );
  }

  if (
    enabled &&
    (sourceId === DISCOGS_CATALOG_SOURCE_ID ||
      source.connector_id === 'PERMITTED_PUBLIC_CATALOG') &&
    Array.isArray(source.evidence_classes) &&
    source.evidence_classes.some((c) =>
      DISCOGS_CATALOG_ONLY_POLICY.prohibited_evidence_classes.includes(c),
    )
  ) {
    throw rightsError(
      RIGHTS_ERROR_CODES.DISCOGS_CATALOG_ONLY_VIOLATION,
      'DISCOGS_CATALOG_ONLY_VIOLATION',
      { source_id: sourceId },
    );
  }

  return { ok: true, source_id: sourceId, connector_status: status };
}

/**
 * Attempting to enable Popsike/Gripsweat via ordinary runtime config throws.
 * Only a license grant record (not POPSIKE_ENABLED=1 alone) can satisfy the gate.
 */
export function assertForbiddenArchiveEnablement(sourceId, options = {}) {
  const sid = String(sourceId || '');
  const env = options.env || process.env;
  const grants = resolveLicenseContext({ ...options, env });

  if (sid !== POPSIKE_SOURCE_ID && sid !== GRIPSWEAT_SOURCE_ID) {
    return { ok: true, source_id: sid };
  }

  if (!hasActiveLicenseGrant(sid, { grants })) {
    throw rightsError(
      RIGHTS_ERROR_CODES.FORBIDDEN_CONNECTOR_ENABLEMENT,
      `FORBIDDEN_CONNECTOR_ENABLEMENT:${sid}`,
      { source_id: sid },
    );
  }
  return { ok: true, source_id: sid, licensed: true };
}

/**
 * Production / ordinary runtime: POPSIKE_ENABLED=1 / GRIPSWEAT_ENABLED=1 without
 * LICENSE file/record must throw. Discogs market endpoints always blocked.
 */
export function assertProductionRightsConfig(env = process.env, options = {}) {
  const grants = resolveLicenseContext({ ...options, env });
  const violations = [];

  for (const key of FORBIDDEN_ENABLE_ENV_KEYS) {
    if (env[key] === '1' || String(env[key] || '').toLowerCase() === 'true') {
      const mapped =
        key === 'POPSIKE_ENABLED'
          ? POPSIKE_SOURCE_ID
          : key === 'GRIPSWEAT_ENABLED'
            ? GRIPSWEAT_SOURCE_ID
            : DISCOGS_RESTRICTED_SOURCE_ID;

      if (mapped === DISCOGS_RESTRICTED_SOURCE_ID) {
        violations.push({ key, source_id: mapped, reason: 'discogs_market_always_blocked' });
        continue;
      }
      if (!hasActiveLicenseGrant(mapped, { grants })) {
        violations.push({ key, source_id: mapped, reason: 'no_license_record' });
      }
    }
  }

  if (violations.length) {
    throw rightsError(
      RIGHTS_ERROR_CODES.PRODUCTION_FORBIDDEN_CONNECTOR_ENV,
      `PRODUCTION_FORBIDDEN_CONNECTOR_ENV:${violations.map((v) => v.key).join(',')}`,
      { violations },
    );
  }

  return { ok: true, checked: [...FORBIDDEN_ENABLE_ENV_KEYS] };
}

/**
 * Discogs API key reference only — never returns the secret value.
 */
export function discogsCredentialsReference(env = process.env) {
  const present = Boolean(env[DISCOGS_API_KEY_ENV] && String(env[DISCOGS_API_KEY_ENV]).length > 0);
  return {
    credentials_reference: DISCOGS_API_KEY_REF,
    secret_configured: present,
    // Explicitly omit secret value
    secret_value: undefined,
  };
}

/**
 * Guard against accidental secret printing/serialization.
 */
export function assertNoDiscogsSecretLeakage(text) {
  const s = String(text || '');
  if (/DISCOGS_API_KEY\s*=\s*\S+/i.test(s) && !/env:DISCOGS_API_KEY\b/.test(s)) {
    throw rightsError(
      RIGHTS_ERROR_CODES.DISCOGS_SECRET_LEAK_FORBIDDEN,
      'DISCOGS_SECRET_LEAK_FORBIDDEN',
    );
  }
  if (/"DISCOGS_API_KEY"\s*:\s*"[^"]{8,}"/.test(s)) {
    throw rightsError(
      RIGHTS_ERROR_CODES.DISCOGS_SECRET_LEAK_FORBIDDEN,
      'DISCOGS_SECRET_LEAK_FORBIDDEN',
    );
  }
  return { ok: true };
}

/**
 * Block Discogs marketplace/sales endpoints; catalog dump / metadata paths allowed.
 */
export function assertDiscogsEndpointAllowed(endpointOrPath = '') {
  const p = String(endpointOrPath || '').toLowerCase();
  for (const blocked of DISCOGS_BLOCKED_MARKET_PATHS) {
    if (p.includes(blocked.toLowerCase())) {
      throw rightsError(
        RIGHTS_ERROR_CODES.DISCOGS_MARKET_ENDPOINTS_BLOCKED,
        `DISCOGS_MARKET_ENDPOINTS_BLOCKED:${endpointOrPath}`,
        { path: endpointOrPath },
      );
    }
  }
  return { ok: true, path: endpointOrPath };
}

/**
 * Catalog presence ≠ availability ≠ sale.
 */
export function interpretDiscogsCatalogPresence(record = {}) {
  return Object.freeze({
    catalog_present: Boolean(record.release_id || record.master_id || record.id),
    market_availability: null,
    sale_evidence: null,
    evidence_class: 'CATALOG_METADATA',
    interpretation:
      'catalog_presence_is_not_availability_or_sale',
    policy: DISCOGS_CATALOG_ONLY_POLICY.catalog_presence_is_not,
  });
}

/**
 * Resolve connector id / source id from an event or document.
 */
export function resolveConnectorId(event = {}) {
  return String(
    event.source_connector ||
      event.connector_id ||
      event.source_id ||
      event.rights_connector ||
      '',
  );
}

export function resolveRightsClass(event = {}) {
  return String(
    event.rights_class ||
      event.rights_status ||
      event.rights_classification ||
      '',
  );
}

export function isForbiddenOrUnlicensedRights(rights) {
  const r = String(rights || '').toUpperCase();
  return (
    r === 'FORBIDDEN' ||
    r === 'UNLICENSED' ||
    r === 'PROHIBITED' ||
    FORBIDDEN_RIGHTS_STATUSES.includes(r)
  );
}

export function isDisabledConnectorId(connectorId, options = {}) {
  const id = String(connectorId || '');
  if (!id) return false;
  if (id === DISCOGS_RESTRICTED_SOURCE_ID) return true;
  if (id === POPSIKE_SOURCE_ID || id === GRIPSWEAT_SOURCE_ID) {
    const grants = resolveLicenseContext(options);
    return !hasActiveLicenseGrant(id, { grants });
  }
  const contracts = options.contracts || defaultConnectorContracts();
  for (const c of Object.values(contracts)) {
    if (c.connector_id === id || (c.source_ids || []).includes(id)) {
      return String(c.connector_status || '').startsWith('DISABLED');
    }
  }
  if (DISABLED_WITHOUT_WRITTEN_RIGHTS.includes(id)) return true;
  return false;
}

/**
 * Eligibility/retrieval gate: reject FORBIDDEN/UNLICENSED and disabled connectors.
 * Missing rights is allowed here; callers that include events must call
 * assertIncludedEventHasRightsClass (eligibility does so before INCLUDED).
 * Returns { ok, exclusion_decision, reason_detail } — does not throw for soft reject.
 */
export function evaluateRightsEligibility(event = {}, options = {}) {
  const rights = resolveRightsClass(event);
  const connectorId = resolveConnectorId(event);

  if (options.requireRightsClass === true && !rights) {
    return {
      ok: false,
      exclusion_decision: 'EXCLUDED_RIGHTS',
      reason_detail: 'missing_rights_class',
      code: RIGHTS_ERROR_CODES.MISSING_RIGHTS_CLASS,
    };
  }

  if (rights && isForbiddenOrUnlicensedRights(rights)) {
    return {
      ok: false,
      exclusion_decision: 'EXCLUDED_RIGHTS',
      reason_detail: rights,
      code:
        String(rights).toUpperCase() === 'UNLICENSED'
          ? RIGHTS_ERROR_CODES.UNLICENSED_CONNECTOR_ENABLEMENT
          : RIGHTS_ERROR_CODES.FORBIDDEN_CONNECTOR_ENABLEMENT,
    };
  }

  if (connectorId && isDisabledConnectorId(connectorId, options)) {
    return {
      ok: false,
      exclusion_decision: 'EXCLUDED_RIGHTS',
      reason_detail: `disabled_connector:${connectorId}`,
      code: RIGHTS_ERROR_CODES.CONNECTOR_DISABLED,
    };
  }

  if (connectorId === DISCOGS_CATALOG_SOURCE_ID) {
    const banned = DISCOGS_CATALOG_ONLY_POLICY.prohibited_evidence_classes;
    if (event.evidence_class && banned.includes(event.evidence_class)) {
      return {
        ok: false,
        exclusion_decision: 'EXCLUDED_RIGHTS',
        reason_detail: 'discogs_catalog_only_violation',
        code: RIGHTS_ERROR_CODES.DISCOGS_CATALOG_ONLY_VIOLATION,
      };
    }
  }

  return { ok: true, exclusion_decision: null, reason_detail: null };
}

/**
 * Hard assert: every included event requires a rights class.
 */
export function assertIncludedEventHasRightsClass(event = {}) {
  const rights = resolveRightsClass(event);
  if (!rights) {
    throw rightsError(
      RIGHTS_ERROR_CODES.MISSING_RIGHTS_CLASS,
      `MISSING_RIGHTS_CLASS:${event.market_event_id || event.evidence_id || event.id || '?'}`,
    );
  }
  if (isForbiddenOrUnlicensedRights(rights)) {
    throw rightsError(
      RIGHTS_ERROR_CODES.FORBIDDEN_CONNECTOR_ENABLEMENT,
      `INCLUDED_EVENT_FORBIDDEN_RIGHTS:${rights}`,
      { rights_status: rights },
    );
  }
  return { ok: true, rights_class: rights };
}

export function assertIncludedEventsHaveRightsClass(events = []) {
  for (const event of events) {
    assertIncludedEventHasRightsClass(event);
  }
  return { ok: true, count: events.length };
}

/**
 * Mark observation/event deleted → excluded from retrieval and future snapshots.
 */
export function markObservationDeleted(record = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const reason = options.reason || 'user_or_policy_deletion';
  const base = { ...(record || {}) };
  const updated = {
    ...base,
    deletion_status: 'DELETED',
    event_status: 'DELETED',
    retention_status: base.retention_status === 'RETAIN_LEGAL' ? 'RETAIN_LEGAL' : 'DELETED',
    deleted_at: now,
    deletion_reason: reason,
    exclude_from_retrieval: true,
    exclude_from_snapshots: true,
  };
  return Object.freeze(updated);
}

/**
 * Propagate deletion across related observation, market event, and index docs.
 */
export function propagateDeletion({
  observation = null,
  market_event = null,
  retrieval_docs = [],
  snapshot_candidates = [],
  reason = 'deletion_propagation',
  now = new Date().toISOString(),
} = {}) {
  const deletedObservation = observation
    ? markObservationDeleted(observation, { reason, now })
    : null;
  const deletedEvent = market_event
    ? markObservationDeleted(market_event, { reason, now })
    : null;

  const ids = new Set(
    [
      deletedObservation?.observation_id,
      deletedEvent?.market_event_id,
      deletedEvent?.evidence_id,
      deletedEvent?.id,
      observation?.observation_id,
      market_event?.market_event_id,
      market_event?.evidence_id,
      market_event?.id,
    ].filter(Boolean),
  );

  const updatedDocs = (retrieval_docs || []).map((doc) => {
    const docId = doc.id || doc.market_event_id || doc.evidence_id || doc.observation_id;
    if (ids.has(docId) || doc.deletion_status === 'DELETED') {
      return markObservationDeleted(doc, { reason, now });
    }
    return doc;
  });

  const filteredForRetrieval = updatedDocs.filter(
    (d) => d.deletion_status !== 'DELETED' && d.exclude_from_retrieval !== true,
  );

  const filteredForSnapshots = (snapshot_candidates || [])
    .map((c) => {
      const cid = c.market_event_id || c.evidence_id || c.id || c.observation_id;
      if (ids.has(cid) || c.deletion_status === 'DELETED') {
        return markObservationDeleted(c, { reason, now });
      }
      return c;
    })
    .filter((c) => c.deletion_status !== 'DELETED' && c.exclude_from_snapshots !== true);

  return Object.freeze({
    version: RIGHTS_CONNECTORS_VERSION,
    deleted_observation: deletedObservation,
    deleted_market_event: deletedEvent,
    retrieval_docs: updatedDocs,
    retrieval_eligible: filteredForRetrieval,
    snapshot_eligible: filteredForSnapshots,
    excluded_from_retrieval_count:
      updatedDocs.length - filteredForRetrieval.length,
    excluded_from_snapshots_count:
      (snapshot_candidates || []).length - filteredForSnapshots.length,
    propagated_at: now,
    reason,
  });
}

/**
 * Filter a retrieval store corpus: drop deleted + forbidden/unlicensed/disabled.
 */
export function filterRetrievalDocsForRights(docs = [], options = {}) {
  const kept = [];
  const excluded = [];
  for (const doc of docs || []) {
    if (
      doc.deletion_status === 'DELETED' ||
      doc.event_status === 'DELETED' ||
      doc.exclude_from_retrieval === true ||
      doc.deleted === true
    ) {
      excluded.push({
        id: doc.id || doc.market_event_id || null,
        decision: 'EXCLUDED_DELETED',
        reason_detail: 'deleted',
      });
      continue;
    }
    const rights = evaluateRightsEligibility(doc, options);
    if (!rights.ok) {
      excluded.push({
        id: doc.id || doc.market_event_id || null,
        decision: rights.exclusion_decision,
        reason_detail: rights.reason_detail,
      });
      continue;
    }
    kept.push(doc);
  }
  return { kept, excluded };
}

/**
 * Owner dossier rights + provenance fields helper.
 */
export function buildOwnerDossierRightsProvenance({
  evidence_items = [],
  connectors_used = [],
  license_grants_applied = [],
  deletion_exclusions = [],
  discogs_usage = null,
} = {}) {
  const items = (evidence_items || []).map((item) => {
    const rights_class = resolveRightsClass(item) || null;
    const connector_id = resolveConnectorId(item) || null;
    return {
      evidence_id: item.evidence_id || item.market_event_id || item.id || null,
      rights_class,
      rights_status: item.rights_status || rights_class,
      connector_id,
      source_class: item.source_class || null,
      evidence_class: item.evidence_class || null,
      attribution: item.attribution || item.source_url || null,
      license: item.license || null,
      retention_status: item.retention_status || null,
      deletion_status: item.deletion_status || 'ACTIVE',
      freshness: item.observed_at || item.occurred_at || item.ingested_at || null,
    };
  });

  for (const row of items) {
    if (row.deletion_status !== 'DELETED') {
      assertIncludedEventHasRightsClass({
        rights_class: row.rights_class,
        market_event_id: row.evidence_id,
      });
    }
  }

  const discogs = discogs_usage || {
    catalog_metadata_used: items.some(
      (i) =>
        i.connector_id === DISCOGS_CATALOG_SOURCE_ID ||
        i.evidence_class === 'CATALOG_METADATA',
    ),
    marketplace_used: false,
    api_key_reference: DISCOGS_API_KEY_REF,
    api_key_value_present_in_dossier: false,
  };

  return Object.freeze({
    version: RIGHTS_CONNECTORS_VERSION,
    rights_posture: 'phase_g_enforced',
    model_weight_training: 'NO',
    evidence_provenance: items,
    connectors_used: [...connectors_used],
    license_grants_applied: license_grants_applied.map((g) => ({
      grant_id: g.grant_id,
      source_id: g.source_id,
      license_id: g.license_id,
      document_reference: g.document_reference,
      // never embed secrets
    })),
    deletion_exclusions: [...deletion_exclusions],
    discogs,
    forbidden_connectors_enabled: false,
    popsike_used: false,
    gripsweat_used: false,
    catalog_presence_treated_as_sale: false,
  });
}

/**
 * Snapshot of Phase G posture for verify / STOP-LINE reporting.
 */
export function summarizeRightsPosture(options = {}) {
  const contracts = defaultConnectorContracts();
  const enabled = Object.values(contracts).filter((c) => c.connector_status === 'ENABLED');
  return {
    version: RIGHTS_CONNECTORS_VERSION,
    preferred_connector_ids: [...CONNECTOR_CONTRACT_IDS],
    evidence_classes: [...EVIDENCE_CLASSES],
    enabled_contract_count: enabled.length,
    popsike: popsikeConnectorContract(),
    gripsweat: gripsweatConnectorContract(),
    discogs_restricted: discogsRestrictedConnectorContract(),
    discogs_catalog_policy: DISCOGS_CATALOG_ONLY_POLICY,
    discogs_credentials: discogsCredentialsReference(options.env || process.env),
    license_grant_count: listLicenseGrants().length,
    attempt_7: 'NOT_LAUNCHED',
    screenshots: 'NOT_CREATED',
  };
}

export default {
  RIGHTS_CONNECTORS_VERSION,
  defaultConnectorContracts,
  assertConnectorEnablementAllowed,
  assertProductionRightsConfig,
  evaluateRightsEligibility,
  propagateDeletion,
  buildOwnerDossierRightsProvenance,
};
