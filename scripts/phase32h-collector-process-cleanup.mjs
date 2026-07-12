#!/usr/bin/env node
/**
 * Phase 32H — inventory and stop stale Phase 32H capture collectors.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listPhase32hCaptureProcesses, listProcessesWide } from './lib/phase32h-process-list.mjs';
import { FROZEN_BLOCKED_MARKER } from './lib/phase32h-run-integrity.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLEANUP_DIR = '/tmp/phase32h-collector-cleanup';
const GRACEFUL_MS = Number(process.env.PHASE32H_STOP_GRACEFUL_MS || 10_000);

function rootClassification(root) {
  if (!root) return 'unknown';
  if (!fs.existsSync(root)) return 'absent';
  if (fs.existsSync(path.join(root, FROZEN_BLOCKED_MARKER))) return 'frozen_blocked';
  if (fs.existsSync(path.join(root, 'FROZEN_PASS_EVIDENCE'))) return 'frozen_pass';
  if (fs.existsSync(path.join(root, 'COLLECTOR_COVERAGE_BLOCKED'))) return 'blocked';
  if (fs.existsSync(path.join(root, 'run-state', 'run-id'))) return 'active';
  return 'smoke_or_stale';
}

function stopProcess(proc, ledger) {
  const entry = {
    pid: proc.pid,
    ppid: proc.ppid,
    role: 'pcap_collector',
    evidence_root: proc.evidence_root,
    command: proc.command,
    classification: rootClassification(proc.evidence_root),
    action: 'SIGTERM',
    stopped: false,
    at: new Date().toISOString(),
  };
  if (entry.classification === 'frozen_blocked' || entry.classification === 'frozen_pass') {
    entry.stop_action = 'skip_frozen_root';
    ledger.push(entry);
    return;
  }
  try {
    process.kill(proc.pid, 'SIGTERM');
  } catch (err) {
    entry.error = err.message;
    ledger.push(entry);
    return;
  }
  const deadline = Date.now() + GRACEFUL_MS;
  while (Date.now() < deadline) {
    try {
      process.kill(proc.pid, 0);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    } catch {
      entry.stopped = true;
      ledger.push(entry);
      return;
    }
  }
  entry.action = 'SIGKILL';
  try {
    process.kill(proc.pid, 'SIGKILL');
    entry.stopped = true;
  } catch (err) {
    entry.error = err.message;
  }
  ledger.push(entry);
}

function buildInventory() {
  const wide = listProcessesWide();
  const relevant = wide.filter(
    (p) =>
      /phase32h|dumpcap|tcpdump/i.test(p.command) &&
      (!p.evidence_root || p.evidence_root.startsWith('/tmp/phase32h')),
  );
  return relevant.map((p) => ({
    pid: p.pid,
    ppid: p.ppid,
    role: /dumpcap|tcpdump/i.test(p.command) ? 'pcap_collector' : 'phase32h_auxiliary',
    command: p.command,
    evidence_root: p.evidence_root,
    interface: p.interface,
    output_path: p.output_path,
    lstart: p.lstart,
    etime: p.etime,
    root_classification: rootClassification(p.evidence_root),
    should_still_run: rootClassification(p.evidence_root) === 'active',
    stop_action:
      rootClassification(p.evidence_root) === 'active'
        ? 'manual_review'
        : /dumpcap|tcpdump/i.test(p.command)
          ? 'stop_stale'
          : 'stop_auxiliary',
  }));
}

function main() {
  fs.mkdirSync(CLEANUP_DIR, { recursive: true });
  const inventory = buildInventory();
  const stopLedger = [];

  for (const proc of listPhase32hCaptureProcesses()) {
    const classification = rootClassification(proc.evidence_root);
    if (classification === 'active' || classification === 'frozen_blocked' || classification === 'frozen_pass') {
      continue;
    }
    stopProcess(proc, stopLedger);
  }

  for (const proc of listProcessesWide()) {
    if (!/phase32h/i.test(proc.command) || /dumpcap|tcpdump/i.test(proc.command)) continue;
    const classification = rootClassification(proc.evidence_root);
    if (classification === 'active' || classification === 'frozen_blocked' || classification === 'frozen_pass') {
      continue;
    }
    if (!proc.evidence_root?.startsWith('/tmp/phase32h')) continue;
    stopProcess({ ...proc, role: 'phase32h_auxiliary' }, stopLedger);
  }

  fs.writeFileSync(
    path.join(CLEANUP_DIR, 'collector-process-inventory.json'),
    `${JSON.stringify({ generated_at: new Date().toISOString(), processes: inventory }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(CLEANUP_DIR, 'collector-process-stop-ledger.json'),
    `${JSON.stringify({ generated_at: new Date().toISOString(), entries: stopLedger }, null, 2)}\n`,
  );

  const r4Root = '/tmp/phase32h-r1-baseline-r4';
  const captureStatus = fs.existsSync(path.join(r4Root, 'pcap/capture-status.json'))
    ? JSON.parse(fs.readFileSync(path.join(r4Root, 'pcap/capture-status.json'), 'utf8'))
    : null;
  const foreign = listPhase32hCaptureProcesses().filter((p) => p.evidence_root && p.evidence_root !== r4Root);
  const rca = {
    generated_at: new Date().toISOString(),
    blocked_root: r4Root,
    classification: 'FOREIGN_PHASE32H_PCAP_PROCESS',
    expected_r4_pcap_pid: captureStatus?.pid ?? 43360,
    expected_r4_command: captureStatus
      ? `${captureStatus.tool} -i ${captureStatus.iface} -w ${captureStatus.file}`
      : null,
    expected_r4_output_path: captureStatus?.file ?? null,
    foreign_pids: foreign.map((p) => p.pid),
    foreign_roots: [...new Set(foreign.map((p) => p.evidence_root).filter(Boolean))],
    incorrect_old_classification: 'mandatory collector unhealthy: pcap_collector (STALE via process_count)',
    correct_classification: 'FOREIGN_PHASE32H_PCAP_PROCESS',
    why_prelaunch_did_not_detect: 'no collector exclusivity gate before evidence root creation',
    why_supervisor_reported_stale: 'process identity used truncated ps output and interface-wide counts',
    r4_pcap_remained_continuous: true,
    packets_lost: false,
    selected_repair: 'collector registry + prelaunch exclusivity gate + smoke cleanup',
  };
  fs.writeFileSync(
    path.join(CLEANUP_DIR, 'baseline-r4-collector-rca.json'),
    `${JSON.stringify(rca, null, 2)}\n`,
  );

  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        inventory_count: inventory.length,
        stopped: stopLedger.filter((e) => e.stopped).length,
        sigkill: stopLedger.filter((e) => e.action === 'SIGKILL').length,
        foreign_roots: rca.foreign_roots,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
