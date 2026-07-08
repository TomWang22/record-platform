/**
 * Phase 28I — production-readiness archive/explainer guard (read-only).
 */
import fs from 'node:fs';
import path from 'node:path';

export const EXPECTED_ARTIFACT_SHA = '1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa';

export const DOC_ARCHIVE = 'docs/ai-platform/PHASE_28_OBSERVABILITY_PRODUCTION_READINESS_ARCHIVE.md';
export const DOC_OPERATOR = 'docs/ai-platform/PHASE_28_OBSERVABILITY_OPERATOR_GUIDE.md';
export const DOC_CODE_MAP = 'docs/ai-platform/PHASE_28_OBSERVABILITY_CODE_MAP.md';
export const DOC_28I = 'docs/ai-platform/PHASE_28I_PRODUCTION_READINESS_ARCHIVE_EXPLAINER.md';
export const DOC_ACTIVE = 'docs/ai-platform/ACTIVE_CONTEXT.md';

export const CURRENT_STATUS_DOCS = [DOC_ARCHIVE, DOC_OPERATOR, DOC_CODE_MAP, DOC_28I, DOC_ACTIVE];

export class Phase28ArchiveGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase28ArchiveGuardError';
  }
}

export function readFile(repoRoot, relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Phase28ArchiveGuardError(`missing required file: ${relativePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function assertMatch(content, pattern, message) {
  if (!pattern.test(content)) {
    throw new Phase28ArchiveGuardError(message);
  }
}

const FORBIDDEN_AFFIRMATIVE_PATTERNS = [
  {
    pattern: /Phase 28 production rollout approved/i,
    label: 'Phase 28 production rollout approved',
  },
  {
    pattern: /Phase 28 production default changed/i,
    label: 'Phase 28 production default changed',
  },
  {
    pattern: /hybrid\/vector production default approved/i,
    label: 'hybrid/vector production default approved',
  },
  {
    pattern: /25920.*merged into.*57105/i,
    label: '25920 merged into 57105',
  },
  {
    pattern: /25920.*merged into.*171315/i,
    label: '25920 merged into 171315',
  },
  {
    pattern: /added to 57105\/57105/i,
    label: 'added to 57105/57105',
  },
  {
    pattern: /added to 171315\/171315/i,
    label: 'added to 171315/171315',
  },
  {
    pattern: /Phase 28 \/tmp reports committed/i,
    label: 'Phase 28 /tmp reports committed',
  },
  {
    pattern: /Generated KPI reports committed:\*?\*?\s*YES/i,
    label: 'generated KPI reports committed YES',
  },
  {
    pattern: /Bench logs committed:\*?\*?\s*YES/i,
    label: 'bench logs committed YES',
  },
  {
    pattern: /Phase 28 generated production KPI enablement/i,
    label: 'Phase 28 generated production KPI enablement',
  },
];

function lineHasNegation(line) {
  return (
    /\b(no|not|never|must not|did not|is not|are not)\b/i.test(line) ||
    /NOT APPROVED|NOT RUN|NOT merged|NOT added|NOT committed/i.test(line)
  );
}

export function assertNoForbiddenProductionClaims(content, relativePath) {
  for (const line of content.split('\n')) {
    for (const { pattern, label } of FORBIDDEN_AFFIRMATIVE_PATTERNS) {
      if (!pattern.test(line)) continue;
      if (lineHasNegation(line)) continue;
      throw new Phase28ArchiveGuardError(`${relativePath} must not claim ${label}: ${line.trim()}`);
    }
    if (/PERCENT\s*[=>]\s*[1-9]/i.test(line) && !lineHasNegation(line)) {
      throw new Phase28ArchiveGuardError(`${relativePath} must not claim PERCENT > 0: ${line.trim()}`);
    }
    if (/ALLOW_PROD_PERCENT\s*[=>]\s*[1-9]/i.test(line) && !lineHasNegation(line)) {
      throw new Phase28ArchiveGuardError(
        `${relativePath} must not claim ALLOW_PROD_PERCENT > 0: ${line.trim()}`,
      );
    }
    if (/production default:\*?\*?\s*(hybrid|vector)/i.test(line) && !lineHasNegation(line)) {
      throw new Phase28ArchiveGuardError(
        `${relativePath} must not claim production default changed to hybrid/vector: ${line.trim()}`,
      );
    }
  }
}

export function validateArchiveDoc(archive) {
  assertMatch(archive, /Phase 28:\*?\*?\s*CLOSED PASS/i, `${DOC_ARCHIVE} must state Phase 28 CLOSED PASS`);
  assertMatch(archive, /25920\/25920/i, `${DOC_ARCHIVE} must document 25920/25920 matrix`);
  assertMatch(archive, /NOT Phase 22 full parity/i, `${DOC_ARCHIVE} must deny Phase 22 full parity equivalence`);
  assertMatch(
    archive,
    /NOT added to 57105\/57105 or 171315\/171315/i,
    `${DOC_ARCHIVE} must deny merge into 57105/171315`,
  );
  assertMatch(
    archive,
    /Production enablement:\*?\*?\s*NOT APPROVED/i,
    `${DOC_ARCHIVE} must state production enablement NOT APPROVED`,
  );
  assertMatch(
    archive,
    /Generated KPI reports committed:\*?\*?\s*NO/i,
    `${DOC_ARCHIVE} must state generated reports committed NO`,
  );
  assertMatch(
    archive,
    /Bench logs committed:\*?\*?\s*NO/i,
    `${DOC_ARCHIVE} must state bench logs committed NO`,
  );
  assertMatch(archive, /Phase 28I:\s*PASS/i, `${DOC_ARCHIVE} must include Phase 28I PASS in ledger`);
  assertMatch(archive, /PERCENT:\s*0/i, `${DOC_ARCHIVE} must document PERCENT=0`);
  assertMatch(archive, /ALLOW_PROD_PERCENT:\s*0/i, `${DOC_ARCHIVE} must document ALLOW_PROD_PERCENT=0`);
  if (!archive.includes(EXPECTED_ARTIFACT_SHA)) {
    throw new Phase28ArchiveGuardError(`${DOC_ARCHIVE} must include locked artifact SHA`);
  }
}

export function validateOperatorGuide(operator) {
  assertMatch(
    operator,
    /make ai-platform-verify-phase28-archive/,
    `${DOC_OPERATOR} must include archive verify command`,
  );
  assertMatch(
    operator,
    /NOT merged into 57105\/57105 or 171315\/171315/i,
    `${DOC_OPERATOR} must clarify 25920 is not merged into Phase 22 totals`,
  );
  assertMatch(
    operator,
    /do not mean production KPI observability is enabled/i,
    `${DOC_OPERATOR} must clarify row counts are not production enablement`,
  );
}

export function validateCodeMap(codeMap) {
  for (const required of [
    'scripts/phase28-controlled-observability-matrix-runner.mjs',
    'scripts/lib/phase28-controlled-matrix-summary.mjs',
    'scripts/phase28-summarize-controlled-matrix.mjs',
    'scripts/phase28-finalize-closeout.mjs',
    'scripts/lib/phase28-archive-guard.mjs',
    'scripts/phase28-archive-guard-readonly.mjs',
    'tests/phase28-archive-guard.test.mjs',
  ]) {
    if (!codeMap.includes(required)) {
      throw new Phase28ArchiveGuardError(`${DOC_CODE_MAP} must list ${required}`);
    }
  }
  assertMatch(
    codeMap,
    /NOT merged into 57105\/57105 or 171315\/171315/i,
    `${DOC_CODE_MAP} must state 25920 is not merged into Phase 22 totals`,
  );
}

export function validate28iDoc(doc28i) {
  assertMatch(doc28i, /Phase 28I:\*?\*?\s*PASS/i, `${DOC_28I} must state Phase 28I PASS`);
  assertMatch(doc28i, /Phase 28:\*?\*?\s*CLOSED PASS/i, `${DOC_28I} must state Phase 28 CLOSED PASS`);
  assertMatch(doc28i, /Live eval run:\*?\*?\s*NOT RUN/i, `${DOC_28I} must state Live eval NOT RUN`);
  assertMatch(
    doc28i,
    /Production enablement:\*?\*?\s*NOT APPROVED/i,
    `${DOC_28I} must deny production enablement`,
  );
  assertMatch(
    doc28i,
    /Never merge 25920 into 57105 or 171315 totals/i,
    `${DOC_28I} must warn against merging 25920 into Phase 22 totals`,
  );
  assertMatch(
    doc28i,
    /Approved: start Phase 29A/i,
    `${DOC_28I} next step must point at Phase 29A design only`,
  );
  if (!doc28i.includes(EXPECTED_ARTIFACT_SHA)) {
    throw new Phase28ArchiveGuardError(`${DOC_28I} must include locked artifact SHA`);
  }
}

export function validateActiveContext(active) {
  assertMatch(active, /Phase 28:\s*CLOSED PASS/i, `${DOC_ACTIVE} must state Phase 28 CLOSED PASS`);
  assertMatch(active, /Phase 28I/i, `${DOC_ACTIVE} must reference Phase 28I`);
  assertMatch(
    active,
    /PHASE_28_OBSERVABILITY_PRODUCTION_READINESS_ARCHIVE\.md/,
    `${DOC_ACTIVE} must point at Phase 28 archive`,
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
  assertMatch(
    nextBlock,
    /Approved: start Phase 29A/i,
    `${DOC_ACTIVE} next step must be Phase 29A RFC/design only after Phase 28 archive PASS`,
  );
  if (/Approved:\s*start Phase 28[C-H]/i.test(nextBlock)) {
    throw new Phase28ArchiveGuardError(
      `${DOC_ACTIVE} must not still propose Phase 28C–28H as next allowed step`,
    );
  }
  if (/Approved:\s*start Phase 29B/i.test(nextBlock)) {
    throw new Phase28ArchiveGuardError(`${DOC_ACTIVE} must not propose Phase 29B without owner approval`);
  }
}

export function validatePhase28Archive(repoRoot) {
  const archive = readFile(repoRoot, DOC_ARCHIVE);
  const operator = readFile(repoRoot, DOC_OPERATOR);
  const codeMap = readFile(repoRoot, DOC_CODE_MAP);
  const doc28i = readFile(repoRoot, DOC_28I);
  const active = readFile(repoRoot, DOC_ACTIVE);

  validateArchiveDoc(archive);
  validateOperatorGuide(operator);
  validateCodeMap(codeMap);
  validate28iDoc(doc28i);
  validateActiveContext(active);

  for (const relativePath of CURRENT_STATUS_DOCS) {
    assertNoForbiddenProductionClaims(readFile(repoRoot, relativePath), relativePath);
  }

  return {
    status: 'PASS',
    docs_checked: CURRENT_STATUS_DOCS.length,
  };
}
