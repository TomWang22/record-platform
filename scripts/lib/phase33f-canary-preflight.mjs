/**
 * Phase 33F canary preflight — ordered gates before evidence-root creation.
 * NEVER creates REAL_CANARY_ROOT / REAL_TARGET_ROOT.
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
  REAL_CANARY_ROOT,
  REAL_TARGET_ROOT,
  LAUNCHER_SOURCE_GLOBS,
  EDGE_BASE_URL,
  EDGE_CA_CERT_REL,
  isRealGauntletRoot,
  dimensionsForMode,
} from './phase33f-canary-config.mjs';
import {
  buildManifestForMode,
  validateManifestRowsForMode,
  auditProductionMutationRows,
  hashManifest,
} from './phase33f-canary-manifest.mjs';
import { liveAuthSmoke } from './phase33f-auth-smoke.mjs';
import { liveQuicPcapPreflight } from './phase33f-quic-pcap-preflight.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

export const PRELAUNCH_BLOCKED_CODE = 'PHASE33F_CANARY_PRELAUNCH_BLOCKED';

function blocked(message, details = {}) {
  const err = new Error(message);
  err.code = PRELAUNCH_BLOCKED_CODE;
  err.details = details;
  return err;
}

function isFrozenGauntletRoot(root) {
  return (
    fs.existsSync(path.join(root, 'FROZEN_BLOCKED_EVIDENCE')) ||
    fs.existsSync(path.join(root, 'FROZEN_PASS_EVIDENCE'))
  );
}

export function assertRealGauntletRootsAbsent() {
  const present = [];
  const frozenPresent = [];
  if (fs.existsSync(REAL_CANARY_ROOT)) {
    if (isFrozenGauntletRoot(REAL_CANARY_ROOT)) frozenPresent.push(REAL_CANARY_ROOT);
    else present.push(REAL_CANARY_ROOT);
  }
  // Target must remain absent until a separate owner approval after canary PASS.
  if (fs.existsSync(REAL_TARGET_ROOT)) present.push(REAL_TARGET_ROOT);
  if (present.length) {
    throw blocked(`real gauntlet roots must remain absent: ${present.join(', ')}`, {
      present,
      frozen_present: frozenPresent,
    });
  }
  return {
    canary_absent: !fs.existsSync(REAL_CANARY_ROOT),
    canary_frozen_ok: frozenPresent.includes(REAL_CANARY_ROOT),
    target_absent: true,
  };
}

export function assertEvidenceRootAbsent(outRoot) {
  if (!fs.existsSync(outRoot)) return;
  throw blocked(`evidence root must be absent before launch: ${outRoot}`, { outRoot });
}

export function assertCleanLauncherSource(repoRoot = REPO_ROOT, { globs = LAUNCHER_SOURCE_GLOBS } = {}) {
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
  if (status.status !== 0) {
    throw blocked('git status failed for launcher source reconciliation');
  }
  const dirty = (status.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const file = line.slice(3).trim().replace(/^.* -> /, '');
      return globs.some((g) => file === g || file.startsWith(`${g}/`) || file.endsWith(g));
    });
  if (dirty.length) {
    throw blocked(`dirty launcher source blocks execution: ${dirty.join('; ')}`, { dirty });
  }
  return { status: 'PASS', dirty: [] };
}

function runMake(target, repoRoot) {
  const r = spawnSync('make', [target], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  return {
    target,
    status: r.status ?? 1,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

export function runAttributionGuard(repoRoot = REPO_ROOT) {
  const r = runMake('git-verify-no-cursor-trailers', repoRoot);
  if (r.status !== 0) {
    throw blocked('attribution/forbidden-ref guard failed', { result: r });
  }
  return r;
}

export function runOfflinePhaseVerify(repoRoot = REPO_ROOT) {
  const targets = [
    'ai-platform-verify-phase33a-contracts',
    'ai-platform-verify-phase33b',
    'ai-platform-verify-phase33c',
    'ai-platform-verify-phase33d',
    'ai-platform-verify-phase33e',
    'ai-platform-verify-phase33f',
  ];
  const results = [];
  for (const target of targets) {
    const r = runMake(target, repoRoot);
    results.push(r);
    if (r.status !== 0) {
      throw blocked(`offline verify failed: ${target}`, { results });
    }
  }
  return results;
}

export function runSemanticHoldoutVerify(repoRoot = REPO_ROOT) {
  const r = runMake('ai-platform-verify-phase33f-semantic', repoRoot);
  if (r.status !== 0) {
    throw blocked('semantic holdout verify failed', { result: r });
  }
  return r;
}

export function assertCoverageSummary(repoRoot = REPO_ROOT, { minPct = 90, skipIfMissing = false } = {}) {
  const candidates = [
    path.join(repoRoot, 'services/python-ai-service/coverage/coverage-summary.json'),
    path.join('/tmp/phase33f-canary-prelaunch', 'coverage.json'),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    if (skipIfMissing) return { status: 'SKIP', reason: 'coverage_summary_missing' };
    throw blocked('coverage summary missing', { candidates });
  }
  const summary = JSON.parse(fs.readFileSync(found, 'utf8'));
  const pct =
    summary?.total?.lines?.pct ??
    summary?.total?.lines?.pct ??
    summary?.lines?.pct ??
    null;
  if (pct == null || Number(pct) < minPct) {
    throw blocked(`coverage ${pct} < ${minPct}`, { path: found, pct });
  }
  return { status: 'PASS', path: found, pct: Number(pct) };
}

export function defaultEdgeHealthCheck({
  repoRoot = REPO_ROOT,
  baseUrl = EDGE_BASE_URL,
  caCert = path.join(repoRoot, EDGE_CA_CERT_REL),
} = {}) {
  const paths = ['/api/health', '/api/healthz'];
  const attempts = [];
  for (const p of paths) {
    const args = ['-sk', '--max-time', '5', '--cacert', caCert, `${baseUrl.replace(/\/$/, '')}${p}`];
    const r = spawnSync('curl', args, { encoding: 'utf8' });
    attempts.push({
      path: p,
      status: r.status,
      stdout: (r.stdout || '').slice(0, 500),
      stderr: (r.stderr || '').slice(0, 500),
    });
    if (r.status === 0 && /ok|healthy|pass|alive|"status"\s*:\s*"ok"/i.test(r.stdout || '')) {
      return { status: 'PASS', path: p, attempts };
    }
    if (r.status === 0 && (r.stdout || '').trim()) {
      return { status: 'PASS', path: p, attempts };
    }
  }
  throw blocked('edge health failed against record-platform.test', { attempts });
}

export function defaultAuthSmoke(opts = {}) {
  return liveAuthSmoke(opts);
}

export function offlineAuthSmokeStub({ outRoot = null } = {}) {
  return {
    status: 'PASS',
    note: 'offline auth smoke stub explicitly selected by PHASE33F_PREFLIGHT_OFFLINE=1',
    outRoot,
  };
}

export function defaultQuicPcapPreflight(opts = {}) {
  return liveQuicPcapPreflight(opts);
}

export function offlineQuicPcapPreflightStub() {
  return {
    status: 'PASS',
    note: 'offline QUIC/PCAP stub explicitly selected by PHASE33F_PREFLIGHT_OFFLINE=1',
  };
}

/**
 * Ordered preflight. When opts.out === REAL_CANARY_ROOT, never mkdir that root.
 */
export function runPhase33fCanaryPreflight(opts = {}) {
  const {
    out,
    mode = 'canary',
    repoRoot = REPO_ROOT,
    skipCiApproval = false,
    skipOfflineVerify = false,
    skipCoverage = false,
    skipDiskPreflight = false,
    skipSourceReconciliation = false,
    skipAttribution = false,
    skipSemantic = false,
    skipEdgeHealth = false,
    skipCollectorExclusivity = false,
    skipManifest = false,
    skipDirtySourceCheck = false,
    headSha = null,
    originMainSha = null,
    approvalRecord = null,
    runAuthSmoke = defaultAuthSmoke,
    runQuicPcapPreflight = defaultQuicPcapPreflight,
    runEdgeHealth = defaultEdgeHealthCheck,
    manifestRows: injectedManifestRows = null,
    assertCollectorExclusivity = assertCollectorExclusivityPreflight,
  } = opts;

  if (!out) throw blocked('--out is required');
  if (!out.startsWith('/tmp/')) throw blocked(`out must be under /tmp: ${out}`);

  // Gate 0 — real roots must stay absent during implementation / failed preflight.
  assertRealGauntletRootsAbsent();

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

  // Gate 2 — exact-SHA CI approval (skip for smoke / explicit)
  if (!(mode === 'smoke' || skipCiApproval)) {
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

  // Gate 3 — attribution / forbidden-ref
  if (!skipAttribution) {
    runAttributionGuard(repoRoot);
  }

  // Gate 4 — clean launcher source
  const allowDirty =
    skipDirtySourceCheck ||
    process.env.PHASE33F_ALLOW_DIRTY_LAUNCHER === '1' ||
    mode === 'smoke';
  if (!allowDirty) {
    assertCleanLauncherSource(repoRoot);
  }

  // Gate 5 — Phase 33A–F offline verify
  if (!skipOfflineVerify) {
    runOfflinePhaseVerify(repoRoot);
  }

  // Gate 6 — semantic holdout
  if (!skipSemantic) {
    runSemanticHoldoutVerify(repoRoot);
  }

  // Gate 7 — coverage >= 90 if present
  const coverage = assertCoverageSummary(repoRoot, {
    skipIfMissing: skipCoverage,
  });

  // Gate 8 — manifest build + validate in memory (no real canary mkdir)
  let manifestRows = [];
  let manifestSha = null;
  let manifestValidation = null;
  if (!skipManifest) {
    manifestRows = injectedManifestRows || buildManifestForMode(mode);
    manifestValidation = validateManifestRowsForMode(manifestRows, { mode });
    if (manifestValidation.status !== 'PASS') {
      throw blocked('manifest validation failed', {
        violations: manifestValidation.violations?.slice?.(0, 20) || manifestValidation,
      });
    }
    manifestSha = hashManifest(manifestRows);
  }

  // Gate 9 — production mutation audit
  if (manifestRows.length) {
    const audit = auditProductionMutationRows(manifestRows);
    if (audit.status !== 'PASS') {
      throw blocked('production mutation audit failed', audit);
    }
  }

  // Gate 10 — disk gate
  if (!(mode === 'smoke' || skipDiskPreflight)) {
    try {
      assertDiskPreflight(out);
    } catch (err) {
      throw blocked(err.message, { cause_code: err.code });
    }
  }

  // Gate 11 — collector exclusivity
  if (!skipCollectorExclusivity) {
    try {
      assertCollectorExclusivity({
        interface: process.env.PHASE32H_CAPTURE_IFACE || 'bridge100',
      });
    } catch (err) {
      throw blocked(err.message, { cause_code: err.code, details: err.details });
    }
  }

  // Gate 12 — evidence root absent
  assertEvidenceRootAbsent(out);
  if (isRealGauntletRoot(out)) {
    assertRealGauntletRootsAbsent();
  }

  // Gate 13 — edge health
  if (!skipEdgeHealth) {
    runEdgeHealth({ repoRoot });
  }

  // Gate 14 — authorization smoke
  const authSmoke = runAuthSmoke({
    ...(opts.authSmokeOut ? { outRoot: opts.authSmokeOut } : {}),
    mode,
    repoRoot,
  });
  if (authSmoke?.status && authSmoke.status !== 'PASS') {
    throw blocked('authorization smoke failed', { authSmoke });
  }

  // Gate 15 — QUIC/PCAP preflight
  const quicPcap = runQuicPcapPreflight({ mode, repoRoot, out });
  if (quicPcap?.status && quicPcap.status !== 'PASS') {
    throw blocked('QUIC/PCAP preflight failed', { quicPcap });
  }

  // Gate 16 — final pin recheck
  if (!skipSourceReconciliation) {
    const finalPin = assertSourceReconciliation(repoRoot, resolvedHead);
    if (finalPin.headSha !== resolvedHead) {
      throw blocked(`final pin drift: ${finalPin.headSha} != ${resolvedHead}`);
    }
  }

  // Final absence proof — never mkdir real roots here
  assertRealGauntletRootsAbsent();
  if (isRealGauntletRoot(out) && fs.existsSync(out)) {
    throw blocked('real canary root must remain absent after preflight');
  }

  const dims = dimensionsForMode(mode);
  return {
    status: 'PASS',
    code: 'PHASE33F_CANARY_PREFLIGHT_PASS',
    mode,
    out,
    headSha: resolvedHead,
    originMainSha: resolvedOrigin,
    manifest_sha: manifestSha,
    manifest_rows: manifestRows,
    manifest_validation: manifestValidation,
    coverage,
    auth_smoke: authSmoke,
    quic_pcap: quicPcap,
    dimensions: dims,
    real_canary_root_created: false,
    real_target_root_created: false,
  };
}
