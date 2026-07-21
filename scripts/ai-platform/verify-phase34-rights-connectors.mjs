#!/usr/bin/env node
/**
 * CI entry — Phase G rights connectors / real-data posture.
 * Does not launch owner-proof, screenshots, or attempt 7.
 * Never prints Discogs API key values.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  RIGHTS_CONNECTORS_VERSION,
  CONNECTOR_CONTRACT_IDS,
  EVIDENCE_CLASSES,
  POPSIKE_SOURCE_ID,
  GRIPSWEAT_SOURCE_ID,
  DISCOGS_RESTRICTED_SOURCE_ID,
  defaultConnectorContracts,
  popsikeConnectorContract,
  gripsweatConnectorContract,
  discogsRestrictedConnectorContract,
  assertConnectorEnablementAllowed,
  assertForbiddenArchiveEnablement,
  assertProductionRightsConfig,
  assertDiscogsEndpointAllowed,
  assertNoDiscogsSecretLeakage,
  discogsCredentialsReference,
  summarizeRightsPosture,
  clearLicenseGrantsForTests,
  RIGHTS_ERROR_CODES,
} from '../lib/phase34-rights-connectors.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function assert(cond, msg) {
  if (!cond) {
    const err = new Error(msg);
    err.code = 'PHASE34_RIGHTS_CONNECTORS_VERIFY_FAIL';
    throw err;
  }
}

function expectThrow(fn, code) {
  let thrown = null;
  try {
    fn();
  } catch (err) {
    thrown = err;
  }
  assert(thrown, `expected throw ${code}`);
  assert(thrown.code === code, `expected code ${code} got ${thrown.code}`);
}

function main() {
  clearLicenseGrantsForTests();

  const contracts = defaultConnectorContracts();
  assert(CONNECTOR_CONTRACT_IDS.length >= 11, 'preferred connector set too small');
  for (const id of CONNECTOR_CONTRACT_IDS) {
    assert(contracts[id], `missing contract ${id}`);
    assert(contracts[id].rights_status, `${id} missing rights_status`);
    assert(contracts[id].retention_policy, `${id} missing retention`);
    assert(contracts[id].deletion_policy, `${id} missing deletion`);
    assert(Array.isArray(contracts[id].evidence_classes), `${id} evidence_classes`);
  }
  assert(EVIDENCE_CLASSES.includes('COMPLETED_SETTLEMENT'), 'settlement evidence class');
  assert(EVIDENCE_CLASSES.includes('CATALOG_METADATA'), 'catalog evidence class');

  expectThrow(
    () =>
      assertConnectorEnablementAllowed({
        source_id: POPSIKE_SOURCE_ID,
        connector_status: 'ENABLED',
      }),
    RIGHTS_ERROR_CODES.FORBIDDEN_CONNECTOR_ENABLEMENT,
  );
  expectThrow(
    () =>
      assertConnectorEnablementAllowed({
        source_id: GRIPSWEAT_SOURCE_ID,
        connector_status: 'ENABLED',
      }),
    RIGHTS_ERROR_CODES.FORBIDDEN_CONNECTOR_ENABLEMENT,
  );
  expectThrow(
    () => assertForbiddenArchiveEnablement(POPSIKE_SOURCE_ID),
    RIGHTS_ERROR_CODES.FORBIDDEN_CONNECTOR_ENABLEMENT,
  );
  expectThrow(
    () =>
      assertConnectorEnablementAllowed({
        source_id: DISCOGS_RESTRICTED_SOURCE_ID,
        connector_status: 'ENABLED',
      }),
    RIGHTS_ERROR_CODES.DISCOGS_RESTRICTED_MUST_STAY_DISABLED,
  );
  expectThrow(
    () => assertProductionRightsConfig({ POPSIKE_ENABLED: '1' }),
    RIGHTS_ERROR_CODES.PRODUCTION_FORBIDDEN_CONNECTOR_ENV,
  );
  expectThrow(
    () => assertProductionRightsConfig({ GRIPSWEAT_ENABLED: '1' }),
    RIGHTS_ERROR_CODES.PRODUCTION_FORBIDDEN_CONNECTOR_ENV,
  );
  expectThrow(
    () => assertProductionRightsConfig({ DISCOGS_MARKETPLACE_ENABLED: '1' }),
    RIGHTS_ERROR_CODES.PRODUCTION_FORBIDDEN_CONNECTOR_ENV,
  );
  expectThrow(
    () => assertDiscogsEndpointAllowed('/marketplace/listings/1'),
    RIGHTS_ERROR_CODES.DISCOGS_MARKET_ENDPOINTS_BLOCKED,
  );

  assert(popsikeConnectorContract().connector_status.startsWith('DISABLED'), 'popsike disabled');
  assert(gripsweatConnectorContract().connector_status.startsWith('DISABLED'), 'gripsweat disabled');
  assert(
    discogsRestrictedConnectorContract().connector_status.startsWith('DISABLED'),
    'discogs market disabled',
  );

  const creds = discogsCredentialsReference(process.env);
  assert(creds.credentials_reference === 'env:DISCOGS_API_KEY', 'discogs key ref');
  assert(creds.secret_value === undefined, 'secret must not be returned');
  assertNoDiscogsSecretLeakage(JSON.stringify(summarizeRightsPosture()));

  const libPath = path.join(__dirname, '../lib/phase34-rights-connectors.mjs');
  const sqlPath = path.join(REPO, 'infra/db/53-intelligence-rights-connectors.sql');
  const reportPath = path.join(REPO, 'reports/phase34-root-cause/PHASE_G_RIGHTS.md');
  const stopPath = path.join(REPO, 'reports/phase34-root-cause/PLATFORM_ACCEPTANCE_READY.md');
  const testPath = path.join(REPO, 'tests/phase34-rights-connectors.test.mjs');

  assert(fs.existsSync(sqlPath), 'missing 53-intelligence-rights-connectors.sql');
  assert(fs.existsSync(reportPath), 'missing PHASE_G_RIGHTS.md');
  assert(fs.existsSync(stopPath), 'missing PLATFORM_ACCEPTANCE_READY.md');
  assert(fs.existsSync(testPath), 'missing phase34-rights-connectors.test.mjs');

  const sql = fs.readFileSync(sqlPath, 'utf8');
  assert(/license_grants/.test(sql), 'sql license_grants');
  assert(/connector_contracts/.test(sql), 'sql connector_contracts');
  assert(/deny_license_grant_mutation/.test(sql), 'sql append-only trigger');

  const stopMd = fs.readFileSync(stopPath, 'utf8');
  assert(
    /PHASE 34 DATA-TO-ANSWER PLATFORM SOURCE ACCEPTANCE READY/.test(stopMd),
    'stop line text missing',
  );
  assert(/OWNER VISUAL RECAPTURE NOT LAUNCHED/.test(stopMd), 'stop line visual flag');
  assert(/exact SHA|<EXACT_SHA>|PLACEHOLDER_SHA/i.test(stopMd), 'sha placeholder');

  const posture = summarizeRightsPosture();

  console.log(
    JSON.stringify(
      {
        ok: true,
        verifier: 'verify-phase34-rights-connectors',
        rights_connectors_version: RIGHTS_CONNECTORS_VERSION,
        preferred_connector_count: CONNECTOR_CONTRACT_IDS.length,
        evidence_class_count: EVIDENCE_CLASSES.length,
        popsike_status: posture.popsike.connector_status,
        gripsweat_status: posture.gripsweat.connector_status,
        discogs_restricted_status: posture.discogs_restricted.connector_status,
        discogs_credentials_reference: creds.credentials_reference,
        discogs_secret_configured: creds.secret_configured,
        lib_hash: sha256File(libPath),
        sql_hash: sha256File(sqlPath),
        report_hash: sha256File(reportPath),
        attempt_7: 'NOT_LAUNCHED',
        screenshots: 'NOT_CREATED',
        model_weight_training: 'NO',
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (err) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: err.message,
        code: err.code || 'PHASE34_RIGHTS_CONNECTORS_VERIFY_FAIL',
      },
      null,
      2,
    ),
  );
  process.exit(2);
}
