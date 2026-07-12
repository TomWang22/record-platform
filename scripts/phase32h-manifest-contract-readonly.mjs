#!/usr/bin/env node
/**
 * Read-only Phase 32H manifest contract verifier for CI/prelaunch.
 */
import { buildR1CanaryManifest, buildR1Manifest } from './phase32h-build-r1-manifest.mjs';
import {
  R1_CANARY_PER_PROTOCOL,
  R1_CANARY_TOTAL,
  R1_EVIDENCE_LABEL_BASELINE,
  R1_EVIDENCE_LABEL_CANARY,
  R1_PER_PROTOCOL,
  R1_TOTAL,
} from './lib/phase32h-r1-config.mjs';
import { assertManifestContract } from './lib/phase32h-manifest-contract.mjs';
import { buildRepairSmokeManifest } from './lib/phase32h-repair-smoke-manifest.mjs';

function main() {
  assertManifestContract(buildR1Manifest({ evidenceLabel: R1_EVIDENCE_LABEL_BASELINE }), {
    evidenceLabel: R1_EVIDENCE_LABEL_BASELINE,
    expectedTotal: R1_TOTAL,
    expectedPerProtocol: R1_PER_PROTOCOL,
  });
  assertManifestContract(buildR1CanaryManifest({ evidenceLabel: R1_EVIDENCE_LABEL_CANARY }), {
    evidenceLabel: R1_EVIDENCE_LABEL_CANARY,
    expectedTotal: R1_CANARY_TOTAL,
    expectedPerProtocol: R1_CANARY_PER_PROTOCOL,
  });
  const repair = buildRepairSmokeManifest();
  assertManifestContract(repair.rows, {
    evidenceLabel: repair.evidence_label,
    expectedTotal: repair.target_total,
    expectedPerProtocol: repair.target_per_protocol,
  });
  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        r1_total: R1_TOTAL,
        canary_total: R1_CANARY_TOTAL,
        repair_total: repair.target_total,
      },
      null,
      2,
    ),
  );
}

main();
