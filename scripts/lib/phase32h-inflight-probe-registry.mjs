/**
 * Phase 32H — atomic in-flight probe registry for watchdog diagnostics.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  FORBIDDEN_INFLIGHT_FIELDS,
  PHASE32H_EVIDENCE_LABEL,
} from './phase32h-targeted-reproduction-config.mjs';

export class Phase32hInflightRegistryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'Phase32hInflightRegistryError';
  }
}

export function inflightDir(outRoot) {
  return path.join(outRoot, 'inflight');
}

export function inflightPath(outRoot, protocol) {
  return path.join(inflightDir(outRoot), `${protocol}.json`);
}

export function assertRedactedInflightRecord(record) {
  const text = JSON.stringify(record).toLowerCase();
  for (const field of FORBIDDEN_INFLIGHT_FIELDS) {
    if (text.includes(`"${field.toLowerCase()}"`)) {
      throw new Phase32hInflightRegistryError(`forbidden inflight field: ${field}`);
    }
  }
  if (/\beyj[a-z0-9]/i.test(text)) {
    throw new Phase32hInflightRegistryError('jwt-like token in inflight record');
  }
}

export function buildInflightRecord(probe, { runnerPid, shardRestartCount = 0 } = {}) {
  const record = {
    probe_id: probe.probe_id,
    protocol: probe.protocol_label || probe.matrix_protocol,
    case_id: probe.case_id,
    window: probe.window,
    run: probe.run,
    user_class: probe.user_class,
    expected_gate: probe.expected_gate_reason,
    probe_started_at: new Date().toISOString(),
    monotonic_started_ms: Date.now(),
    runner_pid: runnerPid ?? process.pid,
    shard_restart_count: shardRestartCount ?? 0,
    evidence_label: probe.evidence_label || PHASE32H_EVIDENCE_LABEL,
    status: 'in_flight',
  };
  assertRedactedInflightRecord(record);
  return record;
}

export function atomicWriteJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

export function registerInflight(outRoot, protocolKey, record) {
  assertRedactedInflightRecord(record);
  atomicWriteJson(inflightPath(outRoot, protocolKey), record);
}

export function completeInflight(outRoot, protocolKey, extra = {}) {
  const file = inflightPath(outRoot, protocolKey);
  if (!fs.existsSync(file)) return null;
  const current = JSON.parse(fs.readFileSync(file, 'utf8'));
  const completed = {
    ...current,
    ...extra,
    status: 'completed',
    probe_finished_at: new Date().toISOString(),
    monotonic_finished_ms: Date.now(),
  };
  atomicWriteJson(file, completed);
  const archiveDir = path.join(outRoot, 'inflight', 'archive');
  fs.mkdirSync(archiveDir, { recursive: true });
  const archivePath = path.join(
    archiveDir,
    `${protocolKey}-${completed.probe_id}-${Date.now()}.json`,
  );
  fs.renameSync(file, archivePath);
  return { completed, archivePath };
}

export function readAllInflight(outRoot) {
  const dir = inflightDir(outRoot);
  if (!fs.existsSync(dir)) return [];
  const rows = [];
  for (const ent of fs.readdirSync(dir)) {
    if (!ent.endsWith('.json')) continue;
    const p = path.join(dir, ent);
    try {
      rows.push(JSON.parse(fs.readFileSync(p, 'utf8')));
    } catch {
      /* skip corrupt */
    }
  }
  return rows;
}

export function elapsedMs(record, nowMs = Date.now()) {
  if (!record?.monotonic_started_ms) return 0;
  return Math.max(0, nowMs - record.monotonic_started_ms);
}
