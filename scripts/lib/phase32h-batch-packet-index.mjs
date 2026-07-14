/**
 * Phase 32H-R1 — batch-level packet correlation index.
 */
import fs from 'node:fs';
import path from 'node:path';

export function batchIndexDir(outRoot) {
  return path.join(outRoot, 'batch-packet-index');
}

export function batchIndexPath(outRoot, batchId) {
  return path.join(batchIndexDir(outRoot), `${batchId}.json`);
}

export function readBatchPacketIndex(outRoot, batchId) {
  const file = batchIndexPath(outRoot, batchId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function listBatchPacketIndexes(outRoot) {
  const dir = batchIndexDir(outRoot);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const file = path.join(dir, name);
      return { file, batch_id: name.replace(/\.json$/, ''), record: JSON.parse(fs.readFileSync(file, 'utf8')) };
    });
}

export function writeBatchPacketIndex(outRoot, record) {
  const dir = batchIndexDir(outRoot);
  fs.mkdirSync(dir, { recursive: true });
  const file = batchIndexPath(outRoot, record.batch_id);
  const status = record.packet_correlation_status || 'PENDING';
  const payload = {
    batch_id: record.batch_id,
    run_id: record.run_id,
    member_probe_ids: record.member_probe_ids,
    shared_case_id: record.coordinate?.case_id,
    shared_window: record.coordinate?.window,
    shared_run: record.coordinate?.run,
    shared_user_uid: record.coordinate?.user_uid,
    shared_user_class: record.coordinate?.user_class,
    start_spread_ms: record.start_spread_ms,
    batch_timing_status: record.batch_timing_status,
    packet_correlation_status: status,
    capture_interval: record.capture_interval || null,
    pcap_files: record.pcap_files || [],
    tcp_stream_ids: record.tcp_stream_ids || [],
    udp_stream_ids: record.udp_stream_ids || [],
    collector_health: record.collector_health || null,
    packet_drops: record.packet_drops ?? 0,
    protocol_verification: record.protocol_verification || null,
    synchronized_extreme_status: record.synchronized_extreme_status || 'NONE',
    overall_correlation_status: record.overall_correlation_status || status,
    generated_at: new Date().toISOString(),
  };
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

/**
 * Atomic rewrite of an existing batch index (lifecycle transitions).
 */
export function updateBatchPacketIndex(outRoot, batchId, patch = {}) {
  const existing = readBatchPacketIndex(outRoot, batchId);
  if (!existing) {
    throw new Error(`batch packet index not found: ${batchId}`);
  }
  const file = batchIndexPath(outRoot, batchId);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const status = patch.packet_correlation_status || existing.packet_correlation_status;
  const payload = {
    ...existing,
    ...patch,
    batch_id: existing.batch_id,
    packet_correlation_status: status,
    overall_correlation_status: patch.overall_correlation_status || status,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
  return payload;
}
