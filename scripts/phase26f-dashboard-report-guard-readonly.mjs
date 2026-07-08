#!/usr/bin/env node
/**
 * Phase 26F — read-only dashboard/report generation guard CLI.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Phase26fDashboardReportGuardError,
  validatePhase26fDashboardReport,
} from './lib/phase26f-dashboard-report-guard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

try {
  const result = validatePhase26fDashboardReport(repoRoot);
  console.log('phase26f-dashboard-report-guard: PASS');
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  const message = err instanceof Phase26fDashboardReportGuardError ? err.message : String(err);
  console.error(`phase26f-dashboard-report-guard: FAIL — ${message}`);
  process.exit(1);
}
