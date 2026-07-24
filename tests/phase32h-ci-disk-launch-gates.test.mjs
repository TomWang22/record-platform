import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  evaluateCiApprovalRecord,
  writeCiApprovalArtifact,
  approvalPathForSha,
  CI_APPROVAL_DIR,
  CORE_REQUIRED_WORKFLOW_NAMES,
  buildWorkflowApprovalRows,
  classifyWorkflowRequirement,
  commitTouchesCoveragePaths,
} from '../scripts/lib/phase32h-ci-approval.mjs';
import {
  DISK_EXECUTION_SAFETY_MARGIN_BYTES,
  DISK_HARD_MIN_BYTES,
  DISK_OPERATIONAL_UNCERTAINTY_BYTES,
  DISK_PREFERRED_MIN_BYTES,
  DISK_PROJECTED_FOOTPRINT_BYTES,
  assertDiskPreflight,
  evaluateDiskPreflightFromBytes,
} from '../scripts/lib/phase32h-disk-preflight.mjs';
import { runBaselineLaunchPreflight } from '../scripts/lib/phase32h-baseline-launch-preflight.mjs';
import { assertLaunchableEvidenceRoot } from '../scripts/lib/phase32h-run-integrity.mjs';

const GB = 1024 ** 3;
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function goodWorkflows(sha) {
  return [
    ...CORE_REQUIRED_WORKFLOW_NAMES.map((name, idx) => ({
      name,
      run_id: 1000 + idx,
      status: 'completed',
      conclusion: 'success',
      head_sha: sha,
      required_status: 'required',
      path_filter_classification: 'core_required',
    })),
    {
      name: 'coverage',
      run_id: 2000,
      status: 'completed',
      conclusion: 'success',
      head_sha: sha,
      required_status: 'required',
      path_filter_classification: 'triggered',
    },
  ];
}

function writeApproval(sha, workflows, originSha = sha) {
  fs.mkdirSync(CI_APPROVAL_DIR, { recursive: true });
  return writeCiApprovalArtifact(sha, {
    originMainSha: originSha,
    workflowRows: workflows,
  });
}

describe('phase32h CI approval gate', () => {
  it('CI queued blocks launch', () => {
    const record = writeApproval(SHA_A, [
      { name: 'ci', run_id: 1, status: 'queued', conclusion: null, head_sha: SHA_A, required_status: 'required', path_filter_classification: 'core_required' },
      ...goodWorkflows(SHA_A).slice(1),
    ]);
    const report = evaluateCiApprovalRecord(record, { headSha: SHA_A, originMainSha: SHA_A });
    assert.equal(report.status, 'BLOCKED');
  });

  it('CI in_progress blocks launch', () => {
    const record = writeApproval(
      SHA_A,
      goodWorkflows(SHA_A).map((w) =>
        w.name === 'docker-build' ? { ...w, status: 'in_progress', conclusion: null } : w,
      ),
    );
    const report = evaluateCiApprovalRecord(record, { headSha: SHA_A, originMainSha: SHA_A });
    assert.equal(report.status, 'BLOCKED');
  });

  it('CI cancelled blocks launch', () => {
    const record = writeApproval(
      SHA_A,
      goodWorkflows(SHA_A).map((w) =>
        w.name === 'ci' ? { ...w, status: 'completed', conclusion: 'cancelled' } : w,
      ),
    );
    const report = evaluateCiApprovalRecord(record, { headSha: SHA_A, originMainSha: SHA_A });
    assert.equal(report.status, 'BLOCKED');
  });

  it('CI failure blocks launch', () => {
    const record = writeApproval(
      SHA_A,
      goodWorkflows(SHA_A).map((w) =>
        w.name === 'ci' ? { ...w, status: 'completed', conclusion: 'failure' } : w,
      ),
    );
    const report = evaluateCiApprovalRecord(record, { headSha: SHA_A, originMainSha: SHA_A });
    assert.equal(report.status, 'BLOCKED');
  });

  it('missing required workflow blocks launch', () => {
    const record = writeApproval(SHA_A, goodWorkflows(SHA_A).filter((w) => w.name !== 'ci'));
    const report = evaluateCiApprovalRecord(record, { headSha: SHA_A, originMainSha: SHA_A });
    assert.equal(report.status, 'BLOCKED');
  });

  it('approval SHA mismatch blocks launch', () => {
    const record = writeApproval(SHA_A, goodWorkflows(SHA_A));
    const report = evaluateCiApprovalRecord(record, { headSha: SHA_B, originMainSha: SHA_B });
    assert.equal(report.status, 'BLOCKED');
  });

  it('terminal-green exact SHA passes', () => {
    const record = writeApproval(SHA_A, goodWorkflows(SHA_A));
    const report = evaluateCiApprovalRecord(record, { headSha: SHA_A, originMainSha: SHA_A });
    assert.equal(report.status, 'PASS');
    assert.equal(report.all_required_terminal_green, true);
  });
});

describe('phase33d coverage approval hardening', () => {
  it('coverage failed blocks approval', () => {
    const rows = goodWorkflows(SHA_A).map((w) =>
      w.name === 'coverage' ? { ...w, status: 'completed', conclusion: 'failure' } : w,
    );
    const record = writeApproval(SHA_A, rows);
    const report = evaluateCiApprovalRecord(record, { headSha: SHA_A, originMainSha: SHA_A });
    assert.equal(report.status, 'BLOCKED');
    assert.ok(report.violations.some((v) => v.includes('coverage')));
  });

  it('coverage still running blocks approval', () => {
    const rows = goodWorkflows(SHA_A).map((w) =>
      w.name === 'coverage' ? { ...w, status: 'in_progress', conclusion: null } : w,
    );
    const record = writeApproval(SHA_A, rows);
    const report = evaluateCiApprovalRecord(record, { headSha: SHA_A, originMainSha: SHA_A });
    assert.equal(report.status, 'BLOCKED');
  });

  it('triggered coverage missing from approval input blocks', () => {
    const changed = ['services/python-ai-service/app/ai/routes.py'];
    const discovered = goodWorkflows(SHA_A)
      .filter((w) => w.name !== 'coverage')
      .map(({ required_status, path_filter_classification, ...rest }) => rest);
    const rows = buildWorkflowApprovalRows(discovered, { changedFiles: changed });
    const record = writeApproval(SHA_A, rows);
    const report = evaluateCiApprovalRecord(record, { headSha: SHA_A, originMainSha: SHA_A });
    assert.equal(report.status, 'BLOCKED');
    assert.ok(rows.some((r) => r.name === 'coverage' && r.path_filter_classification === 'unexpectedly_missing'));
  });

  it('coverage legitimately path-filtered is documented skip', () => {
    const changed = ['docs/README.md'];
    const discovered = goodWorkflows(SHA_A)
      .filter((w) => w.name !== 'coverage')
      .map(({ required_status, path_filter_classification, ...rest }) => rest);
    const rows = buildWorkflowApprovalRows(discovered, { changedFiles: changed });
    const coverageRow = rows.find((r) => r.name === 'coverage');
    assert.equal(coverageRow.path_filter_classification, 'not_triggered');
    assert.equal(coverageRow.required_status, 'optional');
  });

  it('all required workflows successful passes with triggered coverage', () => {
    const record = writeApproval(SHA_A, goodWorkflows(SHA_A));
    const report = evaluateCiApprovalRecord(record, { headSha: SHA_A, originMainSha: SHA_A });
    assert.equal(report.status, 'PASS');
  });

  it('empty workflow discovery blocks approval', () => {
    const record = writeApproval(SHA_A, []);
    const report = evaluateCiApprovalRecord(record, { headSha: SHA_A, originMainSha: SHA_A });
    assert.equal(report.status, 'BLOCKED');
  });

  it('commitTouchesCoveragePaths detects services changes', () => {
    assert.equal(commitTouchesCoveragePaths(['services/python-ai-service/app/ai/routes.py']), true);
    assert.equal(classifyWorkflowRequirement('coverage', { changedFiles: ['services/x'] }).path_filter_classification, 'unexpectedly_missing');
  });
});

describe('phase32h disk reserve gate', () => {
  it('free disk 41.4 GB blocks when required minimum is 47 GB', () => {
    const report = evaluateDiskPreflightFromBytes(Math.floor(41.4 * GB));
    assert.equal(report.launch_ready, false);
    assert.equal(report.status, 'BLOCKED');
    assert.equal(report.disk_reserve_violation, true);
  });

  it('free disk 46.9 GB blocks', () => {
    const report = evaluateDiskPreflightFromBytes(Math.floor(46.9 * GB));
    assert.equal(report.launch_ready, false);
  });

  it('free disk 47 GB passes hard calculation', () => {
    const report = evaluateDiskPreflightFromBytes(47 * GB);
    assert.equal(report.launch_ready, true);
    assert.equal(report.status, 'WARN');
  });

  it('preferred warning emitted below 50 GB', () => {
    const report = evaluateDiskPreflightFromBytes(48 * GB);
    assert.equal(report.launch_ready, true);
    assert.equal(report.status, 'WARN');
    assert.ok(report.free_bytes < DISK_PREFERRED_MIN_BYTES);
  });

  it('projected remaining below 10 GB blocks during execution', () => {
    const free = DISK_PROJECTED_FOOTPRINT_BYTES + 9 * GB;
    const report = evaluateDiskPreflightFromBytes(free);
    assert.equal(report.launch_ready, false);
    assert.ok(report.projected_remaining_bytes < DISK_OPERATIONAL_UNCERTAINTY_BYTES);
  });

  it('hard minimum equals projected footprint plus operational uncertainty', () => {
    assert.equal(
      DISK_HARD_MIN_BYTES,
      DISK_PROJECTED_FOOTPRINT_BYTES + DISK_OPERATIONAL_UNCERTAINTY_BYTES,
    );
    assert.equal(DISK_HARD_MIN_BYTES, 47 * GB);
  });
});

describe('phase32h launch root and resume policy', () => {
  it('evidence root is not created after prelaunch failure', () => {
    const out = `/tmp/phase32h-launch-block-${Date.now()}`;
    try {
      assert.throws(
        () =>
          runBaselineLaunchPreflight(
            { arm: 'baseline', out, canary: false },
            {
              skipPreflight: true,
              approvalRecord: null,
              skipSourceDirtyCheck: true,
              skipStaticGuard: true,
              skipSourceReconciliation: true,
              skipDiskPreflight: true,
            },
          ),
        (err) => err.code === 'PHASE32H_CI_APPROVAL_BLOCKED',
      );
      assert.equal(fs.existsSync(path.join(out, 'phase32h-r1-manifest.jsonl')), false);
    } finally {
      if (fs.existsSync(out)) fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it('frozen root cannot be resumed', () => {
    assert.throws(
      () => assertLaunchableEvidenceRoot('/tmp/phase32h-r1-baseline-r2'),
      /frozen/,
    );
  });

  it('CI approval cannot be reused after a new commit', () => {
    const record = writeApproval(SHA_A, goodWorkflows(SHA_A));
    const stale = evaluateCiApprovalRecord(record, { headSha: SHA_B, originMainSha: SHA_B });
    assert.equal(stale.status, 'BLOCKED');
    void approvalPathForSha(SHA_A);
  });
});
