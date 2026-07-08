/**
 * Phase 27I — operational enablement archive/explainer guard (read-only).
 */
import fs from 'node:fs';
import path from 'node:path';

export const EXPECTED_ARTIFACT_SHA = '1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa';

export const DOC_ARCHIVE = 'docs/ai-platform/PHASE_27_OBSERVABILITY_OPERATIONAL_ENABLEMENT_ARCHIVE.md';
export const DOC_OPERATOR = 'docs/ai-platform/PHASE_27_OBSERVABILITY_OPERATOR_GUIDE.md';
export const DOC_CODE_MAP = 'docs/ai-platform/PHASE_27_OBSERVABILITY_CODE_MAP.md';
export const DOC_27I = 'docs/ai-platform/PHASE_27I_OPERATIONAL_ENABLEMENT_ARCHIVE_EXPLAINER.md';
export const DOC_ACTIVE = 'docs/ai-platform/ACTIVE_CONTEXT.md';

export const CURRENT_STATUS_DOCS = [DOC_ARCHIVE, DOC_OPERATOR, DOC_CODE_MAP, DOC_27I, DOC_ACTIVE];

export class Phase27ArchiveGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase27ArchiveGuardError';
  }
}

export function readFile(repoRoot, relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Phase27ArchiveGuardError(`missing required file: ${relativePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function assertMatch(content, pattern, message) {
  if (!pattern.test(content)) {
    throw new Phase27ArchiveGuardError(message);
  }
}

function assertNotAffirmativeProductionEnablement(content, relativePath) {
  for (const line of content.split('\n')) {
    const affirmative =
      /production KPI writes? (are )?enabled by default/i.test(line) ||
      /production rollout (is )?approved/i.test(line) ||
      /production enablement:\*?\*?\s*APPROVED/i.test(line) ||
      /live 57105 replay (occurred|PASS|RUN)/i.test(line);
    if (!affirmative) continue;
    if (/\b(no|not|never|must not)\b/i.test(line)) continue;
    if (/NOT APPROVED|NOT RUN/i.test(line)) continue;
    throw new Phase27ArchiveGuardError(
      `${relativePath} must not claim production enablement / KPI writes by default / live 57105 replay: ${line.trim()}`,
    );
  }
}

export function validateArchiveDoc(archive) {
  assertMatch(archive, /Phase 27:\*?\*?\s*CLOSED PASS/i, `${DOC_ARCHIVE} must state Phase 27 CLOSED PASS`);
  assertMatch(
    archive,
    /Production DB migration:\*?\*?\s*NOT RUN/i,
    `${DOC_ARCHIVE} must state production DB migration NOT RUN`,
  );
  assertMatch(
    archive,
    /Production enablement:\*?\*?\s*NOT APPROVED/i,
    `${DOC_ARCHIVE} must state production enablement NOT APPROVED`,
  );
  assertMatch(archive, /Live eval:\*?\*?\s*NOT RUN/i, `${DOC_ARCHIVE} must state Live eval NOT RUN`);
  assertMatch(
    archive,
    /local\/dev synthetic/i,
    `${DOC_ARCHIVE} must state DB writes were local/dev synthetic only`,
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
  assertMatch(archive, /Phase 27I:\s*PASS/i, `${DOC_ARCHIVE} must include Phase 27I PASS in ledger`);
  assertMatch(archive, /ingestion=1/i, `${DOC_ARCHIVE} must document ingestion=1`);
  assertMatch(archive, /searchability=1/i, `${DOC_ARCHIVE} must document searchability=1`);
  assertMatch(archive, /query=3/i, `${DOC_ARCHIVE} must document query=3`);
  assertMatch(archive, /usefulness=4/i, `${DOC_ARCHIVE} must document usefulness=4`);
  if (!archive.includes(EXPECTED_ARTIFACT_SHA)) {
    throw new Phase27ArchiveGuardError(`${DOC_ARCHIVE} must include locked artifact SHA`);
  }
}

export function validateOperatorGuide(operator) {
  assertMatch(
    operator,
    /make ai-platform-verify-phase27-operational-enablement/,
    `${DOC_OPERATOR} must include primary verify command`,
  );
  assertMatch(operator, /ingestion=1/, `${DOC_OPERATOR} must explain ingestion=1`);
  assertMatch(
    operator,
    /do not mean production KPI observability is enabled/i,
    `${DOC_OPERATOR} must clarify row counts are not production enablement`,
  );
}

export function validateCodeMap(codeMap) {
  for (const required of [
    'infra/db/48-ai-kpi-observability.sql',
    'services/python-ai-service/app/ai/kpi_observability.py',
    'services/python-ai-service/app/ai/kpi_ingestion_events.py',
    'services/python-ai-service/app/ai/kpi_searchability_checks.py',
    'services/python-ai-service/app/ai/kpi_query_observations.py',
    'services/python-ai-service/app/ai/kpi_usefulness_observations.py',
    'scripts/phase27-controlled-kpi-enablement-drill.py',
    'scripts/lib/phase27-operational-enablement-guard.mjs',
    'scripts/phase27-operational-enablement-guard-readonly.mjs',
    'tests/phase27-operational-enablement-guard.test.mjs',
  ]) {
    if (!codeMap.includes(required)) {
      throw new Phase27ArchiveGuardError(`${DOC_CODE_MAP} must list ${required}`);
    }
  }
}

export function validate27iDoc(doc27i) {
  assertMatch(doc27i, /Phase 27I:\*?\*?\s*PASS/i, `${DOC_27I} must state Phase 27I PASS`);
  assertMatch(doc27i, /Phase 27:\*?\*?\s*CLOSED PASS/i, `${DOC_27I} must state Phase 27 CLOSED PASS`);
  assertMatch(doc27i, /Live eval:\*?\*?\s*NOT RUN/i, `${DOC_27I} must state Live eval NOT RUN`);
  assertMatch(
    doc27i,
    /Production enablement:\*?\*?\s*NOT APPROVED/i,
    `${DOC_27I} must deny production enablement`,
  );
  assertMatch(
    doc27i,
    /Approved: start Phase 28A/i,
    `${DOC_27I} next step must point at Phase 28A design only`,
  );
  if (!doc27i.includes(EXPECTED_ARTIFACT_SHA)) {
    throw new Phase27ArchiveGuardError(`${DOC_27I} must include locked artifact SHA`);
  }
}

export function validateActiveContext(active) {
  assertMatch(active, /Phase 27:\s*CLOSED PASS/i, `${DOC_ACTIVE} must state Phase 27 CLOSED PASS`);
  assertMatch(active, /Phase 27I/i, `${DOC_ACTIVE} must reference Phase 27I`);
  assertMatch(
    active,
    /PHASE_27_OBSERVABILITY_OPERATIONAL_ENABLEMENT_ARCHIVE\.md/,
    `${DOC_ACTIVE} must point at Phase 27 archive`,
  );
  assertMatch(
    active,
    /Operational KPI row population remains disabled by default/i,
    `${DOC_ACTIVE} must keep operational population disabled by default`,
  );
  assertMatch(active, /Production default:\s*keyword/i, `${DOC_ACTIVE} must keep keyword default`);
  assertMatch(active, /PERCENT=0/, `${DOC_ACTIVE} must keep PERCENT=0`);
  assertMatch(active, /ALLOW_PROD_PERCENT=0/, `${DOC_ACTIVE} must keep ALLOW_PROD_PERCENT=0`);

  const nextBlockMatch = active.match(/Next allowed step:\s*\n([\s\S]*?)(?:\n\n|$)/i);
  const nextBlock = nextBlockMatch ? nextBlockMatch[1] : active;
  assertMatch(
    nextBlock,
    /Phase 28A|production-readiness design only/i,
    `${DOC_ACTIVE} next step must be Phase 28A design only unless explicit owner approval`,
  );
  if (/Approved:\s*start Phase 27[B-H]/i.test(nextBlock)) {
    throw new Phase27ArchiveGuardError(
      `${DOC_ACTIVE} must not still propose Phase 27B–27H as next allowed step`,
    );
  }
}

export function validatePhase27Archive(repoRoot) {
  const archive = readFile(repoRoot, DOC_ARCHIVE);
  const operator = readFile(repoRoot, DOC_OPERATOR);
  const codeMap = readFile(repoRoot, DOC_CODE_MAP);
  const doc27i = readFile(repoRoot, DOC_27I);
  const active = readFile(repoRoot, DOC_ACTIVE);

  validateArchiveDoc(archive);
  validateOperatorGuide(operator);
  validateCodeMap(codeMap);
  validate27iDoc(doc27i);
  validateActiveContext(active);

  for (const relativePath of CURRENT_STATUS_DOCS) {
    assertNotAffirmativeProductionEnablement(readFile(repoRoot, relativePath), relativePath);
  }

  return {
    status: 'PASS',
    docs_checked: CURRENT_STATUS_DOCS.length,
  };
}
