/**
 * Phase 33F target preflight — ordered gates before REAL_TARGET_ROOT creation.
 * NEVER creates the target root. Canary owner SHA env must never authorize target.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertCiApproval,
  assertSourceReconciliation,
} from './phase32h-ci-approval.mjs';
import { assertDiskPreflight } from './phase32h-disk-preflight.mjs';
import { assertCollectorExclusivityPreflight } from './phase32h-collector-exclusivity.mjs';
import {
  REAL_TARGET_ROOT,
  FROZEN_CANARY_V3_ROOT,
  TARGET,
  TARGET_APPROVAL_SHA_ENV,
  TARGET_APPROVAL_ROOT_ENV,
  LAUNCHER_SOURCE_GLOBS,
  EDGE_BASE_URL,
  EDGE_CA_CERT_REL,
} from './phase33f-canary-config.mjs';
import {
  assertTargetManifestPins,
  validateManifestRowsForMode,
  auditProductionMutationRows,
} from './phase33f-canary-manifest.mjs';
import {
  assertCleanLauncherSource,
  runOfflinePhaseVerify,
  runSemanticHoldoutVerify,
  assertCoverageSummary,
  defaultEdgeHealthCheck,
  defaultAuthSmoke,
  defaultQuicPcapPreflight,
  assertEvidenceRootAbsent,
  PRELAUNCH_BLOCKED_CODE as CANARY_PRELAUNCH_BLOCKED,
} from './phase33f-canary-preflight.mjs';
import { verifyFrozenCanaryV3 } from './phase33f-frozen-canary-v3.mjs';
import {
  INTER_BATCH_INTERVAL_MS,
  RATE_POLICY_VERSION,
  assertTargetInterBatchInterval,
} from './phase33f-rate-limit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

export const TARGET_PRELAUNCH_BLOCKED_CODE = 'PHASE33F_TARGET_PRELAUNCH_BLOCKED';

function blocked(message, details = {}) {
  const err = new Error(message);
  err.code = TARGET_PRELAUNCH_BLOCKED_CODE;
  err.details = details;
  return err;
}

export function assertTargetRootAbsent(root = REAL_TARGET_ROOT) {
  if (fs.existsSync(root)) {
    throw blocked(`target root must remain absent before launch: ${root}`, { root });
  }
  return { target_absent: true, root };
}

/**
 * Require dedicated target approval env vars. Canary approval must never authorize target.
 */
export function assertTargetOwnerApproval({
  headSha,
  outRoot,
  env = process.env,
  requireExactRoot = REAL_TARGET_ROOT,
} = {}) {
  const canarySha = env.PHASE33F_OWNER_LAUNCH_APPROVED_SHA || '';
  const approvedSha = env[TARGET_APPROVAL_SHA_ENV] || '';
  const approvedRoot = env[TARGET_APPROVAL_ROOT_ENV] || '';

  if (canarySha && !approvedSha) {
    throw blocked('canary approval cannot authorize target mode', {
      canary_env: 'PHASE33F_OWNER_LAUNCH_APPROVED_SHA',
      required_env: TARGET_APPROVAL_SHA_ENV,
    });
  }
  if (!approvedSha) {
    throw blocked(`missing ${TARGET_APPROVAL_SHA_ENV}`, { headSha });
  }
  if (approvedSha !== headSha) {
    throw blocked(`${TARGET_APPROVAL_SHA_ENV} mismatch`, {
      approvedSha,
      headSha,
    });
  }
  if (!approvedRoot) {
    throw blocked(`missing ${TARGET_APPROVAL_ROOT_ENV}`, { headSha });
  }
  if (approvedRoot !== requireExactRoot) {
    throw blocked(`${TARGET_APPROVAL_ROOT_ENV} mismatch`, {
      approvedRoot,
      requireExactRoot,
    });
  }
  if (outRoot !== approvedRoot) {
    throw blocked('out root must equal approved target root', {
      outRoot,
      approvedRoot,
    });
  }
  return {
    status: 'PASS',
    approved_sha: approvedSha,
    approved_root: approvedRoot,
  };
}

export function assertTargetModeAllowed(mode) {
  if (mode === 'soak' || mode === 'unknown' || mode == null) {
    throw blocked(`target launcher rejects mode=${mode}`);
  }
  if (mode !== 'target') {
    throw blocked(`target launcher only accepts mode=target, got ${mode}`);
  }
  return { mode };
}

export function assertNoTargetToSoakTransition(mode) {
  if (String(mode).includes('soak')) {
    throw blocked('no target-to-soak transition exists');
  }
}

export function assertTargetPacingPolicy({
  interBatchIntervalMs = TARGET.inter_batch_interval_ms,
  ratePolicyVersion = TARGET.rate_policy_version,
  catchUpBurst = false,
  protocolSerialization = false,
  dynamicIntervalReduction = false,
} = {}) {
  assertTargetInterBatchInterval(interBatchIntervalMs);
  if (ratePolicyVersion !== RATE_POLICY_VERSION) {
    throw blocked('target rate policy version mismatch', {
      ratePolicyVersion,
      expected: RATE_POLICY_VERSION,
    });
  }
  if (catchUpBurst) throw blocked('catch-up burst mode is forbidden for target');
  if (protocolSerialization) throw blocked('protocol serialization is forbidden for target');
  if (dynamicIntervalReduction) throw blocked('dynamic interval reduction is forbidden for target');
  if (interBatchIntervalMs < INTER_BATCH_INTERVAL_MS) {
    throw blocked('interval below 1000 ms blocks target');
  }
  return {
    status: 'PASS',
    inter_batch_interval_ms: interBatchIntervalMs,
    rate_policy_version: ratePolicyVersion,
  };
}

/**
 * Ordered target preflight. Leaves REAL_TARGET_ROOT absent on all paths.
 */
export function runPhase33fTargetPreflight(opts = {}) {
  const {
    out = REAL_TARGET_ROOT,
    mode = 'target',
    repoRoot = REPO_ROOT,
    skipCiApproval = false,
    skipOfflineVerify = false,
    skipCoverage = false,
    skipDiskPreflight = false,
    skipSourceReconciliation = false,
    skipSemantic = false,
    skipEdgeHealth = false,
    skipCollectorExclusivity = false,
    skipDirtySourceCheck = false,
    skipCanaryV3 = false,
    skipOwnerApproval = false,
    skipManifestPins = false,
    skipRateCapacityProof = false,
    headSha = null,
    originMainSha = null,
    approvalRecord = null,
    runAuthSmoke = defaultAuthSmoke,
    runQuicPcapPreflight = defaultQuicPcapPreflight,
    runEdgeHealth = defaultEdgeHealthCheck,
    assertCollectorExclusivity = assertCollectorExclusivityPreflight,
    rateCapacityProofPath = null,
    runtimeImagePin = null,
    limiterConfigHash = null,
    expectedRuntimeImagePin = null,
    expectedLimiterConfigHash = null,
    interBatchIntervalMs = TARGET.inter_batch_interval_ms,
    env = process.env,
  } = opts;

  try {
    assertTargetModeAllowed(mode);
    assertNoTargetToSoakTransition(mode);

    if (!out.startsWith('/tmp/')) throw blocked(`out must be under /tmp: ${out}`);

    // Gate 0 — target absent
    assertTargetRootAbsent(REAL_TARGET_ROOT);
    assertEvidenceRootAbsent(out);

    // Gate 1 — HEAD == origin/main
    let reconciled;
    if (skipSourceReconciliation) {
      reconciled = {
        headSha: headSha || 'test-head',
        originMainSha: originMainSha || headSha || 'test-head',
      };
    } else {
      try {
        reconciled = assertSourceReconciliation(repoRoot);
      } catch (err) {
        throw blocked(err.message, { cause_code: err.code });
      }
    }
    const { headSha: resolvedHead, originMainSha: resolvedOrigin } = reconciled;
    if (resolvedHead !== resolvedOrigin) {
      throw blocked(`HEAD ${resolvedHead} != origin/main ${resolvedOrigin}`);
    }

    // Gate 2 — dedicated target owner SHA + root (before CI / before mkdir)
    let ownerApproval = { status: 'SKIP' };
    if (!skipOwnerApproval) {
      ownerApproval = assertTargetOwnerApproval({
        headSha: resolvedHead,
        outRoot: out,
        env,
        requireExactRoot: REAL_TARGET_ROOT,
      });
    }

    // Gate 3 — exact-SHA CI approval
    if (!skipCiApproval) {
      try {
        assertCiApproval({
          headSha: resolvedHead,
          originMainSha: resolvedOrigin,
          approvalRecord,
        });
      } catch (err) {
        throw blocked(err.message, { cause_code: err.code, report: err.report });
      }
    }

    // Gate 4 — clean launcher source
    if (!(skipDirtySourceCheck || env.PHASE33F_ALLOW_DIRTY_LAUNCHER === '1')) {
      assertCleanLauncherSource(repoRoot, { globs: LAUNCHER_SOURCE_GLOBS });
    }

    // Gate 5 — Phase 33A–F
    if (!skipOfflineVerify) {
      runOfflinePhaseVerify(repoRoot);
    }

    // Gate 6 — semantic holdout
    if (!skipSemantic) {
      runSemanticHoldoutVerify(repoRoot);
    }

    // Gate 7 — coverage
    const coverage = skipCoverage
      ? { status: 'SKIP', reason: 'skipCoverage' }
      : assertCoverageSummary(repoRoot, { skipIfMissing: false });

    // Gate 8 — frozen canary-v3
    let canaryV3 = { status: 'SKIP' };
    if (!skipCanaryV3) {
      canaryV3 = verifyFrozenCanaryV3({ root: FROZEN_CANARY_V3_ROOT });
      if (canaryV3.writer_block) {
        throw blocked('canary-v3 still has root-scoped writer processes', canaryV3);
      }
    }

    // Gate 9–11 — regenerate + pin target manifest / workload hash
    let pin = null;
    let manifestValidation = null;
    if (!skipManifestPins) {
      try {
        pin = assertTargetManifestPins();
      } catch (err) {
        if (err.code === 'PHASE33F_TARGET_MANIFEST_PIN_MISMATCH') {
          throw blocked(err.message, err.details);
        }
        throw err;
      }
      manifestValidation = validateManifestRowsForMode(pin.rows, { mode: 'target' });
      if (manifestValidation.status !== 'PASS') {
        throw blocked('target manifest validation failed', {
          violations: manifestValidation.violations?.slice?.(0, 20) || manifestValidation,
        });
      }
      const audit = auditProductionMutationRows(pin.rows);
      if (audit.status !== 'PASS') {
        throw blocked('production mutation audit failed', audit);
      }
    }

    // Gate 13 — target still absent
    assertTargetRootAbsent(REAL_TARGET_ROOT);
    assertEvidenceRootAbsent(out);

    // Gate 14 — disk
    if (!skipDiskPreflight) {
      try {
        assertDiskPreflight(out);
      } catch (err) {
        throw blocked(err.message, { cause_code: err.code });
      }
    }

    // Gate 15 — collector exclusivity
    if (!skipCollectorExclusivity) {
      try {
        assertCollectorExclusivity({
          interface: env.PHASE32H_CAPTURE_IFACE || 'bridge100',
        });
      } catch (err) {
        throw blocked(err.message, { cause_code: err.code, details: err.details });
      }
    }

    // Gate 16 — pacing policy
    const pacing = assertTargetPacingPolicy({ interBatchIntervalMs });

    // Gate 17 — rate-capacity proof freshness (optional path; fail if required and stale/missing)
    let rateCapacity = { status: 'SKIP' };
    if (!skipRateCapacityProof) {
      const proofPath =
        rateCapacityProofPath ||
        env.PHASE33F_RATE_CAPACITY_PROOF ||
        '/tmp/phase33f-rate-capacity-smoke-v1/rate-capacity-smoke-proof.json';
      if (!fs.existsSync(proofPath)) {
        throw blocked('missing rate-capacity proof', { proofPath });
      }
      let proof;
      try {
        proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
      } catch (err) {
        throw blocked(`rate-capacity proof unparseable: ${err.message}`, { proofPath });
      }
      if (proof.status && proof.status !== 'PASS') {
        throw blocked('rate-capacity proof not PASS', { proofPath, status: proof.status });
      }
      const maxAgeMs = Number(env.PHASE33F_RATE_CAPACITY_MAX_AGE_MS || 7 * 24 * 3600 * 1000);
      const at = Date.parse(proof.at || proof.finished_at || proof.created_at || '');
      if (Number.isFinite(at) && Date.now() - at > maxAgeMs) {
        throw blocked('stale capacity-smoke proof blocks', { proofPath, at: proof.at, maxAgeMs });
      }
      rateCapacity = { status: 'PASS', proofPath, proof_status: proof.status || null };
    }

    // Gate 18 — runtime image / limiter drift
    if (expectedRuntimeImagePin != null) {
      if (runtimeImagePin == null || runtimeImagePin !== expectedRuntimeImagePin) {
        throw blocked('runtime-image drift blocks', {
          runtimeImagePin,
          expectedRuntimeImagePin,
        });
      }
    }
    if (expectedLimiterConfigHash != null) {
      if (limiterConfigHash == null || limiterConfigHash !== expectedLimiterConfigHash) {
        throw blocked('limiter-config drift blocks', {
          limiterConfigHash,
          expectedLimiterConfigHash,
        });
      }
    }

    // Gate 19 — edge health
    if (!skipEdgeHealth) {
      runEdgeHealth({ repoRoot });
    }

    // Gate 20 — authorization smoke
    const authSmoke = runAuthSmoke({ mode: 'target', repoRoot });
    if (authSmoke?.status && authSmoke.status !== 'PASS') {
      throw blocked('authorization smoke failed', { authSmoke });
    }

    // Gate 21 — QUIC/PCAP preflight
    const quicPcap = runQuicPcapPreflight({ mode: 'target', repoRoot, out });
    if (quicPcap?.status && quicPcap.status !== 'PASS') {
      throw blocked('QUIC/PCAP preflight failed', { quicPcap });
    }

    // Gate 22 — final pin recheck
    if (!skipSourceReconciliation) {
      const finalPin = assertSourceReconciliation(repoRoot, resolvedHead);
      if (finalPin.headSha !== resolvedHead) {
        throw blocked(`final pin drift: ${finalPin.headSha} != ${resolvedHead}`);
      }
    }

    assertTargetRootAbsent(REAL_TARGET_ROOT);
    if (fs.existsSync(out)) {
      throw blocked('target out root must remain absent after preflight', { out });
    }

    return {
      status: 'PASS',
      code: 'PHASE33F_TARGET_PREFLIGHT_PASS',
      mode,
      out,
      headSha: resolvedHead,
      originMainSha: resolvedOrigin,
      owner_approval: ownerApproval,
      manifest_sha: pin?.manifest_sha || null,
      canonical_workload_hash: pin?.canonical_workload_hash || null,
      manifest_rows: pin?.rows || null,
      manifest_validation: manifestValidation,
      coverage,
      canary_v3: canaryV3,
      auth_smoke: authSmoke,
      quic_pcap: quicPcap,
      pacing,
      rate_capacity: rateCapacity,
      dimensions: TARGET,
      real_target_root_created: false,
    };
  } catch (err) {
    // Always leave target absent on failure.
    if (fs.existsSync(REAL_TARGET_ROOT) && opts.out === REAL_TARGET_ROOT) {
      // Do not delete an unexpected existing root — only ensure we never created it.
    }
    if (err.code === CANARY_PRELAUNCH_BLOCKED || err.code === TARGET_PRELAUNCH_BLOCKED_CODE) {
      err.code = TARGET_PRELAUNCH_BLOCKED_CODE;
      throw err;
    }
    throw blocked(err.message, { cause_code: err.code, details: err.details });
  }
}

export function probeLimiterWindowReadiness({
  baseUrl = EDGE_BASE_URL,
  caCertRel = EDGE_CA_CERT_REL,
  repoRoot = REPO_ROOT,
  quietMs = 65_000,
  minRemaining = 240,
} = {}) {
  const ca = path.join(repoRoot, caCertRel);
  const start = new Date().toISOString();
  const sleep = spawnSync('sleep', [String(Math.ceil(quietMs / 1000))], { encoding: 'utf8' });
  if (sleep.status !== 0) {
    throw blocked('limiter quiet window sleep failed');
  }
  const headersPath = `/tmp/phase33f-target-limiter-headers-${process.pid}.txt`;
  spawnSync(
    'curl',
    ['-sk', '--max-time', '5', '--cacert', ca, '-D', headersPath, '-o', '/dev/null', `${baseUrl}/api/health`],
    { encoding: 'utf8' },
  );
  let remaining = null;
  let reset = null;
  if (fs.existsSync(headersPath)) {
    const headers = fs.readFileSync(headersPath, 'utf8');
    const rem = headers.match(/^(?:RateLimit-Remaining|X-RateLimit-Remaining):\s*(\d+)/im);
    const rst = headers.match(/^(?:RateLimit-Reset|X-RateLimit-Reset):\s*(\S+)/im);
    if (rem) remaining = Number(rem[1]);
    if (rst) reset = rst[1];
  }
  if (remaining != null && remaining < minRemaining) {
    throw blocked(`limiter remaining ${remaining} < ${minRemaining}`, { remaining, reset });
  }
  return {
    status: 'PASS',
    quiet_window_start: start,
    quiet_window_finish: new Date().toISOString(),
    remaining,
    reset,
    min_remaining: minRemaining,
    configured_capacity: 300,
    configured_window_s: 60,
  };
}
