/**
 * Phase 28B — offline observability durability harness (fixtures only, no network).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildCombinedAiPlatformKpiReport,
  writePhase26fReports,
  assertArtifactRedacted,
  assertWritableOutputDir,
  containsForbiddenFields,
} from './phase26f-combined-kpi-report-readonly.mjs';

export const EXPECTED_ARTIFACT_SHA = '1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa';

export const FORBIDDEN_FIELD_NAMES = [
  'response_body',
  'raw_response_body',
  'message_body',
  'raw_message_body',
  'jwt',
  'token',
  'password',
  'proxy_max_bid',
  'private_message',
  'authorization_header',
];

export const H123_PROTOCOLS = ['HTTP/1.1', 'HTTP/2', 'HTTP/3'];

export const DEFAULT_FLAGS_OFF = {
  master_disable: true,
  observability_enabled: false,
  ingestion_events_enabled: false,
  searchability_checks_enabled: false,
  query_observations_enabled: false,
  usefulness_observations_enabled: false,
};

export const DEFAULT_FLAGS_ON = {
  master_disable: false,
  observability_enabled: true,
  ingestion_events_enabled: true,
  searchability_checks_enabled: true,
  query_observations_enabled: true,
  usefulness_observations_enabled: true,
};

export class Phase28DurabilityHarnessError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase28DurabilityHarnessError';
  }
}

export function kpiWritesAllowed(channel, flags) {
  if (flags.master_disable) return false;
  if (!flags.observability_enabled) return false;
  const map = {
    ingestion: flags.ingestion_events_enabled,
    searchability: flags.searchability_checks_enabled,
    query: flags.query_observations_enabled,
    usefulness: flags.usefulness_observations_enabled,
  };
  return Boolean(map[channel]);
}

export function simulateWrite(channel, flags) {
  if (!kpiWritesAllowed(channel, flags)) {
    return { written: false, channel };
  }
  return { written: true, channel };
}

export function buildHappyPathFixture() {
  const arrived = '2026-07-08T10:00:00.000Z';
  const verified = '2026-07-08T10:00:00.042Z';
  return {
    ingestionEvents: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        source_type: 'phase28_fixture',
        records_received: 1,
        records_indexed: 1,
        embedding_jobs_started: 0,
        embedding_jobs_completed: 0,
        embedding_jobs_failed: 0,
        index_upsert_success: 1,
        index_upsert_failed: 0,
        dead_letter_count: 0,
        retry_count: 0,
      },
    ],
    searchabilityChecks: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        source_type: 'phase28_fixture',
        data_arrived_at: arrived,
        searchable_verified_at: verified,
        arrival_to_searchable_ms: 42,
        probe_status: 'PASS',
      },
    ],
    queryObservations: H123_PROTOCOLS.map((protocol, i) => ({
      id: `33333333-3333-4333-8333-33333333333${i}`,
      protocol,
      rag_total_ms: 25 + i * 5,
      gate_reason: 'keyword_default',
      workflow: 'phase28_harness',
      fallback_count: 0,
      canary_error_count: 0,
      observed_at: `2026-07-08T10:0${i}:00.000Z`,
    })),
    usefulnessObservations: [
      {
        protocol: 'HTTP/1.1',
        evidence_label: 'H1 baseline 57105/57105',
        response_pass: true,
        leakage_failures: 0,
        observed_at: '2026-07-08T11:00:00.000Z',
      },
      {
        protocol: 'HTTP/2',
        evidence_label: 'H2 replay 57105/57105',
        response_pass: true,
        leakage_failures: 0,
        observed_at: '2026-07-08T11:01:00.000Z',
      },
      {
        protocol: 'HTTP/3',
        evidence_label: 'H3 replay 57105/57105',
        response_pass: true,
        leakage_failures: 0,
        observed_at: '2026-07-08T11:02:00.000Z',
      },
      {
        protocol: 'HTTP/1.1',
        evidence_label: 'Phase 22C 7200/7200 sample only',
        response_pass: true,
        leakage_failures: 0,
        observed_at: '2026-07-08T11:03:00.000Z',
      },
    ],
  };
}

export function assertNoDuplicateIds(fixture) {
  const ids = [];
  for (const key of [
    'ingestionEvents',
    'searchabilityChecks',
    'queryObservations',
    'usefulnessObservations',
  ]) {
    for (const row of fixture[key] || []) {
      if (row.id) ids.push(row.id);
    }
  }
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Phase28DurabilityHarnessError(`duplicate KPI event id: ${id}`);
    }
    seen.add(id);
  }
  return true;
}

export function validateSearchabilityTimestampChain(row) {
  if (!row) return true;
  const ms = Number(row.arrival_to_searchable_ms);
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Phase28DurabilityHarnessError('arrival_to_searchable_ms must be non-negative');
  }
  if (row.data_arrived_at && row.searchable_verified_at) {
    const arrived = Date.parse(row.data_arrived_at);
    const verified = Date.parse(row.searchable_verified_at);
    if (Number.isFinite(arrived) && Number.isFinite(verified) && verified < arrived) {
      throw new Phase28DurabilityHarnessError('searchable_verified_at cannot precede data_arrived_at');
    }
  }
  return true;
}

export function validateQueryObservation(row) {
  const ms = Number(row.rag_total_ms);
  if (!Number.isFinite(ms) || ms < 0) {
    throw new Phase28DurabilityHarnessError('rag_total_ms must be non-negative');
  }
  return true;
}

export function validateProtocolCoverage(observationRows) {
  const h123Samples = H123_PROTOCOLS.filter((protocol) =>
    (observationRows || []).some((row) => row.protocol === protocol),
  );
  if (!h123Samples.length) return 'GAP';
  if (h123Samples.length < H123_PROTOCOLS.length) return 'PARTIAL';
  return 'PASS';
}

export function validateUnknownProtocolDoesNotCountAsH123(observationRows) {
  const unknownOnly = (observationRows || []).every((row) => row.protocol === 'unknown');
  if (unknownOnly && observationRows?.length) {
    const status = validateProtocolCoverage(observationRows);
    if (status !== 'GAP') {
      throw new Phase28DurabilityHarnessError('unknown protocol must not count toward H1/H2/H3 PASS');
    }
  }
  return true;
}

export function assertForbiddenFieldsAbsent(value) {
  if (containsForbiddenFields(value)) {
    throw new Phase28DurabilityHarnessError('fixture/report contains forbidden private fields');
  }
  return true;
}

export function validateEvidenceLabelText(text) {
  if (/7200\/7200\s+full\s+parity/i.test(text)) {
    throw new Phase28DurabilityHarnessError('Phase 22C 7200/7200 cannot be described as full parity');
  }
  if (/171315\/171315/i.test(text) && !/labeled/i.test(text)) {
    throw new Phase28DurabilityHarnessError('171315/171315 must be described as labeled sum only');
  }
  return true;
}

export function validateFixture(fixture) {
  assertNoDuplicateIds(fixture);
  for (const row of fixture.searchabilityChecks || []) {
    validateSearchabilityTimestampChain(row);
  }
  for (const row of fixture.queryObservations || []) {
    validateQueryObservation(row);
  }
  assertForbiddenFieldsAbsent(fixture);
  return true;
}

export function runDurabilityPipeline(fixture, { gitSha = 'phase28', outDir = '/tmp/phase28-durability-harness' } = {}) {
  validateFixture(fixture);
  assertWritableOutputDir(outDir);

  const reports = buildCombinedAiPlatformKpiReport({
    gitSha,
    kpiRows: fixture,
    operationalInput: { archive_verifiers_pass: true },
  });
  const combinedReport = reports.phase25_combined_ai_platform_kpi_report;
  assertArtifactRedacted(combinedReport);
  validateEvidenceLabelText(JSON.stringify(combinedReport));

  const childStatuses = reports.child_kpi_statuses;
  const files = writePhase26fReports(outDir, reports);

  return {
    status: 'PASS',
    combined_status: combinedReport.status,
    child_kpi_statuses: childStatuses,
    out_dir: outDir,
    files,
    redaction_status: combinedReport.redaction_status,
  };
}

export function runDisableSwitchDrill(flags = DEFAULT_FLAGS_OFF) {
  const channels = ['ingestion', 'searchability', 'query', 'usefulness'];
  const results = channels.map((ch) => simulateWrite(ch, flags));
  if (results.some((r) => r.written)) {
    throw new Phase28DurabilityHarnessError('disable-switch drill: writes must be blocked');
  }
  return { status: 'PASS', blocked_channels: channels.length };
}

export function runEnabledChannelDrill(flags) {
  const channels = ['ingestion', 'searchability', 'query', 'usefulness'];
  const results = Object.fromEntries(channels.map((ch) => [ch, simulateWrite(ch, flags)]));
  return results;
}

export function assertOutputOutsideTmpFails(outDir) {
  try {
    assertWritableOutputDir(outDir);
    throw new Phase28DurabilityHarnessError('expected non-tmp output path to fail');
  } catch (err) {
    if (err instanceof Phase28DurabilityHarnessError && err.message.includes('expected non-tmp')) {
      throw err;
    }
    return true;
  }
}

export function runHarnessSelfCheck(repoRoot) {
  const tmpDir = path.join(os.tmpdir(), `phase28-harness-${Date.now()}`);
  const happy = runDurabilityPipeline(buildHappyPathFixture(), { outDir: tmpDir });
  const disable = runDisableSwitchDrill(DEFAULT_FLAGS_OFF);
  const enabled = runEnabledChannelDrill(DEFAULT_FLAGS_ON);
  if (!Object.values(enabled).every((r) => r.written)) {
    throw new Phase28DurabilityHarnessError('enabled flags must allow all channels in harness drill');
  }
  assertOutputOutsideTmpFails(path.join(repoRoot, 'webapp'));
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best effort cleanup
  }
  return {
    status: 'PASS',
    happy_path: happy.child_kpi_statuses,
    disable_switch: disable,
  };
}
