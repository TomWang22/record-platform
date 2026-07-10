/**
 * Phase 31O — latency outlier + staging-continue archive guard (read-only).
 */
import fs from 'node:fs';
import path from 'node:path';

export const DOC_LATENCY_ARCHIVE =
  'docs/ai-platform/PHASE_31O_LATENCY_OUTLIER_AND_STAGING_CONTINUE_ARCHIVE.md';
export const DOC_31K_PREVIEW = 'docs/ai-platform/PHASE_31K_PREVIEW_LIFECYCLE_GATE_ROOT_CAUSE.md';
export const DOC_OPERATOR = 'docs/ai-platform/PHASE_31_OBSERVABILITY_OPERATOR_GUIDE.md';
export const DOC_ACTIVE = 'docs/ai-platform/ACTIVE_CONTEXT.md';
export const DOC_COPILOT = 'docs/ai-platform/PHASE_21_COPILOT_CONTEXT.md';
export const DOC_DECISION = 'docs/ai-platform/PHASE_31I_GO_NO_GO_DECISION_PACKAGE.md';
export const DOC_ARCHIVE = 'docs/ai-platform/PHASE_31J_PRODUCTION_KPI_ENABLEMENT_DECISION_ARCHIVE.md';

export const LATENCY_MAX_OUTLIER_MS = 1_037_646;
export const LATENCY_MAX_OUTLIER_LABEL = '~1,037,645';

export const GUARDED_DOCS = [
  DOC_LATENCY_ARCHIVE,
  DOC_OPERATOR,
  DOC_ACTIVE,
  DOC_COPILOT,
  DOC_DECISION,
  DOC_ARCHIVE,
  'docs/ai-platform/PHASE_31D_R2_REPAIRED_STAGING_LONG_SOAK.md',
  'docs/ai-platform/PHASE_31A_PRODUCTION_KPI_ENABLEMENT_RFC.md',
];

export class Phase31LatencyOutlierGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase31LatencyOutlierGuardError';
  }
}

const FORBIDDEN_PATTERNS = [
  { pattern: /production enablement approved/i, label: 'production enablement approved' },
  { pattern: /production KPI writes enabled/i, label: 'production KPI writes enabled' },
  { pattern: /PERCENT\s*>\s*0/i, label: 'PERCENT > 0' },
  { pattern: /ALLOW_PROD_PERCENT\s*>\s*0/i, label: 'ALLOW_PROD_PERCENT > 0' },
  { pattern: /hybrid\/vector production default enabled/i, label: 'hybrid/vector production default enabled' },
  { pattern: /51840.*merged into.*57105/i, label: 'Phase 31 evidence merged into 57105/171315' },
  { pattern: /latency outlier ignored/i, label: 'latency outlier ignored' },
  { pattern: /Phase 31 is production rollout/i, label: 'Phase 31 is production rollout' },
  { pattern: /generated \/tmp reports committed/i, label: 'generated /tmp reports committed' },
  { pattern: /bench logs committed/i, label: 'bench logs committed' },
];

function lineHasNegation(line) {
  return (
    /\b(no|not|never|must not|did not|without|requires RCA|blocks)\b/i.test(line) ||
    /NOT APPROVED|NOT RUN|NOT merged|NOT performed|NOT committed|NOT enabled/i.test(line)
  );
}

export function readFile(repoRoot, relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Phase31LatencyOutlierGuardError(`missing required file: ${relativePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function assertMatch(content, pattern, message) {
  if (!pattern.test(content)) {
    throw new Phase31LatencyOutlierGuardError(message);
  }
}

function assertNoMatch(content, pattern, message) {
  if (pattern.test(content)) {
    throw new Phase31LatencyOutlierGuardError(message);
  }
}

export function assertNoForbiddenClaims(content, relativePath) {
  for (const line of content.split('\n')) {
    for (const { pattern, label } of FORBIDDEN_PATTERNS) {
      if (!pattern.test(line)) continue;
      if (lineHasNegation(line)) continue;
      throw new Phase31LatencyOutlierGuardError(
        `${relativePath} must not claim forbidden posture (${label}): ${line.trim()}`,
      );
    }
  }
}

export function validatePhase31KLabelUniqueness(repoRoot) {
  const docsDir = path.join(repoRoot, 'docs/ai-platform');
  const phase31kDocs = fs
    .readdirSync(docsDir)
    .filter((name) => name.startsWith('PHASE_31K_') && name.endsWith('.md'));
  if (phase31kDocs.length !== 1 || phase31kDocs[0] !== path.basename(DOC_31K_PREVIEW)) {
    throw new Phase31LatencyOutlierGuardError(
      `only one Phase 31K doc allowed (${DOC_31K_PREVIEW}); found: ${phase31kDocs.join(', ')}`,
    );
  }
  const staleLatency = path.join(docsDir, 'PHASE_31K_LATENCY_OUTLIER_AND_STAGING_CONTINUE_ARCHIVE.md');
  if (fs.existsSync(staleLatency)) {
    throw new Phase31LatencyOutlierGuardError(
      'stale PHASE_31K_LATENCY_OUTLIER_AND_STAGING_CONTINUE_ARCHIVE.md must be removed; use Phase 31O',
    );
  }
}

export function validateLatencyArchiveDoc(archive) {
  assertMatch(archive, /Phase 31O:\s*PASS/i, `${DOC_LATENCY_ARCHIVE} must state Phase 31O PASS`);
  assertNoMatch(
    archive,
    /^Phase 31K:\s*PASS/m,
    `${DOC_LATENCY_ARCHIVE} must not label itself Phase 31K`,
  );
  assertMatch(archive, /Phase 31:\s*CLOSED PASS/i, `${DOC_LATENCY_ARCHIVE} must state Phase 31 CLOSED PASS`);
  assertMatch(
    archive,
    /Decision:\s*B\s*—\s*STAGING CONTINUE/i,
    `${DOC_LATENCY_ARCHIVE} must state Decision B — STAGING CONTINUE`,
  );
  assertMatch(
    archive,
    /Production enablement:\s*NOT APPROVED/i,
    `${DOC_LATENCY_ARCHIVE} must deny production enablement`,
  );
  assertMatch(
    archive,
    /latency max outlier requires RCA/i,
    `${DOC_LATENCY_ARCHIVE} must block production until latency RCA`,
  );
  assertMatch(archive, /51840\/51840\s*PASS/i, `${DOC_LATENCY_ARCHIVE} must document matrix PASS`);
  assertMatch(
    archive,
    /1[,.]?037[,.]?645|1037645/i,
    `${DOC_LATENCY_ARCHIVE} must document latency max outlier`,
  );
  assertMatch(
    archive,
    /NOT merged into 57105|separate from Phase 22 57105/i,
    `${DOC_LATENCY_ARCHIVE} must deny merge into Phase 22 totals`,
  );
}

export function validateOperatorGuide(operator) {
  assertMatch(
    operator,
    /Production enablement:\s*NOT APPROVED/i,
    `${DOC_OPERATOR} must deny production enablement`,
  );
  assertMatch(
    operator,
    /PHASE_31O_LATENCY_OUTLIER_AND_STAGING_CONTINUE_ARCHIVE\.md/i,
    `${DOC_OPERATOR} must point to Phase 31O latency archive`,
  );
  assertMatch(
    operator,
    /ai-platform-verify-phase31-latency-outlier/i,
    `${DOC_OPERATOR} must reference latency outlier verifier`,
  );
}

export function validateActiveContext(active) {
  assertMatch(active, /Phase 31:\s*CLOSED PASS/i, `${DOC_ACTIVE} must state Phase 31 CLOSED PASS`);
  assertMatch(
    active,
    /STAGING CONTINUE|staging-only continuity/i,
    `${DOC_ACTIVE} must state staging continue posture`,
  );
  assertMatch(
    active,
    /Production enablement:.*NOT APPROVED/i,
    `${DOC_ACTIVE} must deny production enablement`,
  );
  assertNoMatch(
    active,
    /31K \(latency|31K latency/i,
    `${DOC_ACTIVE} must not label latency outlier as Phase 31K`,
  );
  assertMatch(
    active,
    /Phase 31O.*latency outlier/i,
    `${DOC_ACTIVE} must reference Phase 31O latency outlier`,
  );
}

export function validateCopilotContext(copilot) {
  assertMatch(copilot, /Phase 31.*CLOSED PASS/i, `${DOC_COPILOT} must reference Phase 31 CLOSED PASS`);
  assertMatch(
    copilot,
    /Production enablement:.*NOT APPROVED/i,
    `${DOC_COPILOT} must deny production enablement`,
  );
  assertMatch(
    copilot,
    /latency max outlier|1[,.]?037[,.]?645/i,
    `${DOC_COPILOT} must document latency outlier caveat`,
  );
}

export function validatePhase31LatencyOutlierGuard(repoRoot) {
  validatePhase31KLabelUniqueness(repoRoot);
  validateLatencyArchiveDoc(readFile(repoRoot, DOC_LATENCY_ARCHIVE));
  validateOperatorGuide(readFile(repoRoot, DOC_OPERATOR));
  validateActiveContext(readFile(repoRoot, DOC_ACTIVE));
  validateCopilotContext(readFile(repoRoot, DOC_COPILOT));
  for (const rel of GUARDED_DOCS) {
    assertNoForbiddenClaims(readFile(repoRoot, rel), rel);
  }
  return { status: 'PASS', docs_checked: GUARDED_DOCS.length };
}
