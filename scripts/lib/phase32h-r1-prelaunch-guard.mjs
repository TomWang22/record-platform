/**
 * Phase 32H-R1 — prelaunch guard checks (source + runtime markers).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { R1_BASELINE_ROOT, R1_PROTECTED_ROOT, R1_TOTAL } from './phase32h-r1-config.mjs';
import { LIFECYCLE_MINI_MATRIX_PER_ARM } from './phase32h-triplet-manifest.mjs';
import { mainMatrixUsesTripletOrchestrator } from './phase32h-triplet-orchestrator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

export const PHASE32H_R1T_STATUS = {
  PASS: 'PASS',
  BLOCKED: 'BLOCKED',
};

export function assertTmpEvidenceRoot(root) {
  if (!root.startsWith('/tmp/')) {
    throw new Error(`evidence root must be under /tmp: ${root}`);
  }
}

export function checkR1RootsEmpty() {
  const violations = [];
  for (const root of [R1_BASELINE_ROOT, R1_PROTECTED_ROOT]) {
    if (fs.existsSync(root) && fs.readdirSync(root).length > 0) {
      const hasApprovedLaunch = fs.existsSync(path.join(root, 'phase32h-r1-launch.json'));
      if (!hasApprovedLaunch) {
        violations.push(`R1 root not empty before approved launch: ${root}`);
      }
    }
  }
  return violations;
}

export function checkTripletRunnerWired() {
  const launchScript = path.join(REPO_ROOT, 'scripts/phase32h-launch-r1-arm.mjs');
  if (!fs.existsSync(launchScript)) return ['launch script missing'];
  if (!mainMatrixUsesTripletOrchestrator(launchScript)) {
    return ['launch script does not wire triplet runner / prelaunch guard'];
  }
  const runner = path.join(REPO_ROOT, 'scripts/phase32h-r1-triplet-runner.mjs');
  if (!fs.existsSync(runner)) return ['triplet runner script missing'];
  const text = fs.readFileSync(runner, 'utf8');
  if (!text.includes('executeTripletBatch') || !text.includes('groupManifestIntoTriplets')) {
    return ['triplet runner missing orchestrator imports'];
  }
  return [];
}

export function checkLifecyclePreflightWired() {
  const launchScript = path.join(REPO_ROOT, 'scripts/phase32h-launch-r1-arm.mjs');
  const text = fs.readFileSync(launchScript, 'utf8');
  const violations = [];
  if (!text.includes('runBaselineLaunchPreflight')) {
    violations.push('arm launcher missing ordered baseline launch preflight');
  }
  const preflightLib = path.join(REPO_ROOT, 'scripts/lib/phase32h-baseline-launch-preflight.mjs');
  if (!fs.existsSync(preflightLib)) {
    violations.push('baseline launch preflight module missing');
  }
  return violations;
}

export function checkContinuousPcapModel() {
  const script = path.join(REPO_ROOT, 'scripts/phase32h-start-pcap-capture.sh');
  const text = fs.readFileSync(script, 'utf8');
  const violations = [];
  if (!/ring/i.test(text) && !/ring_files/i.test(text)) {
    violations.push('pcap capture script missing ring buffer config');
  }
  return violations;
}

export function checkDiskPreflightWired() {
  const launchScript = path.join(REPO_ROOT, 'scripts/phase32h-launch-r1-arm.mjs');
  const text = fs.readFileSync(launchScript, 'utf8');
  const violations = [];
  if (!text.includes('runBaselineLaunchPreflight')) {
    violations.push('arm launcher missing ordered baseline launch preflight');
  }
  const diskLib = path.join(REPO_ROOT, 'scripts/lib/phase32h-disk-preflight.mjs');
  if (!fs.existsSync(diskLib)) {
    violations.push('disk preflight module missing');
  } else {
    const diskText = fs.readFileSync(diskLib, 'utf8');
    if (!diskText.includes('DISK_HARD_MIN_BYTES =\n  DISK_PROJECTED_FOOTPRINT_BYTES + DISK_OPERATIONAL_UNCERTAINTY_BYTES')) {
      if (!diskText.includes('47 * 1024 ** 3') && !diskText.includes('DISK_OPERATIONAL_UNCERTAINTY_BYTES')) {
        violations.push('disk hard minimum must include 47 GB operational reserve');
      }
    }
  }
  const preflightLib = path.join(REPO_ROOT, 'scripts/lib/phase32h-baseline-launch-preflight.mjs');
  if (!fs.existsSync(preflightLib)) {
    violations.push('baseline launch preflight module missing');
  }
  return violations;
}

export function checkCiApprovalWired() {
  const violations = [];
  const ciLib = path.join(REPO_ROOT, 'scripts/lib/phase32h-ci-approval.mjs');
  const launcher = path.join(REPO_ROOT, 'scripts/phase32h-launch-r1-arm.mjs');
  const generator = path.join(REPO_ROOT, 'scripts/phase32h-generate-ci-approval.mjs');
  if (!fs.existsSync(ciLib)) violations.push('CI approval module missing');
  if (!fs.existsSync(generator)) violations.push('CI approval generator missing');
  const text = fs.readFileSync(launcher, 'utf8');
  if (!text.includes('runBaselineLaunchPreflight')) {
    violations.push('launcher must use runBaselineLaunchPreflight before root creation');
  }
  const integrity = path.join(REPO_ROOT, 'scripts/lib/phase32h-run-integrity.mjs');
  const integrityText = fs.readFileSync(integrity, 'utf8');
  if (!integrityText.includes('R1_FORBIDDEN_BASELINE_ROOTS')) {
    violations.push('forbidden baseline roots must be centralized');
  }
  return violations;
}

export function checkPerProbePacketIndexWired() {
  const violations = [];
  const orchestrator = path.join(REPO_ROOT, 'scripts/lib/phase32h-triplet-orchestrator.mjs');
  const runner = path.join(REPO_ROOT, 'scripts/phase32h-r1-triplet-runner.mjs');
  const orchText = fs.readFileSync(orchestrator, 'utf8');
  const runnerText = fs.readFileSync(runner, 'utf8');
  if (!orchText.includes('writeTripletProbePacketIndexes')) {
    violations.push('triplet orchestrator missing per-probe packet index writer');
  }
  if (!runnerText.includes('assertPacketIndexCoverage')) {
    violations.push('triplet runner missing packet index coverage gate');
  }
  const baselinePreflight = path.join(REPO_ROOT, 'scripts/phase32h-baseline-preflight-readonly.mjs');
  if (!fs.existsSync(baselinePreflight)) {
    violations.push('baseline preflight readonly script missing');
  }
  return violations;
}

export function checkEsmCloseoutTooling() {
  const violations = [];
  for (const script of [
    'scripts/phase32h-baseline-preflight-readonly.mjs',
    'scripts/phase32h-pcap-stats-readonly.mjs',
  ]) {
    if (!fs.existsSync(path.join(REPO_ROOT, script))) {
      violations.push(`missing committed ESM closeout CLI: ${script}`);
    }
  }
  return violations;
}

export function checkLifecycleTotalsSeparate() {
  if (LIFECYCLE_MINI_MATRIX_PER_ARM >= R1_TOTAL) {
    return ['lifecycle mini-matrix not excluded from main totals'];
  }
  return [];
}

export function checkSmokeReportContradictions(smokeReport) {
  const violations = [];
  if (!smokeReport) return violations;
  const caps = smokeReport.capabilities || {};
  if (caps.zero_rtt_client_support === 'CLIENT_BACKEND_ZERO_RTT_UNSUPPORTED') {
    for (const [key, row] of Object.entries(smokeReport.results || {})) {
      if (row.zero_rtt_observed === true || (row.zero_rtt > 0 && key === 'attempted_0rtt')) {
        violations.push(`classifier contradiction: ${key} reports zero_rtt while client unsupported`);
      }
      if (row.classifier_contradiction) {
        violations.push(`classifier contradiction flagged in ${key}`);
      }
    }
  }
  if (smokeReport.classifier_contradiction) {
    violations.push('smoke report classifier_contradiction=true');
  }
  return violations;
}

export function evaluatePrelaunchGuard(opts = {}) {
  const violations = [
    ...checkR1RootsEmpty(),
    ...checkTripletRunnerWired(),
    ...checkLifecyclePreflightWired(),
    ...checkContinuousPcapModel(),
    ...checkLifecycleTotalsSeparate(),
    ...checkDiskPreflightWired(),
    ...checkCiApprovalWired(),
    ...checkPerProbePacketIndexWired(),
    ...checkEsmCloseoutTooling(),
  ];

  if (opts.smokeReport) {
    violations.push(...checkSmokeReportContradictions(opts.smokeReport));
  }

  if (opts.productionEnablement && opts.productionEnablement !== 'NOT APPROVED') {
    violations.push('production enablement must remain NOT APPROVED');
  }

  return {
    phase: '32H-R1-T',
    status: violations.length ? PHASE32H_R1T_STATUS.BLOCKED : PHASE32H_R1T_STATUS.PASS,
    violations,
    triplet_runner_wired: checkTripletRunnerWired().length === 0,
    lifecycle_mini_matrix_wired: checkLifecyclePreflightWired().length === 0,
    production_enablement: 'NOT APPROVED',
  };
}
