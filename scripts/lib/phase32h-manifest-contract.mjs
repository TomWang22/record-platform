/**
 * Phase 32H — manifest row contract validation before live probes.
 */
import { createHash } from 'node:crypto';
import { PROMPTS, PROTOCOLS } from './phase22-full-replay-common.mjs';
import { protocolLabel } from './phase31-controlled-matrix-summary.mjs';
import { matrixCoordinateKey } from './phase32h-run-integrity.mjs';

const PROMPT_BY_CASE = new Map(PROMPTS);
const INVALID_QUESTION_LITERALS = new Set(['undefined', 'null', '[object Object]']);
const REQUIRED_PROTOCOLS = ['h1', 'h2', 'h3'];

export const REQUEST_CONTRACT_BLOCKED = 'PHASE32H_REQUEST_CONTRACT_BLOCKED';

export function validateQuestionField(question, caseId, { allowOverride = false } = {}) {
  const violations = [];
  if (typeof question !== 'string') {
    violations.push({ field: 'question', reason: 'not_string', question_type: typeof question });
    return violations;
  }
  const trimmed = question.trim();
  if (trimmed.length < 2) {
    violations.push({ field: 'question', reason: 'too_short', question_length: trimmed.length });
  }
  if (INVALID_QUESTION_LITERALS.has(trimmed)) {
    violations.push({ field: 'question', reason: 'invalid_literal', question_length: trimmed.length });
  }
  if (!PROMPT_BY_CASE.has(caseId)) {
    violations.push({ field: 'case_id', reason: 'unknown_case', case_id: caseId });
  } else if (!allowOverride && PROMPT_BY_CASE.get(caseId) !== question) {
    violations.push({ field: 'question', reason: 'prompt_mismatch', case_id: caseId });
  }
  return violations;
}

export function validateManifestRow(row, context = {}) {
  const violations = [];
  const required = [
    'probe_id',
    'matrix_protocol',
    'protocol_label',
    'window',
    'run',
    'case_id',
    'user_class',
    'user_uid',
    'question',
    'expected_gate_reason',
    'evidence_label',
  ];
  for (const field of required) {
    if (row[field] === undefined || row[field] === null || row[field] === '') {
      violations.push({ probe_id: row.probe_id ?? null, field, reason: 'missing' });
    }
  }
  if (!PROTOCOLS[row.matrix_protocol]) {
    violations.push({ probe_id: row.probe_id, field: 'matrix_protocol', reason: 'unknown_protocol' });
  }
  if (row.protocol_label && row.matrix_protocol) {
    const expected = protocolLabel(PROTOCOLS[row.matrix_protocol]?.expected);
    if (expected && row.protocol_label !== expected) {
      violations.push({ probe_id: row.probe_id, field: 'protocol_label', reason: 'protocol_mismatch' });
    }
  }
  violations.push(...validateQuestionField(row.question, row.case_id, context));
  if (context.evidenceLabel && row.evidence_label !== context.evidenceLabel) {
    violations.push({ probe_id: row.probe_id, field: 'evidence_label', reason: 'mismatch' });
  }
  if (context.launchHead && row.launch_head && row.launch_head !== context.launchHead) {
    violations.push({ probe_id: row.probe_id, field: 'launch_head', reason: 'mismatch' });
  }
  if (context.runId && row.run_id && row.run_id !== context.runId) {
    violations.push({ probe_id: row.probe_id, field: 'run_id', reason: 'mismatch' });
  }
  return violations;
}

export function validateManifestContract(rows, context = {}) {
  const invalidRows = [];
  const missingFields = [];
  const unknownCases = new Set();
  const probeIds = new Set();
  const coordinates = new Set();
  let questionsValid = 0;
  let duplicateProbeIds = 0;
  let duplicateCoordinates = 0;

  for (const row of rows) {
    const rowViolations = validateManifestRow(row, context);
    if (rowViolations.some((v) => v.field === 'case_id' && v.reason === 'unknown_case')) {
      unknownCases.add(row.case_id);
    }
    for (const v of rowViolations) {
      if (v.reason === 'missing') missingFields.push({ probe_id: row.probe_id, field: v.field });
    }
    if (rowViolations.length === 0) questionsValid += 1;
    else invalidRows.push({ probe_id: row.probe_id, violations: rowViolations });

    if (probeIds.has(row.probe_id)) duplicateProbeIds += 1;
    probeIds.add(row.probe_id);

    const coord = matrixCoordinateKey({
      matrix_protocol: row.matrix_protocol,
      window: row.window,
      user_class: row.user_class,
      user_uid: row.user_uid,
      run: row.run,
      case_id: row.case_id,
    });
    if (coordinates.has(coord)) duplicateCoordinates += 1;
    coordinates.add(coord);
  }

  const perProtocol = {};
  for (const proto of REQUIRED_PROTOCOLS) {
    perProtocol[proto] = rows.filter((r) => r.matrix_protocol === proto).length;
  }

  const violations = [];
  if (context.expectedTotal != null && rows.length !== context.expectedTotal) {
    violations.push({ reason: 'wrong_total', expected: context.expectedTotal, actual: rows.length });
  }
  if (context.expectedPerProtocol != null) {
    for (const proto of REQUIRED_PROTOCOLS) {
      if (perProtocol[proto] !== context.expectedPerProtocol) {
        violations.push({
          reason: 'wrong_protocol_count',
          protocol: proto,
          expected: context.expectedPerProtocol,
          actual: perProtocol[proto],
        });
      }
    }
  }
  if (duplicateProbeIds > 0) violations.push({ reason: 'duplicate_probe_ids', count: duplicateProbeIds });
  if (duplicateCoordinates > 0) violations.push({ reason: 'duplicate_coordinates', count: duplicateCoordinates });
  if (invalidRows.length > 0) violations.push({ reason: 'invalid_rows', count: invalidRows.length });

  const status =
    violations.length === 0 && invalidRows.length === 0 && questionsValid === rows.length ? 'PASS' : 'BLOCKED';

  return {
    status,
    rows: rows.length,
    questions_valid: questionsValid,
    duplicate_probe_ids: duplicateProbeIds,
    duplicate_coordinates: duplicateCoordinates,
    unknown_cases: [...unknownCases],
    missing_fields: missingFields,
    invalid_rows: invalidRows,
    per_protocol: perProtocol,
    violations,
  };
}

export function assertManifestContract(rows, context = {}) {
  const report = validateManifestContract(rows, context);
  if (report.status !== 'PASS') {
    const err = new Error(`manifest contract BLOCKED: ${JSON.stringify(report)}`);
    err.code = 'PHASE32H_MANIFEST_CONTRACT_BLOCKED';
    err.report = report;
    throw err;
  }
  return report;
}

export function assertRequestContractBeforeNetwork(probe, context = {}) {
  const violations = validateManifestRow(probe, context);
  const question = probe?.question;
  const payload = {
    code: REQUEST_CONTRACT_BLOCKED,
    probe_id: probe?.probe_id ?? null,
    case_id: probe?.case_id ?? null,
    protocol: probe?.matrix_protocol ?? null,
    question_present: question != null && question !== '',
    question_type: typeof question,
    question_length: typeof question === 'string' ? question.trim().length : 0,
    manifest_sha: context.manifestSha ?? null,
    launch_sha: context.launchHead ?? null,
    run_id: context.runId ?? null,
  };
  if (violations.length > 0) {
    const err = new Error(`${REQUEST_CONTRACT_BLOCKED}: ${JSON.stringify({ ...payload, violations })}`);
    err.code = REQUEST_CONTRACT_BLOCKED;
    err.payload = payload;
    err.violations = violations;
    throw err;
  }
  return payload;
}

export function requestBodyFingerprint(question, userId) {
  const body = { question, user_id: userId };
  const canonical = JSON.stringify(body);
  return {
    schema_hash: createHash('sha256').update(canonical).digest('hex'),
    body_field_names: Object.keys(body).sort(),
    body_byte_length: Buffer.byteLength(canonical, 'utf8'),
  };
}
