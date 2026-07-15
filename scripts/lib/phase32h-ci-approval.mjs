/**
 * Phase 32H-R1 — exact-SHA CI approval gate before baseline evidence root creation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const CI_APPROVAL_DIR = '/tmp/phase32h-prelaunch-approvals';

/** Always required for product/infra approval on main pushes. */
export const CORE_REQUIRED_WORKFLOW_NAMES = [
  'ci',
  'docker-build',
  'Protocol validation (static + fixtures)',
  'RP Namespace Lint',
];

/** Required jobs within the `ci` workflow (not standalone workflows). */
export const CORE_REQUIRED_CI_JOB_NAMES = ['Git no-Cursor trailer guard'];

/** Required only when a run exists for the exact SHA (path-triggered). */
export const CONDITIONAL_REQUIRED_WORKFLOW_NAMES = [
  'coverage',
  'Kafka alignment',
  'Kafka cluster verify (static)',
  'kafka-dns-validate',
];

/** Back-compat alias used by older tests. */
export const REQUIRED_WORKFLOW_NAMES = CORE_REQUIRED_WORKFLOW_NAMES;

export const COVERAGE_PATH_PREFIXES = [
  'services/',
  'scripts/coverage/',
  '.github/workflows/coverage.yml',
];

export const BLOCKING_STATUSES = new Set([
  'queued',
  'in_progress',
  'pending',
  'waiting',
  'requested',
  'stale',
  'action_required',
  'startup_failure',
]);

export const BLOCKING_CONCLUSIONS = new Set([
  'failure',
  'cancelled',
  'timed_out',
  'action_required',
  'startup_failure',
  'stale',
]);

export function approvalPathForSha(sha) {
  return path.join(CI_APPROVAL_DIR, `${sha}.json`);
}

export function normalizeWorkflowRun(run) {
  return {
    name: run.name || run.workflowName,
    workflow_file: run.workflowFile || run.workflow_file || null,
    run_id: Number(run.databaseId || run.run_id || run.id || 0),
    status: run.status,
    conclusion: run.conclusion ?? null,
    head_sha: run.headSha || run.head_sha || null,
    event: run.event || null,
  };
}

export function commitTouchesCoveragePaths(changedFiles = []) {
  return changedFiles.some((file) =>
    COVERAGE_PATH_PREFIXES.some((prefix) => file.startsWith(prefix) || file === prefix),
  );
}

export function classifyWorkflowRequirement(name, { changedFiles = [], discoveredRuns = [] } = {}) {
  if (CORE_REQUIRED_WORKFLOW_NAMES.includes(name)) {
    return { required_status: 'required', path_filter_classification: 'core_required' };
  }
  const run = discoveredRuns.find((r) => r.name === name);
  if (run) {
    return { required_status: 'required', path_filter_classification: 'triggered' };
  }
  if (name === 'coverage' && commitTouchesCoveragePaths(changedFiles)) {
    return {
      required_status: 'required',
      path_filter_classification: 'unexpectedly_missing',
    };
  }
  if (CONDITIONAL_REQUIRED_WORKFLOW_NAMES.includes(name)) {
    return { required_status: 'optional', path_filter_classification: 'not_triggered' };
  }
  return { required_status: 'optional', path_filter_classification: 'optional' };
}

export function evaluateWorkflowRow(row) {
  const violations = [];
  if (!row) {
    return { ok: false, violations: ['missing row'] };
  }
  if (row.required_status !== 'required') {
    return { ok: true, violations: [] };
  }
  const isCiJob = row.path_filter_classification === 'ci_job';
  if (!isCiJob && !row.run_id) {
    violations.push(`missing required workflow run: ${row.name}`);
    return { ok: false, violations };
  }
  if (row.status === 'missing') {
    violations.push(
      isCiJob ? `missing required CI job: ${row.name}` : `missing required workflow run: ${row.name}`,
    );
    return { ok: false, violations };
  }
  if (row.status !== 'completed') {
    violations.push(
      `${isCiJob ? 'CI job' : 'workflow'} not completed: ${row.name} (${row.status})`,
    );
  }
  if (BLOCKING_CONCLUSIONS.has(row.conclusion)) {
    violations.push(
      `${isCiJob ? 'CI job' : 'workflow'} not success: ${row.name} (${row.conclusion})`,
    );
  } else if (row.conclusion !== 'success') {
    violations.push(
      `${isCiJob ? 'CI job' : 'workflow'} not success: ${row.name} (${row.conclusion ?? 'null'})`,
    );
  }
  if (row.path_filter_classification === 'unexpectedly_missing') {
    violations.push(`triggered workflow missing from approval input: ${row.name}`);
  }
  return { ok: violations.length === 0, violations };
}

export function buildWorkflowApprovalRows(discoveredRuns, { changedFiles = [] } = {}) {
  const byName = new Map();
  for (const run of discoveredRuns) {
    if (!run?.name) continue;
    // Keep latest run id per workflow name.
    const prev = byName.get(run.name);
    if (!prev || (run.run_id || 0) >= (prev.run_id || 0)) {
      byName.set(run.name, run);
    }
  }

  const names = new Set([
    ...CORE_REQUIRED_WORKFLOW_NAMES,
    ...CONDITIONAL_REQUIRED_WORKFLOW_NAMES,
    ...discoveredRuns.map((r) => r.name).filter(Boolean),
  ]);

  const rows = [];
  for (const name of names) {
    const discovered = byName.get(name) || null;
    const classification = classifyWorkflowRequirement(name, {
      changedFiles,
      discoveredRuns: discovered ? [discovered] : [],
    });
    rows.push({
      name,
      workflow_file: discovered?.workflow_file ?? null,
      run_id: discovered?.run_id ?? 0,
      head_sha: discovered?.head_sha ?? null,
      trigger: discovered?.event ?? null,
      status: discovered?.status ?? (classification.path_filter_classification === 'unexpectedly_missing' ? 'missing' : 'missing'),
      conclusion: discovered?.conclusion ?? null,
      required_status: classification.required_status,
      path_filter_classification: classification.path_filter_classification,
      violation_reason: null,
    });
  }

  for (const row of rows) {
    const evalRow = evaluateWorkflowRow(row);
    if (!evalRow.ok) {
      row.violation_reason = evalRow.violations.join('; ');
    }
  }

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

export function evaluateCiApprovalRecord(record, { headSha, originMainSha } = {}) {
  const violations = [];
  if (!record) {
    violations.push('approval artifact missing');
    return { status: 'BLOCKED', violations, all_required_terminal_green: false };
  }
  if (headSha && record.sha !== headSha) {
    violations.push(`approval SHA mismatch: ${record.sha} != ${headSha}`);
  }
  if (originMainSha && record.origin_main_sha !== originMainSha) {
    violations.push('origin/main SHA mismatch');
  }
  if (headSha && originMainSha && headSha !== originMainSha) {
    violations.push('HEAD differs from origin/main');
  }

  const rows = record.workflow_rows || record.required_workflows || [];
  if (!rows.length) {
    violations.push('empty workflow discovery');
  }

  for (const name of CORE_REQUIRED_WORKFLOW_NAMES) {
    const row = rows.find((r) => r.name === name);
    if (!row) {
      violations.push(`missing required workflow: ${name}`);
      continue;
    }
    const evalRow = evaluateWorkflowRow({ ...row, required_status: 'required' });
    if (!evalRow.ok) {
      violations.push(...evalRow.violations);
    }
  }

  for (const row of rows) {
    if (CORE_REQUIRED_WORKFLOW_NAMES.includes(row.name)) {
      continue;
    }
    const evalRow = evaluateWorkflowRow(row);
    if (!evalRow.ok) {
      violations.push(...evalRow.violations);
    }
  }

  if (record.all_required_terminal_green !== true && violations.length === 0) {
    violations.push('all_required_terminal_green is not true');
  }

  const deduped = [...new Set(violations)];
  return {
    status: deduped.length ? 'BLOCKED' : 'PASS',
    violations: deduped,
    all_required_terminal_green: deduped.length === 0,
    record,
  };
}

export function writeCiApprovalArtifact(sha, {
  originMainSha,
  workflowRows,
  changedFiles = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const rows = workflowRows || [];
  const requiredRows = rows.filter((r) => r.required_status === 'required');
  const corePresent = CORE_REQUIRED_WORKFLOW_NAMES.every((name) =>
    rows.some((r) => r.name === name),
  );
  const allGreen =
    corePresent &&
    requiredRows.length > 0 &&
    requiredRows.every((row) => {
      const evalRow = evaluateWorkflowRow(row);
      return evalRow.ok;
    }) &&
    !rows.some((r) => r.path_filter_classification === 'unexpectedly_missing');

  const record = {
    sha,
    origin_main_sha: originMainSha,
    generated_at: generatedAt,
    changed_files: changedFiles,
    workflow_rows: rows,
    required_workflows: rows.filter((r) => r.required_status === 'required'),
    all_required_terminal_green: allGreen,
  };
  fs.mkdirSync(CI_APPROVAL_DIR, { recursive: true });
  const file = approvalPathForSha(sha);
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

export function readCiApprovalArtifact(sha) {
  const file = approvalPathForSha(sha);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function listChangedFilesForSha(sha, { repoRoot = process.cwd() } = {}) {
  const parent = spawnSync('git', ['rev-parse', `${sha}^`], { cwd: repoRoot, encoding: 'utf8' });
  const range =
    parent.status === 0 ? `${parent.stdout.trim()}..${sha}` : sha;
  const diff = spawnSync('git', ['diff', '--name-only', range], { cwd: repoRoot, encoding: 'utf8' });
  if (diff.status !== 0) return [];
  return (diff.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function fetchWorkflowRunsForSha(sha, { repoRoot = process.cwd() } = {}) {
  const result = spawnSync(
    'gh',
    [
      'run',
      'list',
      '--commit',
      sha,
      '--json',
      'databaseId,name,status,conclusion,workflowName,headSha,event,workflowDatabaseId',
      '--limit',
      '100',
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`gh run list failed: ${result.stderr || result.stdout}`);
  }
  const runs = JSON.parse(result.stdout || '[]').map(normalizeWorkflowRun);
  return runs;
}

export function fetchCiJobSummaries(ciRunId, { repoRoot = process.cwd() } = {}) {
  if (!ciRunId) return [];
  const result = spawnSync(
    'gh',
    ['run', 'view', String(ciRunId), '--json', 'jobs'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`gh run view jobs failed: ${result.stderr || result.stdout}`);
  }
  const body = JSON.parse(result.stdout || '{}');
  return (body.jobs || []).map((job) => ({
    name: job.name,
    status: job.status,
    conclusion: job.conclusion ?? null,
  }));
}

export function evaluateRequiredCiJobs(ciJobs = []) {
  const violations = [];
  const rows = [];
  for (const name of CORE_REQUIRED_CI_JOB_NAMES) {
    const job = ciJobs.find((j) => j.name === name);
    if (!job) {
      violations.push(`missing required CI job: ${name}`);
      rows.push({
        name,
        status: 'missing',
        conclusion: null,
        required_status: 'required',
        path_filter_classification: 'ci_job',
        violation_reason: `missing required CI job: ${name}`,
      });
      continue;
    }
    const row = {
      name,
      status: job.status,
      conclusion: job.conclusion,
      required_status: 'required',
      path_filter_classification: 'ci_job',
      violation_reason: null,
    };
    if (job.status !== 'completed' || job.conclusion !== 'success') {
      row.violation_reason = `CI job not success: ${name} (${job.status}/${job.conclusion})`;
      violations.push(row.violation_reason);
    }
    rows.push(row);
  }
  return { violations, rows };
}

export function generateCiApprovalForHead({
  headSha,
  originMainSha,
  repoRoot = process.cwd(),
  changedFiles = null,
} = {}) {
  const discovered = fetchWorkflowRunsForSha(headSha, { repoRoot });
  const files = changedFiles ?? listChangedFilesForSha(headSha, { repoRoot });
  const workflowRows = buildWorkflowApprovalRows(discovered, { changedFiles: files });
  const ciRow = workflowRows.find((r) => r.name === 'ci');
  const ciJobs = fetchCiJobSummaries(ciRow?.run_id, { repoRoot });
  const jobEval = evaluateRequiredCiJobs(ciJobs);
  workflowRows.push(...jobEval.rows);
  const record = writeCiApprovalArtifact(headSha, {
    originMainSha,
    workflowRows,
    changedFiles: files,
  });
  if (jobEval.violations.length) {
    record.all_required_terminal_green = false;
    fs.writeFileSync(approvalPathForSha(headSha), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  }
  return record;
}

export function assertCiApproval({ headSha, originMainSha, approvalRecord = null } = {}) {
  const record = approvalRecord ?? readCiApprovalArtifact(headSha);
  const report = evaluateCiApprovalRecord(record, { headSha, originMainSha });
  if (report.status !== 'PASS') {
    const err = new Error(`CI approval BLOCKED: ${JSON.stringify(report)}`);
    err.code = 'PHASE32H_CI_APPROVAL_BLOCKED';
    err.report = report;
    throw err;
  }
  return report;
}

export function assertCleanLauncherSource(repoRoot) {
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
  if (status.status !== 0) {
    throw new Error('git status failed for launcher source reconciliation');
  }
  const dirty = (status.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const file = line.slice(3).trim();
      return (
        file.startsWith('scripts/') ||
        file.startsWith('Makefile') ||
        file.startsWith('tests/phase32h')
      );
    });
  if (dirty.length) {
    const err = new Error(`dirty launcher source blocks execution: ${dirty.join('; ')}`);
    err.code = 'PHASE32H_CI_APPROVAL_BLOCKED';
    throw err;
  }
}

export function assertSourceReconciliation(repoRoot, expectedHeadSha = null) {
  spawnSync('git', ['fetch', 'origin', '--prune', '--prune-tags'], { cwd: repoRoot });
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
  const origin = spawnSync('git', ['rev-parse', 'origin/main'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
  if (head !== origin) {
    const err = new Error(`HEAD ${head} != origin/main ${origin}`);
    err.code = 'PHASE32H_CI_APPROVAL_BLOCKED';
    throw err;
  }
  if (expectedHeadSha && head !== expectedHeadSha) {
    const err = new Error(`HEAD ${head} != expected ${expectedHeadSha}`);
    err.code = 'PHASE32H_CI_APPROVAL_BLOCKED';
    throw err;
  }
  return { headSha: head, originMainSha: origin };
}
