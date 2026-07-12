/**
 * Phase 32H-R1 — baseline disk capacity preflight gates.
 */
import fs from 'node:fs';
import path from 'node:path';

export const DISK_HARD_MIN_BYTES = 40 * 1024 ** 3;
export const DISK_PREFERRED_MIN_BYTES = 50 * 1024 ** 3;
export const DISK_EXECUTION_SAFETY_MARGIN_BYTES = 10 * 1024 ** 3;
export const DISK_PCAP_RING_BUDGET_BYTES = 12 * 1024 ** 3;
export const DISK_EVIDENCE_BUDGET_BYTES = 15 * 1024 ** 3;
export const DISK_WORST_CASE_COMBINED_BYTES =
  DISK_PCAP_RING_BUDGET_BYTES + DISK_EVIDENCE_BUDGET_BYTES + DISK_EXECUTION_SAFETY_MARGIN_BYTES;

export function resolveFilesystemTarget(targetPath) {
  const resolved = path.resolve(targetPath);
  const parent = fs.existsSync(resolved)
    ? resolved
    : path.dirname(resolved);
  return parent;
}

export function statfsFreeBytes(targetPath) {
  const target = resolveFilesystemTarget(targetPath);
  const out = fs.statfsSync(target);
  return Number(out.bavail) * Number(out.bsize);
}

export function evaluateDiskPreflight(targetPath, {
  hardMinBytes = DISK_HARD_MIN_BYTES,
  preferredMinBytes = DISK_PREFERRED_MIN_BYTES,
  projectedEvidenceBytes = DISK_EVIDENCE_BUDGET_BYTES,
  projectedPcapBytes = DISK_PCAP_RING_BUDGET_BYTES,
  safetyMarginBytes = DISK_EXECUTION_SAFETY_MARGIN_BYTES,
} = {}) {
  const target = resolveFilesystemTarget(targetPath);
  const statfs = fs.statfsSync(target);
  const freeBytes = Number(statfs.bavail) * Number(statfs.bsize);
  const totalBytes = Number(statfs.blocks) * Number(statfs.bsize);
  const usedBytes = totalBytes - freeBytes;
  const projectedFootprint = projectedEvidenceBytes + projectedPcapBytes + safetyMarginBytes;
  const projectedRemaining = freeBytes - projectedFootprint;
  const status =
    freeBytes < hardMinBytes || projectedRemaining < 0
      ? 'BLOCKED'
      : freeBytes < preferredMinBytes
        ? 'WARN'
        : 'PASS';
  return {
    status,
    filesystem: target,
    free_bytes: freeBytes,
    total_bytes: totalBytes,
    used_bytes: usedBytes,
    hard_minimum_bytes: hardMinBytes,
    preferred_minimum_bytes: preferredMinBytes,
    projected_evidence_bytes: projectedEvidenceBytes,
    projected_pcap_bytes: projectedPcapBytes,
    safety_margin_bytes: safetyMarginBytes,
    projected_footprint_bytes: projectedFootprint,
    projected_remaining_bytes: projectedRemaining,
    execution_block_threshold_bytes: safetyMarginBytes,
  };
}

export function assertDiskPreflight(targetPath, options = {}) {
  const report = evaluateDiskPreflight(targetPath, options);
  if (report.status === 'BLOCKED') {
    const err = new Error(`disk preflight BLOCKED: ${JSON.stringify(report)}`);
    err.code = 'PHASE32H_DISK_PREFLIGHT_BLOCKED';
    err.report = report;
    throw err;
  }
  return report;
}
