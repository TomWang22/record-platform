/**
 * Phase 28H — production-readiness closeout guard (read-only).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

export const EXPECTED_ARTIFACT_SHA = '1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa';

const DOCS = {
  c: 'docs/ai-platform/PHASE_28C_LOCAL_DEV_KPI_PIPELINE_DURABILITY_DRILL.md',
  d: 'docs/ai-platform/PHASE_28D_CONTROLLED_REAL_INFERENCE_OBSERVABILITY_MATRIX.md',
  e: 'docs/ai-platform/PHASE_28E_H1_H2_H3_QUERY_OBSERVATION_PROTOCOL_VERIFICATION.md',
  f: 'docs/ai-platform/PHASE_28F_KPI_DURABILITY_REPORT_FROM_CONTROLLED_EVIDENCE.md',
  g: 'docs/ai-platform/PHASE_28G_DISABLE_SWITCH_ROLLBACK_DRILL.md',
  h: 'docs/ai-platform/PHASE_28H_OBSERVABILITY_PRODUCTION_READINESS_CLOSEOUT.md',
  archive: 'docs/ai-platform/PHASE_28_OBSERVABILITY_PRODUCTION_READINESS_ARCHIVE.md',
  operator: 'docs/ai-platform/PHASE_28_OBSERVABILITY_OPERATOR_GUIDE.md',
  active: 'docs/ai-platform/ACTIVE_CONTEXT.md',
};

const MATRIX_RUNNER = path.join(REPO_ROOT, 'scripts/phase28-controlled-observability-matrix-runner.mjs');
const MATRIX_SUMMARY = path.join(REPO_ROOT, 'scripts/lib/phase28-controlled-matrix-summary.mjs');

export class Phase28CloseoutGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase28CloseoutGuardError';
  }
}

function read(rel) {
  const p = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(p)) throw new Phase28CloseoutGuardError(`missing: ${rel}`);
  return fs.readFileSync(p, 'utf8');
}

function assertMatch(text, pattern, label) {
  if (!pattern.test(text)) throw new Phase28CloseoutGuardError(label);
}

function assertNoAffirmativeProductionClaim(text, rel) {
  for (const line of text.split('\n')) {
    if (/production rollout approved/i.test(line) && !/\bnot\b/i.test(line)) {
      throw new Phase28CloseoutGuardError(`${rel} claims production rollout approved`);
    }
    if (/production DB migration:\s*RUN/i.test(line) && !/NOT RUN/i.test(line)) {
      throw new Phase28CloseoutGuardError(`${rel} claims production DB migration RUN`);
    }
    if (/Generated reports committed:\s*YES/i.test(line)) {
      throw new Phase28CloseoutGuardError(`${rel} claims generated reports committed`);
    }
    if (/7200\/7200\s+full\s+parity/i.test(line) && !/\bnot\b|never|sample only/i.test(line)) {
      throw new Phase28CloseoutGuardError(`${rel} mislabels 7200 as full parity`);
    }
    if (/171315\/171315/i.test(line) && /unlabeled cumulative/i.test(line) && !/\bnot\b|never|labeled/i.test(line)) {
      throw new Phase28CloseoutGuardError(`${rel} mislabels 171315 as unlabeled cumulative`);
    }
  }
}

export function validateCloseoutDocs() {
  for (const rel of Object.values(DOCS)) {
    const text = read(rel);
    assertNoAffirmativeProductionClaim(text, rel);
    if (!text.includes(EXPECTED_ARTIFACT_SHA)) {
      throw new Phase28CloseoutGuardError(`${rel} must include artifact SHA`);
    }
  }

  const closeout = read(DOCS.h);
  assertMatch(closeout, /Phase 28H:/i, '28H closeout doc must exist');
  const closeoutStatusLine = closeout.split('\n').find((line) => /^Phase 28:\s*(CLOSED PASS|BLOCKED)/i.test(line.trim()));
  if (closeoutStatusLine && /CLOSED PASS/i.test(closeoutStatusLine)) {
    assertMatch(closeout, /25920\/25920/i, '28H must document matrix 25920/25920 when CLOSED PASS');
    assertMatch(closeout, /Controlled real inference run:\s*PASS/i, '28H must state controlled matrix PASS when closed');
  } else {
    assertMatch(closeout, /Phase 28:\s*BLOCKED/i, '28H must state BLOCKED while matrix incomplete');
  }

  const matrix = read(DOCS.d);
  assertMatch(matrix, /8640\/8640/i, '28D must document per-protocol counts');
  assertMatch(matrix, /Phase 28 controlled observability production-readiness matrix/i, '28D must use Phase 28 evidence label');

  const active = read(DOCS.active);
  assertMatch(active, /Phase 28C:\s*PASS/i, 'ACTIVE_CONTEXT must include 28C PASS');
  if (/Phase 28:\s*CLOSED PASS/i.test(active)) {
    assertMatch(active, /Phase 28H:\s*PASS/i, 'ACTIVE_CONTEXT must include 28H PASS when closed');
  }

  return { status: 'PASS', docs_checked: Object.keys(DOCS).length };
}

export function validateMatrixRunnerSafety() {
  const runner = read(path.relative(REPO_ROOT, MATRIX_RUNNER));
  if (!runner.includes('/tmp/phase28-controlled-observability-matrix')) {
    throw new Phase28CloseoutGuardError('matrix runner must default output to /tmp');
  }
  if (runner.includes('bench_logs/')) {
    throw new Phase28CloseoutGuardError('matrix runner must not write bench_logs');
  }
  const summary = read(path.relative(REPO_ROOT, MATRIX_SUMMARY));
  if (!summary.includes('25920')) {
    throw new Phase28CloseoutGuardError('matrix summary must reference 25920 target');
  }
  return { status: 'PASS' };
}

export function validatePhase28CloseoutGuard() {
  validateCloseoutDocs();
  validateMatrixRunnerSafety();
  return { status: 'PASS' };
}
