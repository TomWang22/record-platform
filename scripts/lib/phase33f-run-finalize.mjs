/**
 * Phase 33F — common PASS / BLOCKED run finalization.
 */
import fs from 'node:fs';
import path from 'node:path';
import { finalizeSmokeWithFreeze } from './phase32h-smoke-collector-cleanup.mjs';
import { readRunId } from './phase32h-run-integrity.mjs';

/**
 * @param {{
 *   outRoot: string,
 *   repoRoot: string,
 *   status: 'PASS' | 'BLOCKED',
 *   failureClass?: string | null,
 *   failureDetails?: object | null,
 *   mode?: string,
 *   launchHead?: string | null,
 *   manifestSha?: string | null,
 *   runner?: object | null,
 *   verdict?: object | null,
 *   supervisorPid?: number | null,
 *   telemetryPid?: number | null,
 *   quietPeriodMs?: number,
 *   gracefulMs?: number,
 * }} opts
 */
export function finalizePhase33fRun({
  outRoot,
  repoRoot,
  status,
  failureClass = null,
  failureDetails = null,
  mode = 'canary',
  launchHead = null,
  manifestSha = null,
  runner = null,
  verdict = null,
  supervisorPid = null,
  telemetryPid = null,
  quietPeriodMs,
  gracefulMs,
} = {}) {
  if (status !== 'PASS' && status !== 'BLOCKED') {
    throw new Error(`finalizePhase33fRun status must be PASS|BLOCKED, got ${status}`);
  }
  const pass = status === 'PASS';
  const markerName = pass ? 'FROZEN_PASS_EVIDENCE' : 'FROZEN_BLOCKED_EVIDENCE';
  const runId = fs.existsSync(path.join(outRoot, 'run-state', 'run-id'))
    ? readRunId(outRoot)
    : null;

  fs.mkdirSync(path.join(outRoot, 'reports'), { recursive: true });

  if (status === 'BLOCKED' && failureClass) {
    fs.writeFileSync(
      path.join(outRoot, 'reports', 'blocked-verdict.json'),
      `${JSON.stringify(
        {
          status: 'BLOCKED',
          failure_class: failureClass,
          failure_details: failureDetails,
          run_id: runId,
          launch_head: launchHead,
          manifest_sha: manifestSha,
          at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }

  const markerContent = `${JSON.stringify(
    {
      status: pass ? 'PASS' : 'FAIL',
      phase: '33F',
      mode,
      run_id: runId,
      launch_head: launchHead,
      manifest_sha: manifestSha,
      failure_class: failureClass,
      failure_details: failureDetails,
      runner,
      verdict,
      supervisor_pid: supervisorPid,
      telemetry_pid: telemetryPid,
      frozen_at: new Date().toISOString(),
    },
    null,
    2,
  )}\n`;

  const freeze = finalizeSmokeWithFreeze(outRoot, {
    repoRoot,
    pass,
    markerName,
    markerContent,
    hashManifestName: 'phase33f-hash-manifest.json',
    quietPeriodMs,
    gracefulMs,
  });

  return {
    status,
    failure_class: failureClass,
    freeze,
    marker_name: freeze.marker_name,
    freeze_ready: freeze.freezeReady,
  };
}
