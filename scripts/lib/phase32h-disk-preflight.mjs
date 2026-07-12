/**
 * Phase 32H-R1 — baseline disk capacity preflight gates.
 */
import fs from 'node:fs';
import path from 'node:path';

export const DISK_EVIDENCE_BUDGET_BYTES = 15 * 1024 ** 3;
export const DISK_PCAP_RING_BUDGET_BYTES = 12 * 1024 ** 3;
export const DISK_EXECUTION_SAFETY_MARGIN_BYTES = 10 * 1024 ** 3;
export const DISK_OPERATIONAL_UNCERTAINTY_BYTES = 10 * 1024 ** 3;
export const DISK_PROJECTED_FOOTPRINT_BYTES =
  DISK_EVIDENCE_BUDGET_BYTES + DISK_PCAP_RING_BUDGET_BYTES + DISK_EXECUTION_SAFETY_MARGIN_BYTES;
export const DISK_HARD_MIN_BYTES =
  DISK_PROJECTED_FOOTPRINT_BYTES + DISK_OPERATIONAL_UNCERTAINTY_BYTES;
export const DISK_PREFERRED_MIN_BYTES = 50 * 1024 ** 3;
export const DISK_WORST_CASE_COMBINED_BYTES = DISK_PROJECTED_FOOTPRINT_BYTES;

/** @deprecated use DISK_HARD_MIN_BYTES (47 GB) */
export const DISK_LEGACY_HARD_MIN_BYTES = 40 * 1024 ** 3;

export function resolveFilesystemTarget(targetPath) {
  const resolved = path.resolve(targetPath);
  const parent = fs.existsSync(resolved) ? resolved : path.dirname(resolved);
  return parent;
}

export function statfsFreeBytes(targetPath) {
  const target = resolveFilesystemTarget(targetPath);
  const out = fs.statfsSync(target);
  return Number(out.bavail) * Number(out.bsize);
}

export function evaluateDiskPreflightFromBytes(freeBytes, options = {}) {
  const {
    hardMinBytes = DISK_HARD_MIN_BYTES,
    preferredMinBytes = DISK_PREFERRED_MIN_BYTES,
    projectedEvidenceBytes = DISK_EVIDENCE_BUDGET_BYTES,
    projectedPcapBytes = DISK_PCAP_RING_BUDGET_BYTES,
    safetyMarginBytes = DISK_EXECUTION_SAFETY_MARGIN_BYTES,
    operationalUncertaintyBytes = DISK_OPERATIONAL_UNCERTAINTY_BYTES,
  } = options;
  const projectedFootprint = projectedEvidenceBytes + projectedPcapBytes + safetyMarginBytes;
  const projectedRemaining = freeBytes - projectedFootprint;
  const launchReady =
    freeBytes >= hardMinBytes && projectedRemaining >= operationalUncertaintyBytes;
  const status = !launchReady
    ? 'BLOCKED'
    : freeBytes < preferredMinBytes
      ? 'WARN'
      : 'PASS';
  return {
    status,
    launch_ready: launchReady,
    free_bytes: freeBytes,
    hard_minimum_bytes: hardMinBytes,
    preferred_minimum_bytes: preferredMinBytes,
    projected_evidence_bytes: projectedEvidenceBytes,
    projected_pcap_bytes: projectedPcapBytes,
    safety_margin_bytes: safetyMarginBytes,
    operational_uncertainty_bytes: operationalUncertaintyBytes,
    projected_footprint_bytes: projectedFootprint,
    projected_remaining_bytes: projectedRemaining,
    execution_block_threshold_bytes: operationalUncertaintyBytes,
    disk_reserve_violation:
      !launchReady && projectedRemaining < operationalUncertaintyBytes,
  };
}

export function evaluateDiskPreflight(targetPath, {
  hardMinBytes = DISK_HARD_MIN_BYTES,
  preferredMinBytes = DISK_PREFERRED_MIN_BYTES,
  projectedEvidenceBytes = DISK_EVIDENCE_BUDGET_BYTES,
  projectedPcapBytes = DISK_PCAP_RING_BUDGET_BYTES,
  safetyMarginBytes = DISK_EXECUTION_SAFETY_MARGIN_BYTES,
  operationalUncertaintyBytes = DISK_OPERATIONAL_UNCERTAINTY_BYTES,
} = {}) {
  const target = resolveFilesystemTarget(targetPath);
  const statfs = fs.statfsSync(target);
  const freeBytes = Number(statfs.bavail) * Number(statfs.bsize);
  const totalBytes = Number(statfs.blocks) * Number(statfs.bsize);
  const usedBytes = totalBytes - freeBytes;
  const projectedFootprint = projectedEvidenceBytes + projectedPcapBytes + safetyMarginBytes;
  const projectedRemaining = freeBytes - projectedFootprint;
  const launchReady =
    freeBytes >= hardMinBytes && projectedRemaining >= operationalUncertaintyBytes;
  const status = !launchReady
    ? 'BLOCKED'
    : freeBytes < preferredMinBytes
      ? 'WARN'
      : 'PASS';
  return {
    status,
    launch_ready: launchReady,
    filesystem: target,
    free_bytes: freeBytes,
    total_bytes: totalBytes,
    used_bytes: usedBytes,
    hard_minimum_bytes: hardMinBytes,
    preferred_minimum_bytes: preferredMinBytes,
    projected_evidence_bytes: projectedEvidenceBytes,
    projected_pcap_bytes: projectedPcapBytes,
    safety_margin_bytes: safetyMarginBytes,
    operational_uncertainty_bytes: operationalUncertaintyBytes,
    projected_footprint_bytes: projectedFootprint,
    projected_remaining_bytes: projectedRemaining,
    execution_block_threshold_bytes: operationalUncertaintyBytes,
    disk_reserve_violation:
      !launchReady && projectedRemaining < operationalUncertaintyBytes,
  };
}

export function assertDiskPreflight(targetPath, options = {}) {
  const report = evaluateDiskPreflight(targetPath, options);
  if (!report.launch_ready || report.status === 'BLOCKED') {
    const err = new Error(`disk preflight BLOCKED: ${JSON.stringify(report)}`);
    err.code = 'PHASE32H_DISK_RESERVE_BLOCKED';
    err.report = report;
    throw err;
  }
  return report;
}

export function assertDiskExecutionReserve(targetPath, options = {}) {
  const report = evaluateDiskPreflight(targetPath, options);
  if (report.projected_remaining_bytes < report.execution_block_threshold_bytes) {
    const err = new Error(`disk execution reserve BLOCKED: ${JSON.stringify(report)}`);
    err.code = 'PHASE32H_DISK_RESERVE_BLOCKED';
    err.report = report;
    throw err;
  }
  return report;
}
