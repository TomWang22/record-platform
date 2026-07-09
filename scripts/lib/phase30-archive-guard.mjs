/**
 * Phase 30K — staging enablement archive/explainer guard (read-only).
 */
import fs from 'node:fs';
import path from 'node:path';

export const EXPECTED_ARTIFACT_SHA = '1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa';

export const DOC_ARCHIVE = 'docs/ai-platform/PHASE_30_OBSERVABILITY_STAGING_ENABLEMENT_ARCHIVE.md';
export const DOC_OPERATOR = 'docs/ai-platform/PHASE_30_OBSERVABILITY_OPERATOR_GUIDE.md';
export const DOC_CODE_MAP = 'docs/ai-platform/PHASE_30_OBSERVABILITY_CODE_MAP.md';
export const DOC_30K = 'docs/ai-platform/PHASE_30K_STAGING_ENABLEMENT_ARCHIVE_EXPLAINER.md';
export const DOC_ACTIVE = 'docs/ai-platform/ACTIVE_CONTEXT.md';

export const CURRENT_STATUS_DOCS = [DOC_ARCHIVE, DOC_OPERATOR, DOC_CODE_MAP, DOC_30K, DOC_ACTIVE];

export class Phase30ArchiveGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase30ArchiveGuardError';
  }
}

export function readFile(repoRoot, relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Phase30ArchiveGuardError(`missing required file: ${relativePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function assertMatch(content, pattern, message) {
  if (!pattern.test(content)) {
    throw new Phase30ArchiveGuardError(message);
  }
}

const FORBIDDEN_AFFIRMATIVE_PATTERNS = [
  { pattern: /Phase 30 production rollout approved/i, label: 'Phase 30 production rollout approved' },
  { pattern: /Phase 30 production enablement performed/i, label: 'Phase 30 production enablement performed' },
  { pattern: /hybrid\/vector production default approved/i, label: 'hybrid/vector production default approved' },
  { pattern: /25920.*merged into.*57105/i, label: '25920 merged into 57105' },
  { pattern: /added to 57105\/57105/i, label: 'added to 57105/57105' },
  { pattern: /permanent production KPI write enablement/i, label: 'permanent production KPI enablement' },
];

function lineHasNegation(line) {
  return (
    /\b(no|not|never|must not|did not|without)\b/i.test(line) ||
    /NOT APPROVED|NOT RUN|NOT merged|NOT added|NOT committed|NOT performed|staging\/non-prod only/i.test(line)
  );
}

export function assertNoForbiddenProductionClaims(content, relativePath) {
  for (const line of content.split('\n')) {
    for (const { pattern, label } of FORBIDDEN_AFFIRMATIVE_PATTERNS) {
      if (!pattern.test(line)) continue;
      if (lineHasNegation(line)) continue;
      throw new Phase30ArchiveGuardError(`${relativePath} must not claim ${label}: ${line.trim()}`);
    }
    if (/PERCENT\s*[=>]\s*[1-9]/i.test(line) && !lineHasNegation(line)) {
      throw new Phase30ArchiveGuardError(`${relativePath} must not claim PERCENT > 0`);
    }
  }
}

export function validateArchiveDoc(archive) {
  assertMatch(archive, /Phase 30:\*?\*?\s*CLOSED PASS/i, `${DOC_ARCHIVE} must state Phase 30 CLOSED PASS`);
  assertMatch(archive, /25920\/25920/i, `${DOC_ARCHIVE} must document 25920/25920 matrix`);
  assertMatch(archive, /staging\/non-prod only/i, `${DOC_ARCHIVE} must state staging/non-prod only`);
  assertMatch(archive, /not production enablement/i, `${DOC_ARCHIVE} must deny production enablement`);
  assertMatch(archive, /NOT merged into 57105/i, `${DOC_ARCHIVE} must deny merge into Phase 22 totals`);
  assertMatch(archive, /Production enablement:\*?\*?\s*NOT APPROVED/i, `${DOC_ARCHIVE} must deny production enablement`);
  assertMatch(archive, /Phase 30K:\s*PASS/i, `${DOC_ARCHIVE} must include Phase 30K PASS`);
  if (!archive.includes(EXPECTED_ARTIFACT_SHA)) {
    throw new Phase30ArchiveGuardError(`${DOC_ARCHIVE} must include artifact SHA`);
  }
}

export function validateOperatorGuide(operator) {
  assertMatch(operator, /make ai-platform-verify-phase30-archive/, `${DOC_OPERATOR} must include archive verify`);
  assertMatch(operator, /NOT merged into 57105/i, `${DOC_OPERATOR} must clarify matrix separation`);
  assertMatch(operator, /staging\/non-prod only/i, `${DOC_OPERATOR} must clarify staging-only scope`);
}

export function validateCodeMap(codeMap) {
  for (const required of [
    'scripts/phase30-controlled-observability-matrix-runner.mjs',
    'scripts/lib/phase30-archive-guard.mjs',
    'scripts/phase30-archive-guard-readonly.mjs',
    'tests/phase30-archive-guard.test.mjs',
  ]) {
    if (!codeMap.includes(required)) {
      throw new Phase30ArchiveGuardError(`${DOC_CODE_MAP} must list ${required}`);
    }
  }
}

export function validate30kDoc(doc30k) {
  assertMatch(doc30k, /Phase 30K:\*?\*?\s*PASS/i, `${DOC_30K} must state Phase 30K PASS`);
  assertMatch(doc30k, /Phase 30 was not production enablement/i, `${DOC_30K} must deny production enablement`);
  assertMatch(doc30k, /Approved: start Phase 31A/i, `${DOC_30K} next step must point at Phase 31A`);
  if (!doc30k.includes(EXPECTED_ARTIFACT_SHA)) {
    throw new Phase30ArchiveGuardError(`${DOC_30K} must include artifact SHA`);
  }
}

export function validateActiveContext(active) {
  assertMatch(active, /Phase 30:\s*CLOSED PASS/i, `${DOC_ACTIVE} must state Phase 30 CLOSED PASS`);
  assertMatch(active, /Phase 30K/i, `${DOC_ACTIVE} must reference Phase 30K`);
  assertMatch(
    active,
    /PHASE_30_OBSERVABILITY_STAGING_ENABLEMENT_ARCHIVE\.md/,
    `${DOC_ACTIVE} must point at Phase 30 archive`,
  );
  assertMatch(active, /Production enablement:\s*NOT APPROVED/i, `${DOC_ACTIVE} must deny production enablement`);
}

export function validatePhase30Archive(repoRoot) {
  validateArchiveDoc(readFile(repoRoot, DOC_ARCHIVE));
  validateOperatorGuide(readFile(repoRoot, DOC_OPERATOR));
  validateCodeMap(readFile(repoRoot, DOC_CODE_MAP));
  validate30kDoc(readFile(repoRoot, DOC_30K));
  validateActiveContext(readFile(repoRoot, DOC_ACTIVE));
  for (const rel of CURRENT_STATUS_DOCS) {
    assertNoForbiddenProductionClaims(readFile(repoRoot, rel), rel);
  }
  return { status: 'PASS', docs_checked: CURRENT_STATUS_DOCS.length };
}
