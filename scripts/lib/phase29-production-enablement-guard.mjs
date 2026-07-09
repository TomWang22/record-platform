/**
 * Phase 29J — production enablement track guard (read-only).
 */
import fs from 'node:fs';
import path from 'node:path';

export const EXPECTED_ARTIFACT_SHA = '1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa';

export const DOC_RFC = 'docs/ai-platform/PHASE_29A_OBSERVABILITY_PRODUCTION_ENABLEMENT_RFC.md';
export const DOC_ARCHIVE = 'docs/ai-platform/PHASE_29J_OBSERVABILITY_PRODUCTION_ENABLEMENT_ARCHIVE.md';
export const DOC_ACTIVE = 'docs/ai-platform/ACTIVE_CONTEXT.md';

export const CURRENT_STATUS_DOCS = [
  DOC_RFC,
  'docs/ai-platform/PHASE_29B_PREFLIGHT_VERIFICATION.md',
  'docs/ai-platform/PHASE_29C_CONTROLLED_ENV_READINESS.md',
  'docs/ai-platform/PHASE_29D_PIPELINE_DURABILITY_DRILL.md',
  'docs/ai-platform/PHASE_29E_REAL_INFERENCE_OBSERVABILITY_MATRIX.md',
  DOC_ARCHIVE,
  DOC_ACTIVE,
];

export class Phase29ProductionEnablementGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase29ProductionEnablementGuardError';
  }
}

export function readFile(repoRoot, relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Phase29ProductionEnablementGuardError(`missing required file: ${relativePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function assertMatch(content, pattern, message) {
  if (!pattern.test(content)) {
    throw new Phase29ProductionEnablementGuardError(message);
  }
}

const FORBIDDEN_PATTERNS = [
  /Phase 29 production rollout approved/i,
  /Phase 29 production default changed/i,
  /hybrid\/vector production default approved/i,
  /25920.*merged into.*57105/i,
  /25920.*merged into.*171315/i,
  /added to 57105\/57105/i,
  /added to 171315\/171315/i,
  /Phase 29 \/tmp reports committed/i,
  /Generated reports committed:\*?\*?\s*YES/i,
  /Bench logs committed:\*?\*?\s*YES/i,
  /Phase 29 generated production KPI enablement/i,
  /permanent production KPI write enablement/i,
];

function lineHasNegation(line) {
  return (
    /\b(no|not|never|must not|did not|without)\b/i.test(line) ||
    /NOT APPROVED|NOT RUN|NOT merged|NOT added|NOT committed|NOT performed/i.test(line)
  );
}

export function assertNoForbiddenProductionClaims(content, relativePath) {
  for (const line of content.split('\n')) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (!pattern.test(line)) continue;
      if (lineHasNegation(line)) continue;
      throw new Phase29ProductionEnablementGuardError(
        `${relativePath} must not claim forbidden production posture: ${line.trim()}`,
      );
    }
    if (/PERCENT\s*[=>]\s*[1-9]/i.test(line) && !lineHasNegation(line)) {
      throw new Phase29ProductionEnablementGuardError(`${relativePath} must not claim PERCENT > 0`);
    }
    if (/ALLOW_PROD_PERCENT\s*[=>]\s*[1-9]/i.test(line) && !lineHasNegation(line)) {
      throw new Phase29ProductionEnablementGuardError(
        `${relativePath} must not claim ALLOW_PROD_PERCENT > 0`,
      );
    }
  }
}

export function validateRfcDoc(rfc) {
  assertMatch(rfc, /Phase 29A:\s*PASS/i, `${DOC_RFC} must state Phase 29A PASS`);
  assertMatch(rfc, /Decision options/i, `${DOC_RFC} must list decision options`);
  assertMatch(rfc, /Production default:\s*keyword/i, `${DOC_RFC} must keep keyword default`);
  assertMatch(rfc, /PERCENT=0/i, `${DOC_RFC} must keep PERCENT=0`);
  assertMatch(rfc, /NOT APPROVED/i, `${DOC_RFC} must deny hybrid/vector production default`);
  assertMatch(
    rfc,
    /NOT merged into 57105|NOT added to 57105/i,
    `${DOC_RFC} must deny merge into Phase 22 totals`,
  );
}

export function validateArchiveDoc(archive) {
  assertMatch(
    archive,
    /25920\/25920|CLOSED PASS|IN_PROGRESS|BLOCKED/i,
    `${DOC_ARCHIVE} must document matrix status`,
  );
  assertMatch(
    archive,
    /Production enablement:\*?\*?\s*NOT APPROVED/i,
    `${DOC_ARCHIVE} must state production enablement NOT APPROVED`,
  );
  assertMatch(
    archive,
    /NOT Phase 22 full parity|NOT merged into 57105/i,
    `${DOC_ARCHIVE} must separate from Phase 22 parity`,
  );
  if (!archive.includes(EXPECTED_ARTIFACT_SHA)) {
    throw new Phase29ProductionEnablementGuardError(`${DOC_ARCHIVE} must include artifact SHA`);
  }
}

export function validateActiveContext(active) {
  assertMatch(active, /Phase 28:\s*CLOSED PASS/i, `${DOC_ACTIVE} must state Phase 28 CLOSED PASS`);
  assertMatch(active, /Phase 29/i, `${DOC_ACTIVE} must reference Phase 29`);
  assertMatch(active, /Production default:\s*keyword/i, `${DOC_ACTIVE} must keep keyword default`);
  assertMatch(active, /PERCENT=0/, `${DOC_ACTIVE} must keep PERCENT=0`);
  assertMatch(active, /ALLOW_PROD_PERCENT=0/, `${DOC_ACTIVE} must keep ALLOW_PROD_PERCENT=0`);
}

export function validateRunnerSafety(repoRoot) {
  const runner = readFile(repoRoot, 'scripts/phase29-controlled-observability-matrix-runner.mjs');
  if (!runner.includes('/tmp/phase29-controlled-observability-matrix')) {
    throw new Phase29ProductionEnablementGuardError('phase29 runner must default output to /tmp');
  }
  if (runner.includes('bench_logs/')) {
    throw new Phase29ProductionEnablementGuardError('phase29 runner must not write bench_logs');
  }
}

export function validatePhase29ProductionEnablementGuard(repoRoot) {
  validateRfcDoc(readFile(repoRoot, DOC_RFC));
  validateArchiveDoc(readFile(repoRoot, DOC_ARCHIVE));
  validateActiveContext(readFile(repoRoot, DOC_ACTIVE));
  validateRunnerSafety(repoRoot);
  for (const rel of CURRENT_STATUS_DOCS) {
    assertNoForbiddenProductionClaims(readFile(repoRoot, rel), rel);
  }
  return { status: 'PASS', docs_checked: CURRENT_STATUS_DOCS.length };
}
