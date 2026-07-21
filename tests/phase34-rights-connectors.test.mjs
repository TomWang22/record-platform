/**
 * Phase G — rights connectors / real-data posture tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RIGHTS_CONNECTORS_VERSION,
  CONNECTOR_CONTRACT_IDS,
  EVIDENCE_CLASSES,
  DISABLED_WITHOUT_WRITTEN_RIGHTS,
  POPSIKE_SOURCE_ID,
  GRIPSWEAT_SOURCE_ID,
  DISCOGS_RESTRICTED_SOURCE_ID,
  DISCOGS_CATALOG_SOURCE_ID,
  DISCOGS_CATALOG_ONLY_POLICY,
  defaultConnectorContracts,
  buildConnectorContract,
  popsikeConnectorContract,
  gripsweatConnectorContract,
  assertConnectorEnablementAllowed,
  assertForbiddenArchiveEnablement,
  assertProductionRightsConfig,
  recordLicenseGrant,
  clearLicenseGrantsForTests,
  hasActiveLicenseGrant,
  assertDiscogsEndpointAllowed,
  interpretDiscogsCatalogPresence,
  discogsCredentialsReference,
  assertNoDiscogsSecretLeakage,
  evaluateRightsEligibility,
  assertIncludedEventHasRightsClass,
  assertIncludedEventsHaveRightsClass,
  markObservationDeleted,
  propagateDeletion,
  filterRetrievalDocsForRights,
  buildOwnerDossierRightsProvenance,
  summarizeRightsPosture,
  RIGHTS_ERROR_CODES,
} from '../scripts/lib/phase34-rights-connectors.mjs';
import { evaluateEligibility, decideEligibility } from '../scripts/lib/phase34-eligibility-engine.mjs';
import { retrieve, createRetrievalStores } from '../scripts/lib/phase34-retrieval.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Phase G: every preferred source class has a connector contract', () => {
  const contracts = defaultConnectorContracts();
  for (const id of CONNECTOR_CONTRACT_IDS) {
    assert.ok(contracts[id], `missing contract ${id}`);
    const c = contracts[id];
    assert.equal(c.connector_id, id);
    assert.ok(c.rights_status);
    assert.ok(Array.isArray(c.permitted_purposes));
    assert.ok(c.retention_policy);
    assert.ok(c.deletion_policy);
    assert.ok(c.attribution_requirement);
    assert.ok(c.freshness_policy);
    assert.ok(c.rate_limits);
    assert.ok(Array.isArray(c.evidence_classes));
  }
  assert.ok(EVIDENCE_CLASSES.includes('COMPLETED_SETTLEMENT'));
  assert.ok(EVIDENCE_CLASSES.includes('BID_EVENT'));
  assert.ok(EVIDENCE_CLASSES.includes('USER_PREFERENCE'));
  assert.equal(RIGHTS_CONNECTORS_VERSION, 'phase34-rights-connectors-v1');
});

test('Phase G: forbidden connectors blocked without license', () => {
  clearLicenseGrantsForTests();
  assert.throws(
    () =>
      assertConnectorEnablementAllowed({
        source_id: POPSIKE_SOURCE_ID,
        connector_status: 'ENABLED',
        rights_status: 'LICENSED',
      }),
    (err) => err.code === RIGHTS_ERROR_CODES.FORBIDDEN_CONNECTOR_ENABLEMENT,
  );
  assert.throws(
    () =>
      assertConnectorEnablementAllowed({
        source_id: GRIPSWEAT_SOURCE_ID,
        connector_status: 'ENABLED',
        rights_status: 'LICENSED',
      }),
    (err) => err.code === RIGHTS_ERROR_CODES.FORBIDDEN_CONNECTOR_ENABLEMENT,
  );
  assert.throws(
    () => assertForbiddenArchiveEnablement(POPSIKE_SOURCE_ID),
    (err) => err.code === RIGHTS_ERROR_CODES.FORBIDDEN_CONNECTOR_ENABLEMENT,
  );
  assert.throws(
    () =>
      assertConnectorEnablementAllowed({
        source_id: DISCOGS_RESTRICTED_SOURCE_ID,
        connector_status: 'ENABLED',
      }),
    (err) => err.code === RIGHTS_ERROR_CODES.DISCOGS_RESTRICTED_MUST_STAY_DISABLED,
  );

  const popsike = popsikeConnectorContract();
  assert.match(popsike.connector_status, /^DISABLED/);
  assert.ok(DISABLED_WITHOUT_WRITTEN_RIGHTS.includes(POPSIKE_SOURCE_ID));
});

test('Phase G: license gate — ordinary env cannot enable Popsike/Gripsweat', () => {
  clearLicenseGrantsForTests();
  assert.throws(
    () =>
      assertProductionRightsConfig({
        POPSIKE_ENABLED: '1',
        GRIPSWEAT_ENABLED: '1',
      }),
    (err) => err.code === RIGHTS_ERROR_CODES.PRODUCTION_FORBIDDEN_CONNECTOR_ENV,
  );
  assert.throws(
    () =>
      assertProductionRightsConfig({
        DISCOGS_MARKETPLACE_ENABLED: '1',
      }),
    (err) => err.code === RIGHTS_ERROR_CODES.PRODUCTION_FORBIDDEN_CONNECTOR_ENV,
  );

  // With a written license record + LICENSE file, Popsike env may pass production guard.
  const grant = recordLicenseGrant({
    source_id: POPSIKE_SOURCE_ID,
    license_id: 'test-license-1',
    grantor: 'popsike-test',
    document_reference: 'file://test-license-popsike.pdf',
    permitted_purposes: ['retrieval'],
  });
  assert.ok(hasActiveLicenseGrant(POPSIKE_SOURCE_ID));
  assert.equal(grant.source_id, POPSIKE_SOURCE_ID);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase34-lic-'));
  const licPath = path.join(tmp, 'licenses.json');
  fs.writeFileSync(
    licPath,
    JSON.stringify({
      grants: [
        {
          source_id: GRIPSWEAT_SOURCE_ID,
          license_id: 'gs-1',
          document_reference: 'file://gripsweat-license.pdf',
        },
      ],
    }),
  );

  assert.doesNotThrow(() =>
    assertProductionRightsConfig(
      { POPSIKE_ENABLED: '1', GRIPSWEAT_ENABLED: '1', LICENSE_GRANTS_FILE: licPath },
      {},
    ),
  );

  // Discogs market still blocked even with license file
  assert.throws(
    () =>
      assertProductionRightsConfig({
        DISCOGS_MARKETPLACE_ENABLED: '1',
        LICENSE_GRANTS_FILE: licPath,
      }),
    (err) => err.code === RIGHTS_ERROR_CODES.PRODUCTION_FORBIDDEN_CONNECTOR_ENV,
  );

  clearLicenseGrantsForTests();
});

test('Phase G: discogs catalog-only — market endpoints blocked; presence ≠ sale', () => {
  assert.throws(
    () => assertDiscogsEndpointAllowed('/marketplace/listings/123'),
    (err) => err.code === RIGHTS_ERROR_CODES.DISCOGS_MARKET_ENDPOINTS_BLOCKED,
  );
  assert.throws(
    () => assertDiscogsEndpointAllowed('https://api.discogs.com/marketplace/orders'),
    (err) => err.code === RIGHTS_ERROR_CODES.DISCOGS_MARKET_ENDPOINTS_BLOCKED,
  );
  assert.equal(assertDiscogsEndpointAllowed('/database/releases/123').ok, true);

  const interp = interpretDiscogsCatalogPresence({ release_id: 'r1' });
  assert.equal(interp.catalog_present, true);
  assert.equal(interp.market_availability, null);
  assert.equal(interp.sale_evidence, null);
  assert.equal(interp.evidence_class, 'CATALOG_METADATA');

  assert.throws(
    () =>
      assertConnectorEnablementAllowed({
        source_id: DISCOGS_CATALOG_SOURCE_ID,
        connector_status: 'ENABLED',
        rights_status: 'CC0',
        evidence_classes: ['COMPLETED_SETTLEMENT'],
      }),
    (err) => err.code === RIGHTS_ERROR_CODES.DISCOGS_CATALOG_ONLY_VIOLATION,
  );

  const creds = discogsCredentialsReference({ DISCOGS_API_KEY: 'super-secret-key-value' });
  assert.equal(creds.credentials_reference, 'env:DISCOGS_API_KEY');
  assert.equal(creds.secret_configured, true);
  assert.equal(creds.secret_value, undefined);
  assert.throws(
    () => assertNoDiscogsSecretLeakage('DISCOGS_API_KEY=super-secret-key-value'),
    (err) => err.code === RIGHTS_ERROR_CODES.DISCOGS_SECRET_LEAK_FORBIDDEN,
  );
  assert.ok(DISCOGS_CATALOG_ONLY_POLICY.prohibited_evidence_classes.includes('COMPLETED_SETTLEMENT'));
});

test('Phase G: eligibility rejects FORBIDDEN/UNLICENSED and disabled connectors', () => {
  clearLicenseGrantsForTests();
  const { decisions } = evaluateEligibility([
    {
      market_event_id: 'e-forbid',
      event_type: 'SALE_COMPLETED',
      source_class: 'FIRST_PARTY_SETTLEMENT',
      settlement_evidence_eligible: true,
      rights_status: 'FORBIDDEN',
      occurred_at: '2026-07-01T00:00:00.000Z',
    },
    {
      market_event_id: 'e-unlic',
      event_type: 'SALE_COMPLETED',
      source_class: 'FIRST_PARTY_SETTLEMENT',
      settlement_evidence_eligible: true,
      rights_status: 'UNLICENSED',
      occurred_at: '2026-07-01T00:00:00.000Z',
    },
    {
      market_event_id: 'e-popsike',
      event_type: 'SALE_COMPLETED',
      source_class: 'LICENSED_EXTERNAL_ARCHIVE',
      settlement_evidence_eligible: true,
      rights_status: 'LICENSED',
      source_connector: POPSIKE_SOURCE_ID,
      occurred_at: '2026-07-01T00:00:00.000Z',
    },
    {
      market_event_id: 'e-ok',
      event_type: 'SALE_COMPLETED',
      source_class: 'FIRST_PARTY_SETTLEMENT',
      settlement_evidence_eligible: true,
      rights_status: 'FIRST_PARTY',
      payload_hash: 'ok1',
      occurred_at: '2026-07-01T00:00:00.000Z',
      price_normalized: 40,
    },
  ]);
  assert.equal(decisions.find((d) => d.market_event_id === 'e-forbid').decision, 'EXCLUDED_RIGHTS');
  assert.equal(decisions.find((d) => d.market_event_id === 'e-unlic').decision, 'EXCLUDED_RIGHTS');
  assert.equal(decisions.find((d) => d.market_event_id === 'e-popsike').decision, 'EXCLUDED_RIGHTS');
  assert.equal(decisions.find((d) => d.market_event_id === 'e-ok').decision, 'INCLUDED');

  const missing = decideEligibility({
    market_event_id: 'e-norights',
    event_type: 'LISTING_CREATED',
    source_class: 'FIRST_PARTY_LISTING',
  });
  assert.equal(missing.decision, 'EXCLUDED_RIGHTS');
});

test('Phase G: retrieval rejects deleted / forbidden / disabled connectors', () => {
  clearLicenseGrantsForTests();
  const stores = createRetrievalStores({
    settlements: [
      {
        id: 's-ok',
        title: 'Kind of Blue',
        rights_status: 'FIRST_PARTY',
        source_connector: 'fp-completed-sales',
      },
      {
        id: 's-del',
        title: 'Kind of Blue deleted',
        rights_status: 'FIRST_PARTY',
        deletion_status: 'DELETED',
      },
      {
        id: 's-forbid',
        title: 'Kind of Blue forbidden',
        rights_status: 'FORBIDDEN',
      },
      {
        id: 's-popsike',
        title: 'Kind of Blue popsike',
        rights_status: 'LICENSED',
        source_connector: POPSIKE_SOURCE_ID,
      },
    ],
  });
  const result = retrieve({
    query: 'Kind of Blue',
    stores,
    store_names: ['settlements'],
    requested_mode: 'keyword',
  });
  assert.ok(result.candidate_ids.includes('s-ok'));
  assert.ok(!result.candidate_ids.includes('s-del'));
  assert.ok(!result.candidate_ids.includes('s-forbid'));
  assert.ok(!result.candidate_ids.includes('s-popsike'));
  assert.ok(result.rights_exclusions_count >= 3);
});

test('Phase G: deletion propagates — excluded from retrieval and snapshots', () => {
  const observation = {
    observation_id: 'obs-1',
    rights_classification: 'FIRST_PARTY',
    deletion_status: 'ACTIVE',
  };
  const market_event = {
    market_event_id: 'me-1',
    observation_id: 'obs-1',
    rights_status: 'FIRST_PARTY',
    deletion_status: 'ACTIVE',
  };
  const docs = [
    { id: 'me-1', title: 'sale', rights_status: 'FIRST_PARTY' },
    { id: 'me-2', title: 'other', rights_status: 'FIRST_PARTY' },
  ];
  const snaps = [
    { market_event_id: 'me-1', rights_status: 'FIRST_PARTY' },
    { market_event_id: 'me-2', rights_status: 'FIRST_PARTY' },
  ];

  const marked = markObservationDeleted(observation);
  assert.equal(marked.deletion_status, 'DELETED');
  assert.equal(marked.exclude_from_retrieval, true);

  const prop = propagateDeletion({
    observation,
    market_event,
    retrieval_docs: docs,
    snapshot_candidates: snaps,
    reason: 'user_delete',
  });
  assert.equal(prop.deleted_observation.deletion_status, 'DELETED');
  assert.equal(prop.deleted_market_event.deletion_status, 'DELETED');
  assert.equal(prop.retrieval_eligible.length, 1);
  assert.equal(prop.retrieval_eligible[0].id, 'me-2');
  assert.equal(prop.snapshot_eligible.length, 1);
  assert.equal(prop.snapshot_eligible[0].market_event_id, 'me-2');
  assert.ok(prop.excluded_from_retrieval_count >= 1);

  const elig = decideEligibility({
    ...prop.deleted_market_event,
    event_type: 'SALE_COMPLETED',
    source_class: 'FIRST_PARTY_SETTLEMENT',
    settlement_evidence_eligible: true,
  });
  assert.equal(elig.decision, 'EXCLUDED_DELETED');

  const filtered = filterRetrievalDocsForRights(prop.retrieval_docs);
  assert.equal(filtered.kept.length, 1);
});

test('Phase G: every included event requires rights class', () => {
  assert.throws(
    () => assertIncludedEventHasRightsClass({ market_event_id: 'x' }),
    (err) => err.code === RIGHTS_ERROR_CODES.MISSING_RIGHTS_CLASS,
  );
  assert.throws(
    () =>
      assertIncludedEventHasRightsClass({
        market_event_id: 'y',
        rights_status: 'FORBIDDEN',
      }),
    (err) => err.code === RIGHTS_ERROR_CODES.FORBIDDEN_CONNECTOR_ENABLEMENT,
  );
  assert.equal(
    assertIncludedEventsHaveRightsClass([
      { market_event_id: 'a', rights_class: 'FIRST_PARTY' },
      { market_event_id: 'b', rights_status: 'CC0' },
    ]).ok,
    true,
  );
});

test('Phase G: owner dossier rights/provenance fields', () => {
  const dossier = buildOwnerDossierRightsProvenance({
    evidence_items: [
      {
        evidence_id: 'ev-1',
        rights_status: 'FIRST_PARTY',
        source_connector: 'fp-completed-sales',
        evidence_class: 'COMPLETED_SETTLEMENT',
        source_class: 'FIRST_PARTY_SETTLEMENT',
      },
      {
        evidence_id: 'ev-2',
        rights_class: 'CC0',
        source_connector: DISCOGS_CATALOG_SOURCE_ID,
        evidence_class: 'CATALOG_METADATA',
      },
    ],
    connectors_used: ['FIRST_PARTY_SETTLEMENTS', 'PERMITTED_PUBLIC_CATALOG'],
  });
  assert.equal(dossier.rights_posture, 'phase_g_enforced');
  assert.equal(dossier.model_weight_training, 'NO');
  assert.equal(dossier.popsike_used, false);
  assert.equal(dossier.gripsweat_used, false);
  assert.equal(dossier.catalog_presence_treated_as_sale, false);
  assert.equal(dossier.discogs.marketplace_used, false);
  assert.equal(dossier.discogs.api_key_value_present_in_dossier, false);
  assert.equal(dossier.evidence_provenance.length, 2);
  assert.ok(dossier.evidence_provenance.every((r) => r.rights_class));
});

test('Phase G: SQL migration + report artifacts exist', () => {
  const sql = fs.readFileSync(
    path.join(REPO, 'infra/db/53-intelligence-rights-connectors.sql'),
    'utf8',
  );
  assert.match(sql, /connector_contracts/);
  assert.match(sql, /license_grants/);
  assert.match(sql, /deny_license_grant_mutation/);
  assert.match(sql, /APPEND_ONLY|append-only/i);

  assert.ok(
    fs.existsSync(path.join(REPO, 'reports/phase34-root-cause/PHASE_G_RIGHTS.md')),
  );
  assert.ok(
    fs.existsSync(path.join(REPO, 'reports/phase34-root-cause/PLATFORM_ACCEPTANCE_READY.md')),
  );
  assert.ok(
    fs.existsSync(path.join(REPO, 'scripts/ai-platform/verify-phase34-rights-connectors.mjs')),
  );

  const posture = summarizeRightsPosture();
  assert.equal(posture.attempt_7, 'NOT_LAUNCHED');
  assert.equal(posture.popsike.connector_status, 'DISABLED_NO_WRITTEN_RIGHTS');
  assert.equal(gripsweatConnectorContract().connector_id, GRIPSWEAT_SOURCE_ID);
});

test('Phase G: buildConnectorContract validates required fields', () => {
  assert.throws(
    () => buildConnectorContract({ rights_status: 'FIRST_PARTY' }),
    (err) => err.code === RIGHTS_ERROR_CODES.CONNECTOR_CONTRACT_REQUIRES_ID,
  );
  assert.throws(
    () => buildConnectorContract({ connector_id: 'X' }),
    (err) => err.code === RIGHTS_ERROR_CODES.CONNECTOR_CONTRACT_REQUIRES_RIGHTS_STATUS,
  );
  assert.equal(
    evaluateRightsEligibility({
      rights_status: 'FIRST_PARTY',
      source_connector: 'fp-completed-sales',
    }).ok,
    true,
  );
});
