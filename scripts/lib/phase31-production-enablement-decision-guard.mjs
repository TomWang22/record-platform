/**
 * Phase 31J — production KPI enablement decision track guard (read-only).
 */
import fs from 'node:fs';
import path from 'node:path';

export const EXPECTED_ARTIFACT_SHA = '1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa';

export const DOC_RFC = 'docs/ai-platform/PHASE_31A_PRODUCTION_KPI_ENABLEMENT_RFC.md';
export const DOC_ARCHIVE = 'docs/ai-platform/PHASE_31J_PRODUCTION_KPI_ENABLEMENT_DECISION_ARCHIVE.md';
export const DOC_ACTIVE = 'docs/ai-platform/ACTIVE_CONTEXT.md';

export const CURRENT_STATUS_DOCS = [
  DOC_RFC,
  'docs/ai-platform/PHASE_31B_PREFLIGHT_VERIFICATION.md',
  'docs/ai-platform/PHASE_31C_STAGING_LONG_SOAK_PLAN.md',
  DOC_ARCHIVE,
  DOC_ACTIVE,
];

export class Phase31ProductionEnablementDecisionGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase31ProductionEnablementDecisionGuardError';
  }
}

export function readFile(repoRoot, relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Phase31ProductionEnablementDecisionGuardError(`missing required file: ${relativePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function assertMatch(content, pattern, message) {
  if (!pattern.test(content)) {
    throw new Phase31ProductionEnablementDecisionGuardError(message);
  }
}

const FORBIDDEN_PATTERNS = [
  /Phase 31 production rollout approved/i,
  /Phase 31 production enablement performed/i,
  /permanent production KPI write enablement/i,
  /51840.*merged into.*57105/i,
];

function lineHasNegation(line) {
  return (
    /\b(no|not|never|must not|did not|without)\b/i.test(line) ||
    /NOT APPROVED|NOT RUN|NOT merged|NOT performed|NOT committed/i.test(line)
  );
}

export function assertNoForbiddenProductionClaims(content, relativePath) {
  for (const line of content.split('\n')) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (!pattern.test(line)) continue;
      if (lineHasNegation(line)) continue;
      throw new Phase31ProductionEnablementDecisionGuardError(
        `${relativePath} must not claim forbidden production posture: ${line.trim()}`,
      );
    }
  }
}

export function validateRfcDoc(rfc) {
  assertMatch(rfc, /Phase 31A:\s*PASS/i, `${DOC_RFC} must state Phase 31A PASS`);
  assertMatch(rfc, /Decision options/i, `${DOC_RFC} must list decision options`);
  assertMatch(rfc, /Production default:\s*keyword/i, `${DOC_RFC} must keep keyword default`);
  assertMatch(rfc, /NOT merged into 57105/i, `${DOC_RFC} must deny merge into Phase 22 totals`);
}

export function validateArchiveDoc(archive) {
  assertMatch(
    archive,
    /51840\/51840|IN_PROGRESS|BLOCKED|CLOSED PASS/i,
    `${DOC_ARCHIVE} must document soak status`,
  );
  assertMatch(
    archive,
    /Production enablement:\*?\*?\s*NOT APPROVED/i,
    `${DOC_ARCHIVE} must state production enablement NOT APPROVED`,
  );
  if (!archive.includes(EXPECTED_ARTIFACT_SHA)) {
    throw new Phase31ProductionEnablementDecisionGuardError(`${DOC_ARCHIVE} must include artifact SHA`);
  }
}

export function validateActiveContext(active) {
  assertMatch(active, /Phase 30:\s*CLOSED PASS/i, `${DOC_ACTIVE} must state Phase 30 CLOSED PASS`);
  assertMatch(active, /Phase 31/i, `${DOC_ACTIVE} must reference Phase 31`);
  assertMatch(active, /Production enablement:\s*NOT APPROVED/i, `${DOC_ACTIVE} must deny production enablement`);
}

export function validateRunnerSafety(repoRoot) {
  const runner = readFile(repoRoot, 'scripts/phase31-controlled-observability-matrix-runner.mjs');
  if (!runner.includes('resolvePhase31MatrixRoot')) {
    throw new Phase31ProductionEnablementDecisionGuardError(
      'phase31 runner must resolve matrix root via resolvePhase31MatrixRoot',
    );
  }
  if (runner.includes('/tmp/phase31-staging-long-soak-matrix')) {
    throw new Phase31ProductionEnablementDecisionGuardError(
      'phase31 runner must not default to blocked original soak path',
    );
  }
}

export function validatePhase31ProductionEnablementDecisionGuard(repoRoot) {
  validateRfcDoc(readFile(repoRoot, DOC_RFC));
  validateArchiveDoc(readFile(repoRoot, DOC_ARCHIVE));
  validateActiveContext(readFile(repoRoot, DOC_ACTIVE));
  validateRunnerSafety(repoRoot);
  for (const rel of CURRENT_STATUS_DOCS) {
    assertNoForbiddenProductionClaims(readFile(repoRoot, rel), rel);
  }
  return { status: 'PASS', docs_checked: CURRENT_STATUS_DOCS.length };
}
