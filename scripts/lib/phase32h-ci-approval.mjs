/**
 * Phase 32H-R1 — exact-SHA CI approval gate before baseline evidence root creation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const CI_APPROVAL_DIR = '/tmp/phase32h-prelaunch-approvals';

export const REQUIRED_WORKFLOW_NAMES = [
  'ci',
  'docker-build',
  'Protocol validation (static + fixtures)',
  'RP Namespace Lint',
];

export function approvalPathForSha(sha) {
  return path.join(CI_APPROVAL_DIR, `${sha}.json`);
}

export function normalizeWorkflowRun(run) {
  return {
    name: run.name || run.workflowName,
    run_id: Number(run.databaseId || run.run_id || run.id || 0),
    status: run.status,
    conclusion: run.conclusion ?? null,
    head_sha: run.headSha || run.head_sha || null,
  };
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
  const required = record.required_workflows || [];
  const byName = new Map(required.map((row) => [row.name, row]));
  for (const name of REQUIRED_WORKFLOW_NAMES) {
    const row = byName.get(name);
    if (!row) {
      violations.push(`missing required workflow: ${name}`);
      continue;
    }
    if (row.status !== 'completed') {
      violations.push(`workflow not completed: ${name} (${row.status})`);
    }
    if (row.conclusion !== 'success') {
      violations.push(`workflow not success: ${name} (${row.conclusion})`);
    }
  }
  if (record.all_required_terminal_green !== true) {
    violations.push('all_required_terminal_green is not true');
  }
  return {
    status: violations.length ? 'BLOCKED' : 'PASS',
    violations,
    all_required_terminal_green: violations.length === 0,
    record,
  };
}

export function writeCiApprovalArtifact(sha, {
  originMainSha,
  requiredWorkflows,
  generatedAt = new Date().toISOString(),
} = {}) {
  const workflows = requiredWorkflows.map(normalizeWorkflowRun);
  const allGreen =
    workflows.length >= REQUIRED_WORKFLOW_NAMES.length &&
    REQUIRED_WORKFLOW_NAMES.every((name) => {
      const row = workflows.find((w) => w.name === name);
      return row && row.status === 'completed' && row.conclusion === 'success';
    });
  const record = {
    sha,
    origin_main_sha: originMainSha,
    generated_at: generatedAt,
    required_workflows: workflows,
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

export function fetchWorkflowRunsForSha(sha, { repoRoot = process.cwd() } = {}) {
  const result = spawnSync(
    'gh',
    [
      'run',
      'list',
      '--commit',
      sha,
      '--json',
      'databaseId,name,status,conclusion,workflowName,headSha',
      '--limit',
      '50',
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`gh run list failed: ${result.stderr || result.stdout}`);
  }
  const runs = JSON.parse(result.stdout || '[]');
  const picked = [];
  for (const name of REQUIRED_WORKFLOW_NAMES) {
    const row = runs.find((r) => r.name === name || r.workflowName === name);
    if (row) picked.push(normalizeWorkflowRun(row));
    else picked.push({ name, run_id: 0, status: 'missing', conclusion: null, head_sha: sha });
  }
  return picked;
}

export function generateCiApprovalForHead({
  headSha,
  originMainSha,
  repoRoot = process.cwd(),
} = {}) {
  const workflows = fetchWorkflowRunsForSha(headSha, { repoRoot });
  return writeCiApprovalArtifact(headSha, {
    originMainSha,
    requiredWorkflows: workflows,
  });
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
