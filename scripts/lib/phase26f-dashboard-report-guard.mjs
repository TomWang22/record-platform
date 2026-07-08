/**
 * Phase 26F — read-only dashboard/report generation guard (no network required).
 */
import fs from 'node:fs';
import path from 'node:path';

export const EXPECTED_ARTIFACT_SHA = '1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa';

export const CLOSEOUT_DOC = 'docs/ai-platform/PHASE_26F_KPI_DASHBOARD_REPORT_GENERATION_CLOSEOUT.md';

export const FORBIDDEN_COLUMNS = [
  'response_body',
  'raw_response_body',
  'answer',
  'summary',
  'question',
  'prompt',
  'message_body',
  'raw_message_body',
  'jwt',
  'token',
  'password',
  'authorization_header',
  'cookie',
  'proxy_max_bid',
  'private_message',
];

export const LIVE_PATTERNS = [/\bcurl\b/i, /\bkubectl\b/i, /live eval/i, /57105\s*replay/i];

export class Phase26fDashboardReportGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase26fDashboardReportGuardError';
  }
}

export function readFile(repoRoot, relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Phase26fDashboardReportGuardError(`missing required file: ${relativePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

export function validatePhase26fDashboardReport(repoRoot) {
  const closeout = readFile(repoRoot, CLOSEOUT_DOC);
  const reportLib = readFile(repoRoot, 'scripts/lib/phase26f-combined-kpi-report-readonly.mjs');
  const reportCli = readFile(repoRoot, 'scripts/phase26f-combined-kpi-report-readonly.mjs');
  const active = readFile(repoRoot, 'docs/ai-platform/ACTIVE_CONTEXT.md');
  const nodeTests = readFile(repoRoot, 'tests/phase26f-combined-kpi-report-readonly.test.mjs');

  if (!/Phase 26F:.*PASS/i.test(closeout)) {
    throw new Phase26fDashboardReportGuardError('closeout missing Phase 26F: PASS');
  }
  if (!/Live eval:.*NOT RUN/i.test(closeout)) {
    throw new Phase26fDashboardReportGuardError('closeout must state Live eval NOT RUN');
  }
  if (!/Runtime\/env\/default\/allowlist changes:.*NONE/i.test(closeout)) {
    throw new Phase26fDashboardReportGuardError('closeout must state runtime/env/default/allowlist changes NONE');
  }
  if (!/DB writes performed:.*NO/i.test(closeout)) {
    throw new Phase26fDashboardReportGuardError('closeout must state DB writes performed NO');
  }
  if (!/Migrations applied:.*NO/i.test(closeout)) {
    throw new Phase26fDashboardReportGuardError('closeout must state migrations applied NO');
  }
  if (!/Report output committed:.*NO/i.test(closeout)) {
    throw new Phase26fDashboardReportGuardError('closeout must state report output not committed');
  }
  if (!/Raw\/private fields in reports:.*NO/i.test(closeout)) {
    throw new Phase26fDashboardReportGuardError('closeout must state raw/private fields absent from reports');
  }
  if (!/Bench logs committed:.*NO/i.test(closeout)) {
    throw new Phase26fDashboardReportGuardError('closeout must state bench logs not committed');
  }
  if (!/Combined KPI report generation:.*PASS/i.test(closeout)) {
    throw new Phase26fDashboardReportGuardError('closeout must state combined KPI report generation PASS');
  }
  if (!/No model accuracy claim without ground truth/i.test(closeout)) {
    throw new Phase26fDashboardReportGuardError('closeout must deny model accuracy claims without ground truth');
  }

  if (!reportLib.includes('buildCombinedAiPlatformKpiReport')) {
    throw new Phase26fDashboardReportGuardError('combined report builder missing');
  }
  if (!reportLib.includes('writePhase26fReports')) {
    throw new Phase26fDashboardReportGuardError('report writer missing');
  }
  if (!reportLib.includes('assertWritableOutputDir')) {
    throw new Phase26fDashboardReportGuardError('output dir guard missing');
  }
  if (!reportLib.includes('phase25_combined_ai_platform_kpi_report')) {
    throw new Phase26fDashboardReportGuardError('combined artifact name missing');
  }
  if (!reportLib.includes('171315/171315 is labeled H1+H2+H3 only')) {
    throw new Phase26fDashboardReportGuardError('evidence label preservation missing');
  }
  if (!reportLib.includes('not model accuracy without ground truth')) {
    throw new Phase26fDashboardReportGuardError('usefulness wording must avoid model accuracy claims');
  }

  for (const forbidden of FORBIDDEN_COLUMNS) {
    if (!reportLib.includes(forbidden)) {
      throw new Phase26fDashboardReportGuardError(`report lib must guard forbidden field: ${forbidden}`);
    }
  }

  if (!reportCli.includes('/tmp')) {
    throw new Phase26fDashboardReportGuardError('CLI must default output to /tmp');
  }
  if (/INSERT INTO ai\.ai_kpi_/i.test(reportCli)) {
    throw new Phase26fDashboardReportGuardError('report CLI must not perform DB writes');
  }

  for (const pattern of LIVE_PATTERNS) {
    if (pattern.test(nodeTests)) {
      throw new Phase26fDashboardReportGuardError('report tests must not include live RAG/curl/kubectl/replay patterns');
    }
  }

  if (!/Phase 26F:.*PASS/i.test(active)) {
    throw new Phase26fDashboardReportGuardError('ACTIVE_CONTEXT missing Phase 26F PASS');
  }

  if (!closeout.includes(EXPECTED_ARTIFACT_SHA)) {
    throw new Phase26fDashboardReportGuardError('closeout missing locked artifact SHA');
  }

  const bannedEvidence = [
    /57105\s*\/\s*57105.*smoke/i,
    /171315\s*\/\s*171315.*unlabeled cumulative/i,
    /7200\s*\/\s*7200.*full parity/i,
  ];
  for (const pattern of bannedEvidence) {
    if (pattern.test(closeout)) {
      throw new Phase26fDashboardReportGuardError('closeout must not relabel matrix evidence');
    }
  }

  return {
    status: 'PASS',
    closeout_doc: CLOSEOUT_DOC,
    forbidden_fields_guarded: FORBIDDEN_COLUMNS.length,
  };
}
