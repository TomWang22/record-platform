/**
 * Phase 32H-R1 — explicit collector registry and foreign/duplicate PCAP detection.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  isPhase32hCaptureProcess,
  listPhase32hCaptureProcesses,
  resolveCaptureInterface,
  resolveEvidenceRootFromCommand,
  resolvePcapOutputPath,
} from './phase32h-process-list.mjs';
import { pidAlive } from './phase32h-process-registry.mjs';
import { FRESHNESS_THRESHOLDS_MS } from './phase32h-collector-supervision.mjs';

export const COLLECTOR_REGISTRY_FILE = 'collector-registry.json';
export const FOREIGN_COLLECTOR_MARKER = 'PHASE32H_FOREIGN_COLLECTOR_BLOCKED';
export const DUPLICATE_COLLECTOR_MARKER = 'PHASE32H_DUPLICATE_COLLECTOR_BLOCKED';

export const PCAP_FAILURE_CLASS = {
  ACTIVE: 'ACTIVE',
  EXPECTED_PCAP_PROCESS_MISSING: 'EXPECTED_PCAP_PROCESS_MISSING',
  EXPECTED_PCAP_PROCESS_STALE: 'EXPECTED_PCAP_PROCESS_STALE',
  DUPLICATE_PCAP_PROCESS_SAME_ROOT: 'DUPLICATE_PCAP_PROCESS_SAME_ROOT',
  FOREIGN_PHASE32H_PCAP_PROCESS: 'FOREIGN_PHASE32H_PCAP_PROCESS',
  PCAP_OUTPUT_NOT_GROWING: 'PCAP_OUTPUT_NOT_GROWING',
  PCAP_HEARTBEAT_STALE: 'PCAP_HEARTBEAT_STALE',
  PCAP_DROP_DETECTED: 'PCAP_DROP_DETECTED',
  UNRELATED_NON_PHASE32H_CAPTURE: 'UNRELATED_NON_PHASE32H_CAPTURE',
};

function fileAgeMs(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return Number.POSITIVE_INFINITY;
  return Date.now() - fs.statSync(filePath).mtimeMs;
}

export function collectorRegistryPath(outRoot) {
  return path.join(outRoot, 'run-state', COLLECTOR_REGISTRY_FILE);
}

export function readCollectorRegistry(outRoot) {
  const file = collectorRegistryPath(outRoot);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeCollectorRegistry(outRoot, registry) {
  const file = collectorRegistryPath(outRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  return registry;
}

export function registerPcapCollector(outRoot, record) {
  const statusPath = path.join(outRoot, 'pcap/capture-status.json');
  const captureStatus = fs.existsSync(statusPath)
    ? JSON.parse(fs.readFileSync(statusPath, 'utf8'))
    : {};
  const command =
    record.command ||
    `${captureStatus.tool || 'dumpcap'} -i ${captureStatus.iface} -w ${captureStatus.file}`;
  const registry = {
    version: 1,
    updated_at: new Date().toISOString(),
    collectors: {
      pcap_collector: {
        role: 'pcap_collector',
        pid: record.pid ?? captureStatus.pid,
        ppid: record.ppid ?? process.ppid,
        run_id: record.run_id,
        launch_head: record.launch_head,
        manifest_sha: record.manifest_sha,
        evidence_root: outRoot,
        command,
        interface: record.interface ?? captureStatus.iface,
        output_path: record.output_path ?? captureStatus.file,
        started_at: record.started_at ?? captureStatus.started_at ?? new Date().toISOString(),
        heartbeat_path: statusPath,
        expected_singleton_scope: record.expected_singleton_scope || 'pcap_collector_per_root',
      },
    },
  };
  return writeCollectorRegistry(outRoot, registry);
}

function commandMatchesRegistry(proc, entry) {
  if (!entry) return false;
  if (proc.pid !== entry.pid) return false;
  if (proc.command !== entry.command) return false;
  if (entry.evidence_root && proc.evidence_root !== entry.evidence_root) return false;
  if (entry.output_path && proc.output_path !== entry.output_path) return false;
  return true;
}

export function detectForeignPcapCollectors(outRoot, processes, registry, iface) {
  const entry = registry?.collectors?.pcap_collector;
  const captureIface = iface || entry?.interface;
  const foreign = [];
  for (const proc of processes) {
    if (!isPhase32hCaptureProcess(proc.command)) continue;
    if (captureIface && proc.interface && proc.interface !== captureIface) continue;
    if (entry && proc.pid === entry.pid && proc.evidence_root === outRoot) continue;
    if (proc.evidence_root === outRoot && entry && proc.pid === entry.pid) continue;
    if (proc.evidence_root && proc.evidence_root !== outRoot) {
      foreign.push(proc);
      continue;
    }
    if (!proc.evidence_root || proc.evidence_root !== outRoot) {
      foreign.push(proc);
    }
  }
  return foreign;
}

export function detectDuplicatePcapCollectors(outRoot, processes, registry) {
  const entry = registry?.collectors?.pcap_collector;
  const sameRoot = processes.filter(
    (p) => isPhase32hCaptureProcess(p.command) && p.evidence_root === outRoot,
  );
  if (sameRoot.length <= 1) return [];
  if (!entry) return sameRoot.slice(1);
  const registered = sameRoot.filter((p) => p.pid === entry.pid);
  return sameRoot.filter((p) => p.pid !== entry.pid);
}

export function evaluatePcapCollectorIdentity(outRoot, processes, registry, opts = {}) {
  const entry = registry?.collectors?.pcap_collector;
  const probesActive = Boolean(opts.probesActive);
  const pcapThreshold = probesActive ? FRESHNESS_THRESHOLDS_MS.pcap_active : Number.POSITIVE_INFINITY;
  const captureProcesses = processes.filter(
    (p) => isPhase32hCaptureProcess(p.command) && p.evidence_root === outRoot,
  );
  const foreign = detectForeignPcapCollectors(outRoot, processes, registry, entry?.interface);
  const duplicates = detectDuplicatePcapCollectors(outRoot, processes, registry);

  if (foreign.length) {
    return {
      role: 'pcap_collector',
      status: 'BLOCKED',
      failure_class: PCAP_FAILURE_CLASS.FOREIGN_PHASE32H_PCAP_PROCESS,
      pid: entry?.pid ?? null,
      process_count: captureProcesses.length,
      foreign_collectors: foreign,
      duplicate_collectors: duplicates,
    };
  }
  if (duplicates.length) {
    return {
      role: 'pcap_collector',
      status: 'BLOCKED',
      failure_class: PCAP_FAILURE_CLASS.DUPLICATE_PCAP_PROCESS_SAME_ROOT,
      pid: entry?.pid ?? null,
      process_count: captureProcesses.length,
      foreign_collectors: foreign,
      duplicate_collectors: duplicates,
    };
  }
  if (!entry) {
    return {
      role: 'pcap_collector',
      status: probesActive ? 'STALE' : 'QUIET',
      failure_class: PCAP_FAILURE_CLASS.EXPECTED_PCAP_PROCESS_MISSING,
      pid: null,
      process_count: captureProcesses.length,
    };
  }
  const proc = captureProcesses.find((p) => p.pid === entry.pid);
  if (!proc || !pidAlive(entry.pid)) {
    return {
      role: 'pcap_collector',
      status: 'STALE',
      failure_class: PCAP_FAILURE_CLASS.EXPECTED_PCAP_PROCESS_MISSING,
      pid: entry.pid,
      process_count: captureProcesses.length,
    };
  }
  if (!commandMatchesRegistry(proc, entry)) {
    return {
      role: 'pcap_collector',
      status: 'STALE',
      failure_class: PCAP_FAILURE_CLASS.EXPECTED_PCAP_PROCESS_STALE,
      pid: entry.pid,
      process_count: captureProcesses.length,
      registry_mismatch: true,
    };
  }
  if (entry.run_id && opts.runId && entry.run_id !== opts.runId) {
    return {
      role: 'pcap_collector',
      status: 'STALE',
      failure_class: PCAP_FAILURE_CLASS.EXPECTED_PCAP_PROCESS_STALE,
      pid: entry.pid,
      process_count: 1,
      run_id_mismatch: true,
    };
  }
  if (entry.launch_head && opts.launchHead && entry.launch_head !== opts.launchHead) {
    return {
      role: 'pcap_collector',
      status: 'STALE',
      failure_class: PCAP_FAILURE_CLASS.EXPECTED_PCAP_PROCESS_STALE,
      pid: entry.pid,
      process_count: 1,
      launch_head_mismatch: true,
    };
  }

  const outputPath = entry.output_path || proc.output_path;
  const outputAge = fileAgeMs(outputPath);
  const heartbeatAge = fileAgeMs(entry.heartbeat_path);
  if (probesActive && heartbeatAge > pcapThreshold) {
    return {
      role: 'pcap_collector',
      status: 'STALE',
      failure_class: PCAP_FAILURE_CLASS.PCAP_HEARTBEAT_STALE,
      pid: entry.pid,
      process_count: 1,
      output_path: outputPath,
      last_output_age_ms: outputAge,
    };
  }
  if (probesActive && outputAge > pcapThreshold) {
    return {
      role: 'pcap_collector',
      status: 'STALE',
      failure_class: PCAP_FAILURE_CLASS.PCAP_OUTPUT_NOT_GROWING,
      pid: entry.pid,
      process_count: 1,
      output_path: outputPath,
      last_output_age_ms: outputAge,
    };
  }

  return {
    role: 'pcap_collector',
    status: probesActive ? 'ACTIVE' : 'QUIET',
    failure_class: PCAP_FAILURE_CLASS.ACTIVE,
    pid: entry.pid,
    process_count: 1,
    output_path: outputPath,
    last_output_age_ms: outputAge,
    command: entry.command,
    interface: entry.interface,
  };
}

export function markForeignCollectorBlocked(outRoot, details) {
  const marker = path.join(outRoot, FOREIGN_COLLECTOR_MARKER);
  if (fs.existsSync(marker)) return JSON.parse(fs.readFileSync(marker, 'utf8'));
  const payload = {
    at: new Date().toISOString(),
    status: 'BLOCKED',
    immutable: true,
    reason: 'foreign Phase 32H PCAP collector detected',
    ...details,
  };
  fs.writeFileSync(marker, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

export function markDuplicateCollectorBlocked(outRoot, details) {
  const marker = path.join(outRoot, DUPLICATE_COLLECTOR_MARKER);
  if (fs.existsSync(marker)) return JSON.parse(fs.readFileSync(marker, 'utf8'));
  const payload = {
    at: new Date().toISOString(),
    status: 'BLOCKED',
    immutable: true,
    reason: 'duplicate PCAP collector for same evidence root',
    ...details,
  };
  fs.writeFileSync(marker, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

export function scanCaptureInventory({ interface: iface } = {}) {
  const processes = listPhase32hCaptureProcesses();
  return processes
    .filter((p) => !iface || p.interface === iface)
    .map((p) => ({
      pid: p.pid,
      ppid: p.ppid,
      evidence_root: p.evidence_root || resolveEvidenceRootFromCommand(p.command),
      interface: p.interface || resolveCaptureInterface(p.command),
      output_path: p.output_path || resolvePcapOutputPath(p.command),
      command: p.command,
      lstart: p.lstart,
      etime: p.etime,
    }));
}
