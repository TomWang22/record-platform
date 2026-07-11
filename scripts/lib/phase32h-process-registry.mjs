/**
 * Phase 32H-R1 — explicit process registration for collector supervision.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PROCESS_ROLES = [
  'triplet_orchestrator',
  'collector_supervisor',
  'matrix_monitor',
  'extreme_watchdog',
  'pcap_collector',
  'gateway_log_collector',
  'application_log_collector',
  'host_telemetry_collector',
  'power_telemetry_collector',
];

export function processRegistryDir(outRoot) {
  return path.join(outRoot, 'run-state', 'processes');
}

export function commandHash(command) {
  return crypto.createHash('sha256').update(String(command || '')).digest('hex').slice(0, 16);
}

export function registerProcess(outRoot, role, record) {
  if (!PROCESS_ROLES.includes(role)) {
    throw new Error(`unknown process role: ${role}`);
  }
  const dir = processRegistryDir(outRoot);
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    run_id: record.run_id,
    role,
    pid: record.pid,
    parent_pid: record.parent_pid ?? process.ppid,
    started_at: record.started_at || new Date().toISOString(),
    heartbeat_path: record.heartbeat_path || null,
    expected_command_hash: record.expected_command_hash || commandHash(record.command),
    launch_head: record.launch_head,
    manifest_sha: record.manifest_sha,
    evidence_root: outRoot,
    state: record.state || 'STARTING',
    command: record.command,
  };
  fs.writeFileSync(path.join(dir, `${role}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

export function readProcessRegistration(outRoot, role) {
  const file = path.join(processRegistryDir(outRoot), `${role}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function updateProcessState(outRoot, role, state) {
  const current = readProcessRegistration(outRoot, role);
  if (!current) return null;
  current.state = state;
  current.updated_at = new Date().toISOString();
  fs.writeFileSync(
    path.join(processRegistryDir(outRoot), `${role}.json`),
    `${JSON.stringify(current, null, 2)}\n`,
    'utf8',
  );
  return current;
}

export function pidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
