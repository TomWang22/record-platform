/**
 * Phase 30J — controlled staging KPI enablement track guard (read-only).
 */
import fs from 'node:fs';
import path from 'node:path';

export const EXPECTED_ARTIFACT_SHA = '1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa';

export const DOC_PLAN = 'docs/ai-platform/PHASE_30A_CONTROLLED_STAGING_KPI_ENABLEMENT_PLAN.md';
export const DOC_ARCHIVE = 'docs/ai-platform/PHASE_30J_CONTROLLED_STAGING_KPI_ENABLEMENT_ARCHIVE.md';
export const DOC_ACTIVE = 'docs/ai-platform/ACTIVE_CONTEXT.md';

export const CURRENT_STATUS_DOCS = [
  DOC_PLAN,
  'docs/ai-platform/PHASE_30B_STAGING_PREFLIGHT_VERIFICATION.md',
  'docs/ai-platform/PHASE_30C_STAGING_SCHEMA_APPLY_VERIFICATION.md',
  DOC_ARCHIVE,
  DOC_ACTIVE,
];

export class Phase30StagingEnablementGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase30StagingEnablementGuardError';
  }
}

export function readFile(repoRoot, relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Phase30StagingEnablementGuardError(`missing required file: ${relativePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function assertMatch(content, pattern, message) {
  if (!pattern.test(content)) {
    throw new Phase30StagingEnablementGuardError(message);
  }
}

const FORBIDDEN_PATTERNS = [
  /Phase 30 production rollout approved/i,
  /Phase 30 production default changed/i,
  /hybrid\/vector production default approved/i,
  /25920.*merged into.*57105/i,
  /25920.*merged into.*171315/i,
  /added to 57105\/57105/i,
  /added to 171315\/171315/i,
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
      throw new Phase30StagingEnablementGuardError(
        `${relativePath} must not claim forbidden production posture: ${line.trim()}`,
      );
    }
    if (/PERCENT\s*[=>]\s*[1-9]/i.test(line) && !lineHasNegation(line)) {
      throw new Phase30StagingEnablementGuardError(`${relativePath} must not claim PERCENT > 0`);
    }
    if (/ALLOW_PROD_PERCENT\s*[=>]\s*[1-9]/i.test(line) && !lineHasNegation(line)) {
      throw new Phase30StagingEnablementGuardError(
        `${relativePath} must not claim ALLOW_PROD_PERCENT > 0`,
      );
    }
  }
}

export function validatePlanDoc(plan) {
  assertMatch(plan, /Phase 30A:\s*PASS/i, `${DOC_PLAN} must state Phase 30A PASS`);
  assertMatch(plan, /controlled staging\/non-prod/i, `${DOC_PLAN} must name staging/non-prod target`);
  assertMatch(plan, /Production default:\s*keyword/i, `${DOC_PLAN} must keep keyword default`);
  assertMatch(plan, /PERCENT=0/i, `${DOC_PLAN} must keep PERCENT=0`);
  assertMatch(plan, /NOT merged into 57105/i, `${DOC_PLAN} must deny merge into Phase 22 totals`);
}

export function validateArchiveDoc(archive) {
  assertMatch(
    archive,
    /25920\/25920|IN_PROGRESS|BLOCKED|CLOSED PASS/i,
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
    throw new Phase30StagingEnablementGuardError(`${DOC_ARCHIVE} must include artifact SHA`);
  }
}

export function validateActiveContext(active) {
  assertMatch(active, /Phase 29:\s*CLOSED PASS/i, `${DOC_ACTIVE} must state Phase 29 CLOSED PASS`);
  assertMatch(active, /Phase 30:\s*CLOSED PASS/i, `${DOC_ACTIVE} must state Phase 30 CLOSED PASS`);
  assertMatch(active, /Production default:\s*keyword/i, `${DOC_ACTIVE} must keep keyword default`);
  assertMatch(active, /PERCENT=0/, `${DOC_ACTIVE} must keep PERCENT=0`);
  assertMatch(active, /ALLOW_PROD_PERCENT=0/, `${DOC_ACTIVE} must keep ALLOW_PROD_PERCENT=0`);
}

export function validateRunnerSafety(repoRoot) {
  const runner = readFile(repoRoot, 'scripts/phase30-controlled-observability-matrix-runner.mjs');
  if (!runner.includes('/tmp/phase30-controlled-staging-matrix')) {
    throw new Phase30StagingEnablementGuardError('phase30 runner must default output to /tmp staging matrix');
  }
  if (runner.includes('bench_logs/')) {
    throw new Phase30StagingEnablementGuardError('phase30 runner must not write bench_logs');
  }
}

export function validatePhase30StagingEnablementGuard(repoRoot) {
  validatePlanDoc(readFile(repoRoot, DOC_PLAN));
  validateArchiveDoc(readFile(repoRoot, DOC_ARCHIVE));
  validateActiveContext(readFile(repoRoot, DOC_ACTIVE));
  validateRunnerSafety(repoRoot);
  for (const rel of CURRENT_STATUS_DOCS) {
    assertNoForbiddenProductionClaims(readFile(repoRoot, rel), rel);
  }
  return { status: 'PASS', docs_checked: CURRENT_STATUS_DOCS.length };
}
