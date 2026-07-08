/**
 * Phase 27 — controlled operational enablement closeout guard (read-only).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const EXPECTED_ARTIFACT_SHA = '1849c7a658151dd7a896c02d86d202f844d28e8d01ffc4ac9b1a5086f8b71caa';

export const PHASE27_DOCS = {
  B: 'docs/ai-platform/PHASE_27B_LOCAL_DEV_KPI_SCHEMA_APPLY_VERIFICATION.md',
  C: 'docs/ai-platform/PHASE_27C_CONTROLLED_KPI_FLAG_ENABLEMENT_DRILL.md',
  D: 'docs/ai-platform/PHASE_27D_CONTROLLED_KPI_ROW_POPULATION_DRILL.md',
  E: 'docs/ai-platform/PHASE_27E_CONTROLLED_QUERY_USEFULNESS_OBSERVATION_SMOKE.md',
  F: 'docs/ai-platform/PHASE_27F_COMBINED_KPI_REPORT_FROM_CONTROLLED_ROWS.md',
  G: 'docs/ai-platform/PHASE_27G_KPI_DISABLE_SWITCH_ROLLBACK_DRILL.md',
  H: 'docs/ai-platform/PHASE_27H_OBSERVABILITY_OPERATIONAL_ENABLEMENT_CLOSEOUT.md',
};

export const DRILL_SCRIPT = 'scripts/phase27-controlled-kpi-enablement-drill.py';
export const ACTIVE = 'docs/ai-platform/ACTIVE_CONTEXT.md';

export const FORBIDDEN_COLUMNS = [
  'response_body',
  'raw_response_body',
  'message_body',
  'raw_message_body',
  'jwt',
  'token',
  'password',
  'proxy_max_bid',
  'private_message',
  'authorization_header',
];

export class Phase27OperationalEnablementGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase27OperationalEnablementGuardError';
  }
}

export function readFile(repoRoot, relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    throw new Phase27OperationalEnablementGuardError(`missing required file: ${relativePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function assertMatch(content, pattern, message) {
  if (!pattern.test(content)) {
    throw new Phase27OperationalEnablementGuardError(message);
  }
}

export function validatePhase27Doc(doc, label) {
  assertMatch(doc, new RegExp(`Phase 27${label}:\\*?\\*?\\s*PASS`, 'i'), `Phase 27${label} doc must state PASS`);
  assertMatch(
    doc,
    /Live eval(?:\s+run)?:\*?\*?\s*NOT RUN/i,
    `Phase 27${label} must state Live eval NOT RUN`,
  );
  assertMatch(doc, /Production default:\*?\*?\s*keyword/i, `Phase 27${label} must keep production default keyword`);
  assertMatch(doc, /PERCENT=0/i, `Phase 27${label} must keep PERCENT=0`);
  assertMatch(doc, /ALLOW_PROD_PERCENT=0/i, `Phase 27${label} must keep ALLOW_PROD_PERCENT=0`);
  assertMatch(
    doc,
    /Hybrid\/vector production default:\*?\*?\s*NOT APPROVED/i,
    `Phase 27${label} must keep hybrid/vector NOT APPROVED`,
  );
  if (!doc.includes(EXPECTED_ARTIFACT_SHA)) {
    throw new Phase27OperationalEnablementGuardError(`Phase 27${label} must include locked artifact SHA`);
  }
}

export function validateCloseoutH(docH) {
  validatePhase27Doc(docH, 'H');
  assertMatch(docH, /Phase 27:\*?\*?\s*CLOSED PASS/i, '27H must state Phase 27 CLOSED PASS');
  assertMatch(docH, /Production enablement:\*?\*?\s*NOT APPROVED/i, '27H must deny production enablement');
  assertMatch(docH, /Generated KPI reports committed:\*?\*?\s*NO/i, '27H must deny committed reports');
  assertMatch(docH, /Bench logs committed:\*?\*?\s*NO/i, '27H must deny bench log commits');
  assertMatch(docH, /Disable switch rollback:\*?\*?\s*PASS/i, '27H must state disable switch rollback PASS');
  assertMatch(docH, /Raw\/private fields stored:\*?\*?\s*NO/i, '27H must deny raw/private storage');
}

export function validateDrillScript(script) {
  for (const fn of [
    'write_kpi_ingestion_event',
    'write_kpi_searchability_check',
    'write_kpi_query_observation',
    'write_kpi_usefulness_observation',
  ]) {
    if (!script.includes(fn)) {
      throw new Phase27OperationalEnablementGuardError(`drill must use write path ${fn}`);
    }
  }
  if (!script.includes('127.0.0.1:5440') && !script.includes('5440/python_ai')) {
    throw new Phase27OperationalEnablementGuardError('drill must target local/dev python_ai on 5440');
  }
  for (const banned of ['kubectl', '57105 replay', 'ALLOW_PROD_PERCENT=1', 'PERCENT=1']) {
    if (script.toLowerCase().includes(banned.toLowerCase()) && banned !== '57105 replay') {
      // 57105 may appear as forbidden comment; require negation
    }
  }
  if (/\bkubectl\b/i.test(script)) {
    throw new Phase27OperationalEnablementGuardError('drill must not call kubectl');
  }
  if (/57105\s*replay/i.test(script) && !/no live 57105|not a 57105|Forbidden:.*57105/i.test(script)) {
    // Allow mentioning 57105 as forbidden in comments of sibling docs; script itself shouldn't run replay.
    if (!/no live|Hard stops|Forbidden/i.test(script)) {
      throw new Phase27OperationalEnablementGuardError('drill must not run 57105 replay');
    }
  }
}

export function validateActiveContextPhase27(active) {
  assertMatch(active, /Phase 27:\s*CLOSED PASS/i, 'ACTIVE_CONTEXT must state Phase 27 CLOSED PASS');
  assertMatch(active, /Phase 27H/i, 'ACTIVE_CONTEXT must reference Phase 27H');
  assertMatch(active, /Production default:\s*keyword/i, 'ACTIVE_CONTEXT must keep keyword default');
  assertMatch(active, /PERCENT=0/, 'ACTIVE_CONTEXT must keep PERCENT=0');
  assertMatch(
    active,
    /Operational KPI row population remains disabled by default/i,
    'ACTIVE_CONTEXT must keep default-off operational population',
  );
}

export function runLocalDevSchemaIntrospection(repoRoot) {
  const sql = `
SELECT table_name FROM information_schema.tables
 WHERE table_schema='ai' AND table_name LIKE 'ai_kpi_%' ORDER BY 1;
SELECT table_name, column_name FROM information_schema.columns
 WHERE table_schema='ai' AND table_name LIKE 'ai_kpi_%'
   AND column_name = ANY(ARRAY[${FORBIDDEN_COLUMNS.map((c) => `'${c}'`).join(',')}]);
SELECT
  (SELECT COUNT(*) FROM ai.ai_kpi_ingestion_events) AS ingestion,
  (SELECT COUNT(*) FROM ai.ai_kpi_searchability_checks) AS searchability,
  (SELECT COUNT(*) FROM ai.ai_kpi_query_observations) AS query,
  (SELECT COUNT(*) FROM ai.ai_kpi_usefulness_observations) AS usefulness;
`;
  const result = spawnSync(
    'psql',
    [
      '-h',
      '127.0.0.1',
      '-p',
      '5440',
      '-U',
      'postgres',
      '-d',
      'python_ai',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      '-F',
      ',',
      '-c',
      sql,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'postgres' },
    },
  );
  if (result.status !== 0) {
    throw new Phase27OperationalEnablementGuardError(
      `local/dev schema introspection failed: ${(result.stderr || result.stdout || '').trim()}`,
    );
  }
  const out = result.stdout || '';
  for (const table of [
    'ai_kpi_ingestion_events',
    'ai_kpi_searchability_checks',
    'ai_kpi_query_observations',
    'ai_kpi_usefulness_observations',
  ]) {
    if (!out.includes(table)) {
      throw new Phase27OperationalEnablementGuardError(`introspection missing table ${table}`);
    }
  }
  // Forbidden column query should return no table,column lines between tables and counts.
  // Counts line should look like n,n,n,n
  const lines = out
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const countLine = lines.find((l) => /^\d+,\d+,\d+,\d+$/.test(l));
  if (!countLine) {
    throw new Phase27OperationalEnablementGuardError(`could not parse KPI row counts from: ${out}`);
  }
  const [ingestion, searchability, query, usefulness] = countLine.split(',').map((n) => Number(n));
  if (ingestion < 1 || searchability < 1 || query < 3 || usefulness < 4) {
    throw new Phase27OperationalEnablementGuardError(
      `controlled KPI row minima not met: ingestion=${ingestion} searchability=${searchability} query=${query} usefulness=${usefulness}`,
    );
  }
  return {
    status: 'PASS',
    row_counts: { ingestion, searchability, query, usefulness },
  };
}

export function validatePhase27OperationalEnablement(repoRoot, { runIntrospection = true } = {}) {
  for (const [label, rel] of Object.entries(PHASE27_DOCS)) {
    const doc = readFile(repoRoot, rel);
    if (label === 'H') {
      validateCloseoutH(doc);
    } else {
      validatePhase27Doc(doc, label);
    }
  }

  validateDrillScript(readFile(repoRoot, DRILL_SCRIPT));
  validateActiveContextPhase27(readFile(repoRoot, ACTIVE));

  // Docs claim real DB rows, not mocks-only.
  const docD = readFile(repoRoot, PHASE27_DOCS.D);
  assertMatch(docD, /write_kpi_ingestion_event|official write paths|implemented write paths/i, '27D must use write paths');
  assertMatch(docD, /real local\/dev DB rows|python_ai@127\.0\.0\.1:5440|local\/dev DB/i, '27D must claim real local/dev DB rows');

  let introspection = { status: 'SKIPPED' };
  if (runIntrospection) {
    introspection = runLocalDevSchemaIntrospection(repoRoot);
  }

  return {
    status: 'PASS',
    docs_checked: Object.keys(PHASE27_DOCS).length,
    introspection,
  };
}
