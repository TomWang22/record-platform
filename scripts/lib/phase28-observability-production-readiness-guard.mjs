/**
 * Phase 28A/28B — production-readiness doc and harness guards (read-only).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

export const PHASE_28A_DOC = path.join(
  REPO_ROOT,
  'docs/ai-platform/PHASE_28A_OBSERVABILITY_PRODUCTION_READINESS_TEST_ARCHITECTURE.md',
);
export const PHASE_28B_DOC = path.join(
  REPO_ROOT,
  'docs/ai-platform/PHASE_28B_OBSERVABILITY_DURABILITY_HARNESS_AND_GUARDS.md',
);
export const ACTIVE_CONTEXT = path.join(REPO_ROOT, 'docs/ai-platform/ACTIVE_CONTEXT.md');
export const PHASE_21_CONTEXT = path.join(REPO_ROOT, 'docs/ai-platform/PHASE_21_COPILOT_CONTEXT.md');

const HARNESS_LIB = path.join(REPO_ROOT, 'scripts/lib/phase28-observability-durability-harness.mjs');
const HARNESS_READONLY = path.join(
  REPO_ROOT,
  'scripts/phase28-observability-durability-harness-readonly.mjs',
);

const BANNED_HARNESS_PATTERNS = [
  /\bcurl\b/i,
  /\bkubectl\b/i,
  /\/api\/ai\/rag\/query/i,
  /\/api\/auth\/login/i,
];

const FORBIDDEN_PRODUCTION_CLAIMS = [
  /production\s+rollout\s+approved/i,
  /live\s+eval\s+run:\s*YES/i,
  /production\s+DB\s+migration:\s*RUN/i,
  /production\s+KPI\s+writes?\s+enabled\s+by\s+default/i,
  /28D.*real\s+inference\s+ran/i,
  /28E.*real\s+inference\s+ran/i,
  /7200\/7200\s+full\s+parity/i,
  /171315\/171315\s+unlabeled\s+cumulative/i,
];

export class Phase28ProductionReadinessGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase28ProductionReadinessGuardError';
  }
}

function readFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Phase28ProductionReadinessGuardError(`missing required file: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function assertMatch(text, pattern, label) {
  if (!pattern.test(text)) {
    throw new Phase28ProductionReadinessGuardError(`guard failed: ${label}`);
  }
}

function assertNoMatchUnlessNegated(text, pattern, label) {
  for (const line of text.split('\n')) {
    if (!pattern.test(line)) continue;
    if (/\b(no|not|never|must not|does not|fail if|forbidden|deny|claims)\b/i.test(line)) continue;
    if (/NOT APPROVED|NOT RUN/i.test(line)) continue;
    throw new Phase28ProductionReadinessGuardError(`guard failed: ${label} — ${line.trim()}`);
  }
}

function assertNoMatch(text, pattern, label) {
  assertNoMatchUnlessNegated(text, pattern, label);
}

function scanRepoForCommittedReports() {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (
        entry.name.includes('phase25_combined_ai_platform_kpi_report') &&
        !full.startsWith('/tmp') &&
        !full.includes(`${path.sep}tmp${path.sep}`)
      ) {
        offenders.push(full);
      }
    }
  };
  walk(REPO_ROOT);
  if (offenders.length) {
    throw new Phase28ProductionReadinessGuardError(
      `generated KPI report committed or staged in repo: ${offenders.join(', ')}`,
    );
  }
}

export function validatePhase28Docs() {
  const doc28a = readFile(PHASE_28A_DOC);
  const doc28b = readFile(PHASE_28B_DOC);
  const active = readFile(ACTIVE_CONTEXT);
  const phase21 = readFile(PHASE_21_CONTEXT);

  assertMatch(doc28a, /Phase 28A/i, '28A doc must exist and name Phase 28A');
  assertMatch(doc28a, /28B/i, '28A doc must reference 28B');
  assertMatch(doc28a, /28H/i, '28A doc must define 28A–28H ticket plan');
  assertMatch(doc28a, /hard stop/i, '28A doc must define hard stops');
  assertMatch(doc28a, /real-inference readiness/i, '28A doc must define real-inference gates');
  assertMatch(doc28a, /pipeline durability/i, '28A doc must define pipeline durability gates');
  assertMatch(doc28a, /H1\/H2\/H3/i, '28A doc must define H1/H2/H3 gates');
  assertMatch(doc28a, /redaction/i, '28A doc must define redaction gates');
  assertMatch(doc28a, /disable-switch/i, '28A doc must define disable-switch gates');
  assertMatch(doc28a, /report correctness/i, '28A doc must define report correctness gates');
  assertMatch(doc28a, /Approved: start Phase 28C/i, '28A doc must include future 28C approval phrase');

  assertMatch(doc28b, /Phase 28B/i, '28B doc must exist');
  assertMatch(doc28b, /durability harness/i, '28B doc must describe durability harness');
  assertMatch(doc28b, /fixtures only/i, '28B doc must state fixtures only');

  assertMatch(active, /Phase 28A/i, 'ACTIVE_CONTEXT must mention Phase 28A');
  assertMatch(active, /Phase 28B/i, 'ACTIVE_CONTEXT must mention Phase 28B');
  assertMatch(phase21, /Phase 28/i, 'PHASE_21_COPILOT_CONTEXT must mention Phase 28');

  for (const text of [doc28a, doc28b, active, phase21]) {
    for (const pattern of FORBIDDEN_PRODUCTION_CLAIMS) {
      assertNoMatch(text, pattern, `forbidden production claim: ${pattern}`);
    }
  }

  assertMatch(doc28a, /Live eval run:\s*NOT RUN/i, '28A must state live eval NOT RUN for 28A/28B');
  assertMatch(doc28b, /DB writes:\s*NO/i, '28B must state DB writes NO');

  return { status: 'PASS' };
}

export function validateHarnessCodeSafety() {
  const content = readFile(HARNESS_LIB);
  const readonlyContent = readFile(HARNESS_READONLY);
  for (const pattern of BANNED_HARNESS_PATTERNS) {
    assertNoMatch(content, pattern, `harness contains banned pattern ${pattern} in ${HARNESS_LIB}`);
    assertNoMatch(readonlyContent, pattern, `harness contains banned pattern ${pattern} in ${HARNESS_READONLY}`);
  }
  if (!content.includes('/tmp')) {
    throw new Phase28ProductionReadinessGuardError('harness must default report output to /tmp');
  }
  return { status: 'PASS' };
}

export function validatePhase28ProductionReadinessGuard() {
  validatePhase28Docs();
  validateHarnessCodeSafety();
  scanRepoForCommittedReports();
  return { status: 'PASS' };
}
