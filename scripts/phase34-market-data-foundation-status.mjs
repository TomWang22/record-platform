#!/usr/bin/env node
/**
 * Phase 34 market-data foundation + documented response program status.
 * Does NOT launch live owner-proof recapture or the 20-PNG pack.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  loadRegistry,
  sha256Registry,
  enabledSources,
  disabledSources,
  summarizeRestrictedPosture,
} from './lib/phase34-market-data-source-registry.mjs';
import { ingestDumpManifest } from './lib/phase34-discogs-cc0-catalog-connector.mjs';
import {
  listAdversarialPressingFixtureIds,
  runAdversarialPressingFixture,
} from './lib/phase34-pressing-resolution.mjs';
import {
  normalizeMarketEvent,
  validateHardDistinctions,
} from './lib/phase34-market-event-normalization.mjs';
import {
  buildDataQualityReport,
  writeDataQualityReports,
} from './lib/phase34-data-quality-report.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const AI = path.join(REPO, 'scripts/ai-platform');

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function gitSha(ref = 'HEAD') {
  const r = spawnSync('git', ['rev-parse', ref], { cwd: REPO, encoding: 'utf8' });
  return (r.stdout || '').trim() || null;
}

function runVerifier(rel) {
  const r = spawnSync(process.execPath, [path.join(REPO, rel)], {
    cwd: REPO,
    encoding: 'utf8',
  });
  return { exit: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function main() {
  const registry = loadRegistry();
  const registryHash = sha256Registry();
  const enabled = enabledSources(registry).map((s) => s.source_id);
  const disabled = disabledSources(registry).map((s) => ({
    source_id: s.source_id,
    connector_status: s.connector_status,
    rights_status: s.rights_status,
  }));
  const restricted = summarizeRestrictedPosture(registry);
  const discogsCc0 = ingestDumpManifest();
  const pressingIds = listAdversarialPressingFixtureIds();
  const pressingResults = pressingIds.map((id) => {
    const out = runAdversarialPressingFixture(id);
    const status = out.resolution?.resolution_status;
    const expected = out.fixture?.expected_status;
    return {
      fixture_id: id,
      resolution_status: status,
      expected_status: expected,
      ok: !expected || status === expected,
    };
  });

  const sampleEvents = [
    normalizeMarketEvent({
      source_id: 'fp-completed-sales',
      source_event_id: 'foundation-sold-1',
      event_type: 'COMPLETED_SALE',
      event_status: 'COMPLETED',
      artist: 'Art Blakey',
      title: "Moanin'",
      currency_original: 'USD',
      price_original: 48,
      currency_normalized: 'USD',
      price_normalized: 48,
      media_condition: 'VG+',
      rights_status: 'FIRST_PARTY',
      authorization_scope: 'authenticated_market',
      deletion_status: 'ACTIVE',
      identity_resolution_status: 'EXACT',
      pressing_match_confidence: 0.95,
      sold_at: '2026-06-01T00:00:00.000Z',
    }),
    normalizeMarketEvent({
      source_id: 'fp-marketplace-listings',
      source_event_id: 'foundation-ask-1',
      event_type: 'ASKING_LISTING',
      event_status: 'ACTIVE',
      artist: 'Art Blakey',
      title: "Moanin'",
      currency_original: 'USD',
      price_original: 60,
      currency_normalized: 'USD',
      price_normalized: 60,
      media_condition: 'VG+',
      rights_status: 'FIRST_PARTY',
      authorization_scope: 'authenticated_market',
      deletion_status: 'ACTIVE',
      identity_resolution_status: 'RELEASE_LEVEL_ONLY',
      pressing_match_confidence: 0.4,
    }),
  ];
  validateHardDistinctions(sampleEvents);
  const dataQuality = buildDataQualityReport({
    events: sampleEvents,
    exclusions: [],
    resolutions: pressingResults.map((p) => ({
      resolution_status: p.resolution_status,
    })),
  });
  const dqMetrics = dataQuality.metrics || {};
  const foundationRoot = path.join(REPO, '.cache/phase34-market-data-foundation-v1');
  const dqWritten = writeDataQualityReports(foundationRoot, dataQuality);

  const verifiers = [
    'scripts/ai-platform/verify-phase34-market-data-source-registry.mjs',
    'scripts/ai-platform/verify-phase34-response-depth.mjs',
    'scripts/ai-platform/verify-phase34-response-dossier.mjs',
    'scripts/ai-platform/verify-phase34-corpus-registries.mjs',
  ].map((rel) => {
    const r = runVerifier(rel);
    return { script: rel, exit: r.exit, ok: r.exit === 0 };
  });

  const tests = spawnSync(
    process.execPath,
    [
      '--test',
      'tests/phase34-market-event-normalization.test.mjs',
      'tests/phase34-response-depth-dossier.test.mjs',
    ],
    { cwd: REPO, encoding: 'utf8' },
  );
  const testPassMatch = (tests.stdout || '').match(/# pass (\d+)/);
  const testFailMatch = (tests.stdout || '').match(/# fail (\d+)/);

  const statusLine =
    'PHASE 34 MARKET-DATA FOUNDATION AND DOCUMENTED RESPONSE PROGRAM READY — LIVE OWNER-PROOF RECAPTURE NOT LAUNCHED';

  const summary = {
    status_line: statusLine,
    exact_sha: gitSha('HEAD'),
    origin_main_sha: gitSha('origin/main'),
    model_weight_training: registry.model_weight_training || 'NO',
    current_optimization:
      registry.current_optimization ||
      'PROMPT_RETRIEVAL_RERANKER_TOOL_CALIBRATION_AND_MODEL_SELECTION',
    source_registry_hash: registryHash,
    market_event_schema_hash: sha256File(path.join(AI, 'phase34-market-event.schema.json')),
    response_depth_contract_hash: sha256File(
      path.join(AI, 'phase34-response-depth-contract.json'),
    ),
    enabled_sources: enabled,
    disabled_sources: disabled,
    discogs_cc0_connector: {
      status: discogsCc0.status,
      dump_index_url: discogsCc0.dump_index_url,
      note: discogsCc0.note,
      ingested: false,
    },
    restricted_source_posture: restricted,
    pressing_resolution: {
      adversarial_fixture_count: pressingIds.length,
      all_ok: pressingResults.every((p) => p.ok),
      results: pressingResults,
    },
    data_quality_sample: {
      verdict: dataQuality.verdict,
      events_ingested: dqMetrics.events_ingested,
      asking_as_sold_violations: dqMetrics.asking_as_sold_violations,
      active_as_completed_violations: dqMetrics.active_as_completed_violations,
      evidence_snapshot_reproducibility: dqMetrics.evidence_snapshot_reproducibility,
      hard_violations_zero: (dataQuality.hard_violations || 0) === 0,
      report_json: path.relative(REPO, dqWritten.jsonPath),
      report_html: path.relative(REPO, dqWritten.htmlPath),
      report_sha256: dqWritten.checksum,
    },
    response_dossier_validator: verifiers.find((v) =>
      v.script.includes('response-dossier'),
    ),
    verifiers,
    test_counts: {
      pass: testPassMatch ? Number(testPassMatch[1]) : null,
      fail: testFailMatch ? Number(testFailMatch[1]) : null,
      exit: tests.status ?? 1,
    },
    recapture_root_absent: !fs.existsSync('/tmp/phase34-owner-proof-live-recapture-v3'),
    owner_proof_20_png_pack_absent: !fs.existsSync(
      path.join(REPO, 'owner-review-artifacts/phase34/owner-proof-live-v3'),
    ),
    production_not_approved: true,
    live_owner_proof_recapture: 'NOT_LAUNCHED',
    popsike_ingested: false,
    gripsweat_ingested: false,
    discogs_restricted_ingested: false,
  };

  console.log(JSON.stringify(summary, null, 2));
  console.log(statusLine);

  const blockers = [
    ...verifiers.filter((v) => !v.ok).map((v) => `verifier:${v.script}`),
    summary.test_counts.fail ? 'unit_tests_failed' : null,
    summary.pressing_resolution.all_ok ? null : 'pressing_adversarial_failed',
    summary.recapture_root_absent ? null : 'recapture_root_present',
    summary.owner_proof_20_png_pack_absent ? null : '20_png_pack_present',
  ].filter(Boolean);

  if (blockers.length) {
    console.error(JSON.stringify({ blockers }, null, 2));
    process.exit(2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
