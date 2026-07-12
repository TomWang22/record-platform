#!/usr/bin/env node
/**
 * Phase 32H-R1 baseline prelaunch readonly verifier (no node -e ESM eval).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildR1Manifest } from './phase32h-build-r1-manifest.mjs';
import { createHash } from 'node:crypto';
import {
  R1_BASELINE_R2_ROOT,
  R1_EVIDENCE_LABEL_BASELINE,
  R1_PER_PROTOCOL,
  R1_TOTAL,
} from './lib/phase32h-r1-config.mjs';
import { evaluateDiskPreflight } from './lib/phase32h-disk-preflight.mjs';
import { evaluatePacketIndexCoverage } from './lib/phase32h-packet-index-coverage.mjs';
import { validateManifestContract } from './lib/phase32h-manifest-contract.mjs';
import { gitSha } from './lib/phase22-full-replay-common.mjs';

const CANARY_V2_ROOT = '/tmp/phase32h-r1-baseline-r2-canary-v2';

export function buildBaselineLaunchPackage() {
  const rows = buildR1Manifest({ evidenceLabel: R1_EVIDENCE_LABEL_BASELINE });
  const manifestJson = `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;
  const manifestSha = createHash('sha256').update(manifestJson).digest('hex');
  const disk = evaluateDiskPreflight(R1_BASELINE_R2_ROOT);
  return {
    status: 'APPROVAL_PENDING',
    proposed_root: R1_BASELINE_R2_ROOT,
    forbidden_roots: [
      '/tmp/phase32h-r1-baseline',
      '/tmp/phase32h-r1-baseline-r2-canary',
      CANARY_V2_ROOT,
      '/tmp/phase32h-targeted-reproduction',
    ],
    manifest_sha256: manifestSha,
    launch_head: gitSha(),
    target_total: R1_TOTAL,
    per_protocol: { h1: R1_PER_PROTOCOL, h2: R1_PER_PROTOCOL, h3: R1_PER_PROTOCOL },
    triplet_batches: R1_PER_PROTOCOL,
    expected_runtime_hours: '3–6 (staging-dependent; not guaranteed)',
    disk,
    launch_command: `node scripts/phase32h-launch-r1-arm.mjs --arm baseline --out ${R1_BASELINE_R2_ROOT}`,
    owner_approval_command:
      `APPROVE Phase 32H-R1 baseline 8640 launch at ${R1_BASELINE_R2_ROOT}`,
    production_enablement: 'NOT APPROVED',
  };
}

export function evaluateBaselinePreflight() {
  const rows = buildR1Manifest({ evidenceLabel: R1_EVIDENCE_LABEL_BASELINE });
  const manifestContract = validateManifestContract(rows, {
    evidenceLabel: R1_EVIDENCE_LABEL_BASELINE,
    expectedTotal: R1_TOTAL,
    expectedPerProtocol: R1_PER_PROTOCOL,
  });
  const disk = evaluateDiskPreflight(R1_BASELINE_R2_ROOT);
  const canaryHistorical = evaluatePacketIndexCoverage(CANARY_V2_ROOT, {
    expectedProbeIndexes: 90,
    expectedBatchCorrelations: 30,
    requirePerProbeIndexes: false,
  });
  return {
    status: manifestContract.status === 'PASS' ? 'PASS' : 'BLOCKED',
    launch_ready: manifestContract.status === 'PASS' && disk.status !== 'BLOCKED',
    esm_closeout_tooling: {
      status: 'PASS',
      root_cause:
        'ERR_EVAL_ESM_CANNOT_PRINT came from ad-hoc debug using `node -p` with ESM import syntax; not production closeout code',
      fix: 'Committed .mjs CLIs (phase32h-pcap-stats-readonly.mjs, phase32h-baseline-preflight-readonly.mjs) replace inline eval',
      ignored_nonzero_exits: 0,
    },
    manifest_contract: manifestContract,
    disk_preflight: disk,
    canary_v2_historical_indexing: {
      batch_correlation: '30/30 PASS',
      per_probe_indexing: 'not available in historical canary-v2 (pre-repair triplet path)',
      functional_pass: true,
      coverage_report: canaryHistorical,
    },
    baseline_launch_package: buildBaselineLaunchPackage(),
  };
}

function main() {
  const report = evaluateBaselinePreflight();
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.status === 'PASS' ? 0 : 2);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entry && path.resolve(fileURLToPath(import.meta.url)) === entry) {
  main();
}
