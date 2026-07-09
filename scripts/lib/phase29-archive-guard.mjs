/**
 * Phase 29K — production enablement archive/explainer guard (read-only).
 */
import fs from 'node:fs';
import path from 'node:path';

export const EXPECTED_ARTIFACT_SHA = '1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa';

export const DOC_ARCHIVE = 'docs/ai-platform/PHASE_29_OBSERVABILITY_PRODUCTION_ENABLEMENT_ARCHIVE.md';
export const DOC_OPERATOR = 'docs/ai-platform/PHASE_29_OBSERVABILITY_OPERATOR_GUIDE.md';
export const DOC_CODE_MAP = 'docs/ai-platform/PHASE_29_OBSERVABILITY_CODE_MAP.md';
export const DOC_29K = 'docs/ai-platform/PHASE_29K_PRODUCTION_ENABLEMENT_ARCHIVE_EXPLAINER.md';
export const DOC_ACTIVE = 'docs/ai-platform/ACTIVE_CONTEXT.md';

export const CURRENT_STATUS_DOCS = [DOC_ARCHIVE, DOC_OPERATOR, DOC_CODE_MAP, DOC_29K, DOC_ACTIVE];

export class Phase29ArchiveGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase29ArchiveGuardError';
  }
}

export function readFile(repoRoot, relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Phase29ArchiveGuardError(`missing required file: ${relativePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function assertMatch(content, pattern, message) {
  if (!pattern.test(content)) {
    throw new Phase29ArchiveGuardError(message);
  }
}

const FORBIDDEN_AFFIRMATIVE_PATTERNS = [
  { pattern: /Phase 29 production rollout approved/i, label: 'Phase 29 production rollout approved' },
  { pattern: /Phase 29 production default changed/i, label: 'Phase 29 production default changed' },
  { pattern: /hybrid\/vector production default approved/i, label: 'hybrid/vector production default approved' },
  { pattern: /25920.*merged into.*57105/i, label: '25920 merged into 57105' },
  { pattern: /25920.*merged into.*171315/i, label: '25920 merged into 171315' },
  { pattern: /added to 57105\/57105/i, label: 'added to 57105/57105' },
  { pattern: /added to 171315\/171315/i, label: 'added to 171315/171315' },
  { pattern: /Phase 29 \/tmp reports committed/i, label: 'Phase 29 /tmp reports committed' },
  { pattern: /Generated KPI reports committed:\*?\*?\s*YES/i, label: 'generated KPI reports committed YES' },
  { pattern: /Bench logs committed:\*?\*?\s*YES/i, label: 'bench logs committed YES' },
  { pattern: /permanent production KPI write enablement/i, label: 'permanent production KPI enablement' },
];

function lineHasNegation(line) {
  return (
    /\b(no|not|never|must not|did not|is not|are not|without)\b/i.test(line) ||
    /NOT APPROVED|NOT RUN|NOT merged|NOT added|NOT committed|NOT performed/i.test(line)
  );
}

export function assertNoForbiddenProductionClaims(content, relativePath) {
  for (const line of content.split('\n')) {
    for (const { pattern, label } of FORBIDDEN_AFFIRMATIVE_PATTERNS) {
      if (!pattern.test(line)) continue;
      if (lineHasNegation(line)) continue;
      throw new Phase29ArchiveGuardError(`${relativePath} must not claim ${label}: ${line.trim()}`);
    }
    if (/PERCENT\s*[=>]\s*[1-9]/i.test(line) && !lineHasNegation(line)) {
      throw new Phase29ArchiveGuardError(`${relativePath} must not claim PERCENT > 0: ${line.trim()}`);
    }
    if (/ALLOW_PROD_PERCENT\s*[=>]\s*[1-9]/i.test(line) && !lineHasNegation(line)) {
      throw new Phase29ArchiveGuardError(
        `${relativePath} must not claim ALLOW_PROD_PERCENT > 0: ${line.trim()}`,
      );
    }
  }
}

export function validateArchiveDoc(archive) {
  assertMatch(archive, /Phase 29:\*?\*?\s*CLOSED PASS/i, `${DOC_ARCHIVE} must state Phase 29 CLOSED PASS`);
  assertMatch(archive, /25920\/25920/i, `${DOC_ARCHIVE} must document 25920/25920 matrix`);
  assertMatch(archive, /NOT Phase 22 full parity/i, `${DOC_ARCHIVE} must deny Phase 22 full parity equivalence`);
  assertMatch(
    archive,
    /NOT merged into 57105\/171315|NOT added to 57105/i,
    `${DOC_ARCHIVE} must deny merge into Phase 22 totals`,
  );
  assertMatch(
    archive,
    /Production enablement:\*?\*?\s*NOT APPROVED/i,
    `${DOC_ARCHIVE} must state production enablement NOT APPROVED`,
  );
  assertMatch(archive, /Phase 29K:\s*PASS/i, `${DOC_ARCHIVE} must include Phase 29K PASS in ledger`);
  if (!archive.includes(EXPECTED_ARTIFACT_SHA)) {
    throw new Phase29ArchiveGuardError(`${DOC_ARCHIVE} must include locked artifact SHA`);
  }
}

export function validateOperatorGuide(operator) {
  assertMatch(
    operator,
    /make ai-platform-verify-phase29-archive/,
    `${DOC_OPERATOR} must include archive verify command`,
  );
  assertMatch(
    operator,
    /NOT merged into 57105|NOT Phase 22 full parity/i,
    `${DOC_OPERATOR} must clarify 25920 is not merged into Phase 22 totals`,
  );
  assertMatch(
    operator,
    /staging\/non-prod only|NOT production enablement/i,
    `${DOC_OPERATOR} must clarify decision is staging/non-prod only`,
  );
}

export function validateCodeMap(codeMap) {
  for (const required of [
    'scripts/phase29-controlled-observability-matrix-runner.mjs',
    'scripts/lib/phase29-controlled-matrix-summary.mjs',
    'scripts/phase29-summarize-controlled-matrix.mjs',
    'scripts/lib/phase29-archive-guard.mjs',
    'scripts/phase29-archive-guard-readonly.mjs',
    'tests/phase29-archive-guard.test.mjs',
  ]) {
    if (!codeMap.includes(required)) {
      throw new Phase29ArchiveGuardError(`${DOC_CODE_MAP} must list ${required}`);
    }
  }
}

export function validate29kDoc(doc29k) {
  assertMatch(doc29k, /Phase 29K:\*?\*?\s*PASS/i, `${DOC_29K} must state Phase 29K PASS`);
  assertMatch(doc29k, /Phase 29:\*?\*?\s*CLOSED PASS/i, `${DOC_29K} must state Phase 29 CLOSED PASS`);
  assertMatch(
    doc29k,
    /Production enablement:\*?\*?\s*NOT APPROVED/i,
    `${DOC_29K} must deny production enablement`,
  );
  assertMatch(
    doc29k,
    /Never merge 25920 into 57105 or 171315 totals/i,
    `${DOC_29K} must warn against merging 25920 into Phase 22 totals`,
  );
  assertMatch(
    doc29k,
    /Approved: start Phase 30A/i,
    `${DOC_29K} next step must point at Phase 30A`,
  );
  if (!doc29k.includes(EXPECTED_ARTIFACT_SHA)) {
    throw new Phase29ArchiveGuardError(`${DOC_29K} must include locked artifact SHA`);
  }
}

export function validateActiveContext(active) {
  assertMatch(active, /Phase 29:\s*CLOSED PASS/i, `${DOC_ACTIVE} must state Phase 29 CLOSED PASS`);
  assertMatch(active, /Phase 29K/i, `${DOC_ACTIVE} must reference Phase 29K`);
  assertMatch(
    active,
    /PHASE_29_OBSERVABILITY_PRODUCTION_ENABLEMENT_ARCHIVE\.md/,
    `${DOC_ACTIVE} must point at Phase 29 archive`,
  );
  assertMatch(active, /Production default:\s*keyword/i, `${DOC_ACTIVE} must keep keyword default`);
  assertMatch(active, /PERCENT=0/, `${DOC_ACTIVE} must keep PERCENT=0`);
  assertMatch(active, /ALLOW_PROD_PERCENT=0/, `${DOC_ACTIVE} must keep ALLOW_PROD_PERCENT=0`);
  assertMatch(
    active,
    /Production enablement:\s*NOT APPROVED/i,
    `${DOC_ACTIVE} must keep production enablement NOT APPROVED`,
  );

  const nextBlockMatch = active.match(/Next allowed step:\s*\n([\s\S]*?)(?:\n\n|$)/i);
  const nextBlock = nextBlockMatch ? nextBlockMatch[1] : active;
  if (!/Approved: start Phase 30A|Phase 30 CLOSED PASS|staging\/non-prod/i.test(nextBlock)) {
    throw new Phase29ArchiveGuardError(
      `${DOC_ACTIVE} next step must reference Phase 30A or Phase 30 CLOSED PASS`,
    );
  }
}

export function validatePhase29Archive(repoRoot) {
  const archive = readFile(repoRoot, DOC_ARCHIVE);
  const operator = readFile(repoRoot, DOC_OPERATOR);
  const codeMap = readFile(repoRoot, DOC_CODE_MAP);
  const doc29k = readFile(repoRoot, DOC_29K);
  const active = readFile(repoRoot, DOC_ACTIVE);

  validateArchiveDoc(archive);
  validateOperatorGuide(operator);
  validateCodeMap(codeMap);
  validate29kDoc(doc29k);
  validateActiveContext(active);

  for (const relativePath of CURRENT_STATUS_DOCS) {
    assertNoForbiddenProductionClaims(readFile(repoRoot, relativePath), relativePath);
  }

  return { status: 'PASS', docs_checked: CURRENT_STATUS_DOCS.length };
}
