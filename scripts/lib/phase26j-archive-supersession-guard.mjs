/**
 * Phase 26J — archive supersession / historical-snapshot clarity guard (read-only).
 */
import fs from 'node:fs';
import path from 'node:path';

export const EXPECTED_ARTIFACT_SHA = '1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa';

export const DOC_26F = 'docs/ai-platform/PHASE_26F_KPI_DASHBOARD_REPORT_GENERATION_CLOSEOUT.md';
export const DOC_ARCHIVE = 'docs/ai-platform/PHASE_26_OBSERVABILITY_IMPLEMENTATION_ARCHIVE.md';
export const DOC_OPERATOR = 'docs/ai-platform/PHASE_26_OBSERVABILITY_OPERATOR_GUIDE.md';
export const DOC_ACTIVE = 'docs/ai-platform/ACTIVE_CONTEXT.md';
export const DOC_26J = 'docs/ai-platform/PHASE_26J_ARCHIVE_SUPERSESSION_GUARD.md';
export const DOC_27A = 'docs/ai-platform/PHASE_27A_OBSERVABILITY_OPERATIONAL_ENABLEMENT_ROADMAP.md';

export const CURRENT_STATUS_DOCS = [DOC_ACTIVE, DOC_ARCHIVE, DOC_OPERATOR, DOC_26J];

export class Phase26jArchiveSupersessionGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase26jArchiveSupersessionGuardError';
  }
}

export function readFile(repoRoot, relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Phase26jArchiveSupersessionGuardError(`missing required file: ${relativePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function assertMatch(content, pattern, message) {
  if (!pattern.test(content)) {
    throw new Phase26jArchiveSupersessionGuardError(message);
  }
}

function assertNotMatch(content, pattern, message) {
  if (pattern.test(content)) {
    throw new Phase26jArchiveSupersessionGuardError(message);
  }
}

export function validateHistoricalSnapshotBanner(doc26f) {
  assertMatch(
    doc26f,
    /Historical snapshot note/i,
    `${DOC_26F} must include Historical snapshot note`,
  );
  if (/Phase 26G:\s*NOT STARTED/i.test(doc26f)) {
    const bannerIdx = doc26f.search(/Historical snapshot note/i);
    const notStartedIdx = doc26f.search(/Phase 26G:\s*NOT STARTED/i);
    if (bannerIdx < 0 || bannerIdx > notStartedIdx) {
      throw new Phase26jArchiveSupersessionGuardError(
        `${DOC_26F}: Historical snapshot note must appear before Phase 26G: NOT STARTED`,
      );
    }
  }
}

export function validateArchivePrecedence(archive) {
  assertMatch(archive, /Archive precedence/i, `${DOC_ARCHIVE} must include Archive precedence`);
  assertMatch(archive, /Phase 26:\s*CLOSED PASS/i, `${DOC_ARCHIVE} must state Phase 26 CLOSED PASS`);
  assertMatch(
    archive,
    /Operational KPI row population remains disabled by default/i,
    `${DOC_ARCHIVE} must state operational KPI row population remains disabled by default`,
  );
}

export function validateOperatorHowToRead(operator) {
  assertMatch(
    operator,
    /How to read Phase 26 docs/i,
    `${DOC_OPERATOR} must include How to read Phase 26 docs`,
  );
}

export function validateActiveContext(active) {
  assertMatch(active, /Phase 26:\s*CLOSED PASS/i, `${DOC_ACTIVE} must state Phase 26 CLOSED PASS`);
  assertMatch(active, /Phase 26H/i, `${DOC_ACTIVE} must reference Phase 26H`);
  assertMatch(active, /Phase 26I/i, `${DOC_ACTIVE} must reference Phase 26I`);
  assertMatch(
    active,
    /PHASE_26_OBSERVABILITY_IMPLEMENTATION_ARCHIVE\.md/i,
    `${DOC_ACTIVE} must point at the Phase 26 archive as source of truth`,
  );
  assertMatch(
    active,
    /Operational KPI row population remains disabled by default/i,
    `${DOC_ACTIVE} must state operational KPI row population remains disabled by default`,
  );
  assertMatch(active, /Production default:\s*keyword/i, `${DOC_ACTIVE} must keep production default keyword`);
  assertMatch(active, /PERCENT=0/i, `${DOC_ACTIVE} must keep PERCENT=0`);
  assertMatch(active, /ALLOW_PROD_PERCENT=0/i, `${DOC_ACTIVE} must keep ALLOW_PROD_PERCENT=0`);
  assertMatch(
    active,
    /Hybrid\/vector production default:\s*NOT APPROVED/i,
    `${DOC_ACTIVE} must keep hybrid/vector production default NOT APPROVED`,
  );

  // Current next step must not still be Phase 26G.
  const nextBlockMatch = active.match(/Next allowed step:\s*\n([\s\S]*?)(?:\n\n|$)/i);
  const nextBlock = nextBlockMatch ? nextBlockMatch[1] : active;
  if (/Approved:\s*start Phase 26G/i.test(nextBlock)) {
    throw new Phase26jArchiveSupersessionGuardError(
      `${DOC_ACTIVE} must not treat Phase 26F next-step text (start Phase 26G) as current next allowed step`,
    );
  }
}

export function assertNoCurrentStateNotStarted(repoRoot) {
  for (const relativePath of CURRENT_STATUS_DOCS) {
    const content = readFile(repoRoot, relativePath);
    if (/Phase 26G:\s*NOT STARTED/i.test(content)) {
      throw new Phase26jArchiveSupersessionGuardError(
        `${relativePath} must not claim Phase 26G NOT STARTED as current state`,
      );
    }
  }
}

export function assertNoFalsePhase26Claims(repoRoot) {
  const docs = [DOC_ACTIVE, DOC_ARCHIVE, DOC_OPERATOR, DOC_26J, DOC_27A];
  const affirmativeEnabled = [
    /operational KPI row population is enabled by default/i,
    /operational KPI row population remains enabled by default/i,
    /KPI write paths default enabled:\s*YES/i,
    /Runtime writes enabled by default:\s*YES/i,
  ];

  for (const relativePath of docs) {
    const content = readFile(repoRoot, relativePath);
    for (const pattern of affirmativeEnabled) {
      for (const line of content.split('\n')) {
        if (!pattern.test(line)) continue;
        // Negated forbid-list wording is ok ("No doc says ... is enabled by default").
        if (/\b(no|not|must not|never)\b/i.test(line)) continue;
        throw new Phase26jArchiveSupersessionGuardError(
          `${relativePath} must not claim operational KPI / write paths are enabled by default`,
        );
      }
    }
  }

  const active = readFile(repoRoot, DOC_ACTIVE);
  const archive = readFile(repoRoot, DOC_ARCHIVE);
  const doc26j = readFile(repoRoot, DOC_26J);

  for (const [label, content] of [
    [DOC_ACTIVE, active],
    [DOC_ARCHIVE, archive],
    [DOC_26J, doc26j],
  ]) {
    assertMatch(
      content,
      /Live eval[\s\S]{0,12}NOT RUN/i,
      `${label} must preserve Live eval: NOT RUN`,
    );
    assertMatch(
      content,
      /Migrations applied[\s\S]{0,40}NO/i,
      `${label} must state Migrations applied: NO`,
    );
  }

  assertMatch(active, /PERCENT=0/, `${DOC_ACTIVE} must keep PERCENT=0`);
  assertMatch(active, /ALLOW_PROD_PERCENT=0/, `${DOC_ACTIVE} must keep ALLOW_PROD_PERCENT=0`);
  assertMatch(active, /Production default:\s*keyword/i, `${DOC_ACTIVE} must keep production default keyword`);
}

export function validatePhase26jCloseout(doc26j) {
  assertMatch(doc26j, /Phase 26J:\*?\*?\s*PASS/i, `${DOC_26J} must state Phase 26J PASS`);
  assertMatch(doc26j, /Phase 26:\*?\*?\s*CLOSED PASS/i, `${DOC_26J} must state Phase 26 CLOSED PASS`);
  assertMatch(doc26j, /Live eval:\*?\*?\s*NOT RUN/i, `${DOC_26J} must state Live eval NOT RUN`);
  assertMatch(
    doc26j,
    /Runtime\/env\/default\/allowlist changes:\*?\*?\s*NONE/i,
    `${DOC_26J} must state runtime/env/default/allowlist changes NONE`,
  );
  assertMatch(doc26j, /DB writes:\*?\*?\s*NO/i, `${DOC_26J} must state DB writes NO`);
  assertMatch(doc26j, /Migrations applied:\*?\*?\s*NO/i, `${DOC_26J} must state Migrations applied NO`);
  if (!doc26j.includes(EXPECTED_ARTIFACT_SHA)) {
    throw new Phase26jArchiveSupersessionGuardError(`${DOC_26J} must include locked artifact SHA`);
  }
}

export function validatePhase27aRoadmap(doc27a) {
  assertMatch(doc27a, /Phase 27A:.*PASS|Phase 27A.*design|Roadmap\/design/i, `${DOC_27A} must present Phase 27A design`);
  assertMatch(doc27a, /Phase 27 final end state/i, `${DOC_27A} must define Phase 27 final end state`);
  assertMatch(doc27a, /27H/i, `${DOC_27A} must include ticket 27H`);
  assertMatch(
    doc27a,
    /No production default switch|No production default/i,
    `${DOC_27A} must include production-default hard stops`,
  );
  assertMatch(
    doc27a,
    /Approved: start Phase 27B/i,
    `${DOC_27A} must include Phase 27B approval phrase`,
  );
  assertMatch(
    doc27a,
    /PERCENT|ALLOW_PROD_PERCENT/i,
    `${DOC_27A} must mention PERCENT / ALLOW_PROD_PERCENT hard stops`,
  );
}

export function validatePhase26jArchiveSupersession(repoRoot) {
  const doc26f = readFile(repoRoot, DOC_26F);
  const archive = readFile(repoRoot, DOC_ARCHIVE);
  const operator = readFile(repoRoot, DOC_OPERATOR);
  const active = readFile(repoRoot, DOC_ACTIVE);
  const doc26j = readFile(repoRoot, DOC_26J);
  const doc27a = readFile(repoRoot, DOC_27A);

  validateHistoricalSnapshotBanner(doc26f);
  validateArchivePrecedence(archive);
  validateOperatorHowToRead(operator);
  validateActiveContext(active);
  assertNoCurrentStateNotStarted(repoRoot);
  assertNoFalsePhase26Claims(repoRoot);
  validatePhase26jCloseout(doc26j);
  validatePhase27aRoadmap(doc27a);

  return {
    status: 'PASS',
    checks: [
      '26F historical snapshot banner',
      'archive precedence',
      'operator how-to-read',
      'ACTIVE_CONTEXT current state',
      'no current-state 26G NOT STARTED',
      'no false Phase 26 operational claims',
      '26J closeout posture',
      '27A roadmap present',
    ],
  };
}
