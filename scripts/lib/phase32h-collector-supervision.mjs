/**
 * Phase 32H-R1 — mandatory collector freshness gates and coverage blocking.
 */
import fs from 'node:fs';
import path from 'node:path';
import { markCoverageBlocked } from './phase32h-run-integrity.mjs';
import {
  evaluatePcapCollectorIdentity,
  PCAP_FAILURE_CLASS,
  readCollectorRegistry,
} from './phase32h-collector-registry.mjs';

export const MANDATORY_COLLECTORS = [
  'pcap_collector',
  'extreme_watchdog',
  'gateway_log_collector',
  'application_log_collector',
  'host_telemetry_collector',
  'power_telemetry_collector',
  'h1_runner',
  'h2_runner',
  'h3_runner',
  'matrix_monitor',
];

export const FRESHNESS_THRESHOLDS_MS = {
  runner: 10_000,
  watchdog: 10_000,
  host_telemetry: 10_000,
  power_telemetry: 30_000,
  pcap_active: 30_000,
  application_log: 90_000,
  gateway_log: 90_000,
  monitor_extra: 30_000,
};

function fileAgeMs(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return Number.POSITIVE_INFINITY;
  return Date.now() - fs.statSync(filePath).mtimeMs;
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Read an atomic-ish JSON snapshot with retries for mid-write truncation.
 */
export function readJsonFileResilient(filePath, { attempts = 5, delayMs = 25, fallback = null } = {}) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const text = fs.readFileSync(filePath, 'utf8');
      if (!text.trim()) {
        sleepMs(delayMs);
        continue;
      }
      return JSON.parse(text);
    } catch (err) {
      lastErr = err;
      sleepMs(delayMs * (i + 1));
    }
  }
  if (fallback !== undefined) return fallback;
  throw lastErr || new Error(`failed to read JSON: ${filePath}`);
}

function lastJsonlTimestamp(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  if (!lines.length) return null;
  try {
    const row = JSON.parse(lines[lines.length - 1]);
    return row.ts || row.timestamp || row.at || null;
  } catch {
    return null;
  }
}

function ageFromIso(iso) {
  if (!iso) return Number.POSITIVE_INFINITY;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return Number.POSITIVE_INFINITY;
  return Date.now() - ms;
}

export function evaluateCollectorHealth(outRoot, processes = [], opts = {}) {
  const monitorIntervalMs = Number(opts.monitorIntervalMs || 300_000);
  const probesActive = Boolean(opts.probesActive);
  const registry = opts.registry ?? readCollectorRegistry(outRoot);
  const roles = {};

  const findProc = (pattern) =>
    processes.filter((p) => p.command?.includes(pattern) && p.command?.includes(outRoot));

  const tripletRunnerProcs = processes.filter(
    (p) =>
      /scripts\/phase32h-r1-triplet-runner\.mjs/.test(p.command || '') &&
      (p.command || '').includes(outRoot),
  );
  const tripletMode = probesActive && tripletRunnerProcs.length >= 1;

  const watchdogProcs = findProc('phase32h-extreme-watchdog.mjs');
  const watchdogHb = path.join(outRoot, 'heartbeats/watchdog.jsonl');
  roles.extreme_watchdog = {
    role: 'extreme_watchdog',
    pid: watchdogProcs[0]?.pid ?? null,
    process_count: watchdogProcs.length,
    output_path: watchdogHb,
    last_output_age_ms: fileAgeMs(watchdogHb),
    freshness_threshold_ms: FRESHNESS_THRESHOLDS_MS.watchdog,
    status:
      watchdogProcs.length === 1 && fileAgeMs(watchdogHb) <= FRESHNESS_THRESHOLDS_MS.watchdog
        ? 'ACTIVE'
        : 'STALE',
  };

  const pcapStatus = path.join(outRoot, 'pcap/capture-status.json');
  const pcapIdentity = evaluatePcapCollectorIdentity(outRoot, processes, registry, {
    probesActive,
    runId: opts.runId,
    launchHead: opts.launchHead,
  });
  roles.pcap_collector = {
    role: 'pcap_collector',
    pid: pcapIdentity.pid,
    process_count: pcapIdentity.process_count,
    output_path: pcapIdentity.output_path,
    last_output_age_ms: pcapIdentity.last_output_age_ms ?? Number.POSITIVE_INFINITY,
    freshness_threshold_ms: probesActive ? FRESHNESS_THRESHOLDS_MS.pcap_active : Number.POSITIVE_INFINITY,
    status: pcapIdentity.status === 'BLOCKED' ? 'STALE' : pcapIdentity.status,
    failure_class: pcapIdentity.failure_class,
    foreign_collectors: pcapIdentity.foreign_collectors || [],
    duplicate_collectors: pcapIdentity.duplicate_collectors || [],
  };

  for (const proto of ['h1', 'h2', 'h3']) {
    const runnerProcs = findProc(`phase32h-targeted-reproduction-runner.mjs`)?.filter((p) =>
      p.command?.includes(`--protocol ${proto}`),
    );
    const hb = path.join(outRoot, 'heartbeats', `${proto}.jsonl`);
    const smokeActiveRunner = opts.smokeMode && opts.activeProtocol === proto;
    const runnerFresh = fileAgeMs(hb) <= FRESHNESS_THRESHOLDS_MS.runner;
    const runnerProcessOk = runnerProcs?.length === 1;
    let status = 'FINISHED';
    if (tripletMode) {
      status = tripletRunnerProcs.length === 1 ? 'ACTIVE' : 'MISSING';
    } else if (probesActive) {
      if (opts.smokeMode && opts.activeProtocol && opts.activeProtocol !== proto) {
        status = 'QUIET';
      } else if (smokeActiveRunner) {
        status = runnerFresh ? 'ACTIVE' : 'STALE';
      } else {
        status = runnerProcessOk && runnerFresh ? 'ACTIVE' : 'STALE';
      }
    }
    roles[`${proto}_runner`] = {
      role: `${proto}_runner`,
      pid: runnerProcs?.[0]?.pid ?? (smokeActiveRunner ? process.pid : null),
      process_count: runnerProcs?.length ?? (smokeActiveRunner ? 1 : 0),
      output_path: hb,
      last_output_age_ms: fileAgeMs(hb),
      freshness_threshold_ms: FRESHNESS_THRESHOLDS_MS.runner,
      status,
    };
  }

  const hostTel = path.join(outRoot, 'telemetry/host-telemetry.jsonl');
  const hostProcs = findProc('phase32h-capture-host-telemetry.sh');
  roles.host_telemetry_collector = {
    role: 'host_telemetry_collector',
    pid: hostProcs[0]?.pid ?? null,
    process_count: hostProcs.length,
    output_path: hostTel,
    last_output_age_ms: fileAgeMs(hostTel),
    freshness_threshold_ms: FRESHNESS_THRESHOLDS_MS.host_telemetry,
    status:
      hostProcs.length === 1 && fileAgeMs(hostTel) <= FRESHNESS_THRESHOLDS_MS.host_telemetry
        ? 'ACTIVE'
        : 'STALE',
  };

  const powerTel = path.join(outRoot, 'telemetry/power-events.jsonl');
  roles.power_telemetry_collector = {
    role: 'power_telemetry_collector',
    pid: hostProcs[0]?.pid ?? null,
    process_count: hostProcs.length,
    output_path: powerTel,
    last_output_age_ms: fileAgeMs(powerTel),
    freshness_threshold_ms: FRESHNESS_THRESHOLDS_MS.power_telemetry,
    status:
      hostProcs.length >= 1 && fileAgeMs(powerTel) <= FRESHNESS_THRESHOLDS_MS.power_telemetry
        ? 'ACTIVE'
        : 'STALE',
  };

  const gwLog = path.join(outRoot, 'logs/gateway-access-tail.txt');
  const gwProcs = findProc('phase32h-start-gateway-log-capture.sh');
  roles.gateway_log_collector = {
    role: 'gateway_log_collector',
    pid: gwProcs[0]?.pid ?? null,
    process_count: gwProcs.length,
    output_path: gwLog,
    last_output_age_ms: fileAgeMs(gwLog),
    freshness_threshold_ms: FRESHNESS_THRESHOLDS_MS.gateway_log,
    status:
      gwProcs.length === 1 && fileAgeMs(gwLog) <= FRESHNESS_THRESHOLDS_MS.gateway_log
        ? 'ACTIVE'
        : 'STALE',
  };

  const appLog = path.join(outRoot, 'logs/application-log-tail.txt');
  const appProcs = findProc('phase32h-start-application-log-capture.sh');
  roles.application_log_collector = {
    role: 'application_log_collector',
    pid: appProcs[0]?.pid ?? null,
    process_count: appProcs.length,
    output_path: appLog,
    last_output_age_ms: fileAgeMs(appLog),
    freshness_threshold_ms: FRESHNESS_THRESHOLDS_MS.application_log,
    status:
      appProcs.length === 1 && fileAgeMs(appLog) <= FRESHNESS_THRESHOLDS_MS.application_log
        ? 'ACTIVE'
        : 'STALE',
  };

  const monitorProcs = processes.filter((p) => p.command?.includes('phase32h-monitor-targeted-reproduction.sh'));
  const monitorLog = path.join(outRoot, 'phase32h-monitor.log');
  const monitorThreshold = monitorIntervalMs + FRESHNESS_THRESHOLDS_MS.monitor_extra;
  roles.matrix_monitor = {
    role: 'matrix_monitor',
    pid: monitorProcs[0]?.pid ?? null,
    process_count: monitorProcs.length,
    output_path: monitorLog,
    last_output_age_ms: fileAgeMs(monitorLog),
    freshness_threshold_ms: monitorThreshold,
    status:
      monitorProcs.length >= 1 && fileAgeMs(monitorLog) <= monitorThreshold ? 'ACTIVE' : 'STALE',
  };

  if (pcapIdentity.failure_class === PCAP_FAILURE_CLASS.FOREIGN_PHASE32H_PCAP_PROCESS) {
    // classified below; supervisor writes immutable marker after grace period
  } else if (pcapIdentity.failure_class === PCAP_FAILURE_CLASS.DUPLICATE_PCAP_PROCESS_SAME_ROOT) {
    // classified below; supervisor writes immutable marker after grace period
  }

  const unhealthy = Object.values(roles).filter((r) => {
    if (tripletMode && (r.role?.endsWith('_runner') || r.role === 'matrix_monitor')) return false;
    if (!probesActive && (r.role?.endsWith('_runner') || r.role === 'pcap_collector')) {
      return false;
    }
    if (opts.smokeMode) {
      if (r.role === 'matrix_monitor') return false;
      if (r.status === 'QUIET' || r.status === 'FINISHED') return false;
    }
    return r.status === 'STALE' || r.status === 'MISSING';
  });

  const foreignBlocked = pcapIdentity.failure_class === PCAP_FAILURE_CLASS.FOREIGN_PHASE32H_PCAP_PROCESS;
  const duplicateBlocked = pcapIdentity.failure_class === PCAP_FAILURE_CLASS.DUPLICATE_PCAP_PROCESS_SAME_ROOT;

  return {
    generated_at: new Date().toISOString(),
    out_root: outRoot,
    probes_active: probesActive,
    roles,
    overall_status: unhealthy.length || foreignBlocked || duplicateBlocked ? 'BLOCKED' : 'ACTIVE',
    unhealthy_roles: unhealthy.map((r) => r.role),
    pcap_failure_class: pcapIdentity.failure_class,
    foreign_blocked: foreignBlocked,
    duplicate_blocked: duplicateBlocked,
    pcap_status: readJsonFileResilient(pcapStatus, { fallback: null }),
  };
}

export function pcapCoverageIsComplete(health, { probesActive = true } = {}) {
  if (!probesActive) return true;
  if (health.foreign_blocked || health.duplicate_blocked) return false;
  const pcap = health.roles?.pcap_collector;
  if (!pcap || pcap.status !== 'ACTIVE') return false;
  return pcap.process_count === 1 && pcap.failure_class === PCAP_FAILURE_CLASS.ACTIVE;
}

export function assertCollectorCoverageOrBlock(outRoot, health, reasonPrefix = 'mandatory collector unhealthy') {
  if (health.foreign_blocked || health.duplicate_blocked) {
    return {
      ...health,
      blocked: true,
      block_reason: health.pcap_failure_class,
    };
  }
  if (health.overall_status === 'ACTIVE') return health;
  const pcap = health.roles?.pcap_collector;
  const reason =
    pcap?.failure_class && pcap.failure_class !== PCAP_FAILURE_CLASS.ACTIVE
      ? `${reasonPrefix}: pcap_collector (${pcap.failure_class})`
      : `${reasonPrefix}: ${health.unhealthy_roles.join(', ')}`;
  markCoverageBlocked(outRoot, reason);
  return { ...health, blocked: true, block_reason: reason };
}

export function writeSupervisorHeartbeat(outRoot, health) {
  const file = path.join(outRoot, 'run-state/collector-supervisor.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify({ ...health, supervisor_pid: process.pid, heartbeat_at: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );
}

export function readSupervisorHeartbeat(outRoot) {
  const file = path.join(outRoot, 'run-state/collector-supervisor.json');
  return readJsonFileResilient(file, { fallback: null });
}

export function supervisorHeartbeatAgeMs(outRoot) {
  const hb = readSupervisorHeartbeat(outRoot);
  if (!hb?.heartbeat_at) return Number.POSITIVE_INFINITY;
  return ageFromIso(hb.heartbeat_at);
}
