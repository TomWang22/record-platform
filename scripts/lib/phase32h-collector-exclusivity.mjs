/**
 * Phase 32H-R1 — prelaunch collector exclusivity gate (before evidence root creation).
 */
import fs from 'node:fs';
import path from 'node:path';
import { listPhase32hCaptureProcesses } from './phase32h-process-list.mjs';
import { FROZEN_BLOCKED_MARKER } from './phase32h-run-integrity.mjs';

function rootClassification(root) {
  if (!root) return 'unknown';
  if (!fs.existsSync(root)) return 'absent';
  if (fs.existsSync(path.join(root, FROZEN_BLOCKED_MARKER))) return 'frozen';
  if (fs.existsSync(path.join(root, 'COLLECTOR_COVERAGE_BLOCKED'))) return 'blocked';
  if (fs.existsSync(path.join(root, 'FROZEN_PASS_EVIDENCE'))) return 'frozen_pass';
  if (fs.existsSync(path.join(root, 'run-state', 'run-id'))) return 'active';
  return 'smoke_or_stale';
}

export function defaultCaptureInterface() {
  return process.env.PHASE32H_CAPTURE_IFACE || 'bridge100';
}

export function evaluateCollectorExclusivity({ interface: iface = defaultCaptureInterface(), intendedRoot = null } = {}) {
  const processes = listPhase32hCaptureProcesses().filter((p) => !iface || p.interface === iface);
  const foreign_collectors = [];
  const duplicate_collectors = [];

  const byRoot = new Map();
  for (const proc of processes) {
    const root = proc.evidence_root;
    if (!root) continue;
    if (intendedRoot && root === intendedRoot) continue;
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(proc);
  }

  for (const [root, procs] of byRoot.entries()) {
    const classification = rootClassification(root);
    if (procs.length > 1) {
      duplicate_collectors.push({
        evidence_root: root,
        classification,
        pids: procs.map((p) => p.pid),
        processes: procs,
      });
    }
    foreign_collectors.push({
      pid: procs[0].pid,
      ppid: procs[0].ppid,
      evidence_root: root,
      classification,
      interface: procs[0].interface,
      output_path: procs[0].output_path,
      command: procs[0].command,
      should_still_run: classification === 'active',
      stop_action: classification === 'active' ? 'manual_review' : 'stop_stale',
    });
  }

  if (foreign_collectors.length || duplicate_collectors.length) {
    return {
      status: 'BLOCKED',
      code: 'PHASE32H_COLLECTOR_EXCLUSIVITY_BLOCKED',
      interface: iface,
      foreign_collectors,
      duplicate_collectors,
      root_created: false,
    };
  }

  return {
    status: 'PASS',
    interface: iface,
    foreign_collectors: [],
    duplicate_collectors: [],
    root_created: false,
  };
}

export function assertCollectorExclusivityPreflight(opts = {}) {
  const result = evaluateCollectorExclusivity(opts);
  if (result.status !== 'PASS') {
    const err = new Error(JSON.stringify(result));
    err.code = 'PHASE32H_COLLECTOR_EXCLUSIVITY_BLOCKED';
    err.details = result;
    throw err;
  }
  return result;
}
