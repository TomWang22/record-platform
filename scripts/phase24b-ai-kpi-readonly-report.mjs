#!/usr/bin/env node
/**
 * Phase 24B — read-only AI-platform KPI report aggregator.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertReportIsRedacted,
  buildKpiReport,
  EXPECTED_ARTIFACT_SHA,
} from './lib/phase24b-ai-kpi-readonly.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function loadIngestionKpi() {
  const result = spawnSync(process.execPath, ['scripts/phase24b-ingestion-kpi-readonly.mjs'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return { status: 'GAP', reason: result.stderr || 'ingestion extractor failed' };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return {
      status: parsed.ingestion_pipeline?.status === 'GAP' ? 'GAP' : 'PASS',
      run_counts: parsed.ingestion_pipeline?.run_counts,
      corpus: parsed.ingestion_pipeline?.corpus,
      last_run: parsed.ingestion_pipeline?.last_ingestion_run ?? null,
      reason: parsed.ingestion_pipeline?.reason,
    };
  } catch {
    return { status: 'GAP', reason: 'invalid ingestion extractor JSON' };
  }
}

function loadOperationalHealth() {
  const result = spawnSync('bash', ['scripts/phase24b-operational-health-readonly.sh'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return {
      archive_verifiers_pass: false,
      phase23_guardrails_pass: false,
      production_env: {},
    };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    return {
      archive_verifiers_pass: Boolean(parsed.archive_verifiers_pass),
      evidence_label_guard_pass: Boolean(parsed.evidence_label_guard_pass),
      dry_run_resume_validation_pass: Boolean(parsed.dry_run_resume_validation_pass),
      phase23_guardrails_pass: Boolean(parsed.phase23_guardrails_pass),
      production_env: parsed.production_env || {},
      telemetry_warns: parsed.telemetry_warns,
    };
  } catch {
    return {
      archive_verifiers_pass: false,
      phase23_guardrails_pass: false,
      production_env: {},
    };
  }
}

function main() {
  const artifactPath = path.join(REPO_ROOT, 'docs/ai-platform/T20-35-owner-approved-real-preview-participants.md');
  const actualSha = spawnSync('shasum', ['-a', '256', artifactPath], { encoding: 'utf8' }).stdout.split(' ')[0];
  if (actualSha !== EXPECTED_ARTIFACT_SHA) {
    console.error(`FAIL: artifact SHA mismatch ${actualSha}`);
    process.exit(1);
  }

  const report = buildKpiReport({
    repoRoot: REPO_ROOT,
    ingestionQueryResult: loadIngestionKpi(),
    operationalInput: loadOperationalHealth(),
  });
  assertReportIsRedacted(report);

  const output = `${JSON.stringify(report, null, 2)}\n`;
  const writePath = process.env.PHASE24_KPI_WRITE_SUMMARY;
  if (writePath) {
    fs.mkdirSync(path.dirname(writePath), { recursive: true });
    fs.writeFileSync(writePath, output);
  } else {
    const tmpPath = path.join(os.tmpdir(), `phase24-kpi-report-${Date.now()}.json`);
    fs.writeFileSync(tmpPath, output);
  }

  process.stdout.write(output);
  console.log('PASS: Phase 24B AI-platform KPI read-only report');
}

main();
