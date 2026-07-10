#!/usr/bin/env node
/**
 * Phase 31M — targeted preview lifecycle replay runner (manifest-driven, coordinator-backed).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULTS,
  PROTOCOLS,
  resolveCurlTarget,
  login,
  sha256File,
  gitSha,
} from './lib/phase22-full-replay-common.mjs';
import { loadJsonl } from './lib/phase31-controlled-matrix-summary.mjs';
import {
  DEFAULT_OUT,
  TARGETED_REPLAY_PER_PROTOCOL,
  TARGETED_REPLAY_WINDOWS,
  resolveTargetedReplayUsers,
} from './lib/phase31-targeted-replay-config.mjs';
import {
  PreviewWindowCoordinator,
  coordinatorRootFromRunnerOut,
  resetAndVerifyWindowGates,
} from './lib/phase31-preview-window-coordinator.mjs';
import {
  executeProbe,
  validateAllParticipants,
  normalizeProtocolKey,
  resolveMatrixRoot,
  loadCompletedIds,
} from './phase31-controlled-observability-matrix-runner.mjs';
import { writeTargetedReplayArtifacts, loadTargetedShardRows } from './lib/phase31-targeted-replay-summary.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = {
    protocol: null,
    manifest: null,
    out: DEFAULT_OUT,
    resume: false,
    failFast: false,
    summaryOnly: false,
    limit: null,
    smoke: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--protocol') opts.protocol = argv[++i];
    else if (arg === '--manifest') opts.manifest = argv[++i];
    else if (arg === '--out') opts.out = argv[++i];
    else if (arg === '--resume') opts.resume = true;
    else if (arg === '--fail-fast') opts.failFast = true;
    else if (arg === '--summary-only') opts.summaryOnly = true;
    else if (arg === '--limit') opts.limit = Number(argv[++i]);
    else if (arg === '--smoke') opts.smoke = true;
  }
  if (!opts.protocol) throw new Error('--protocol h1|h2|h3 required');
  if (!opts.manifest) {
    opts.manifest = path.join(resolveMatrixRoot(opts.out), 'phase31m-targeted-manifest.jsonl');
  }
  return opts;
}

function loadManifestForProtocol(manifestPath, protocol) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest not found: ${manifestPath}`);
  }
  const proto = normalizeProtocolKey(protocol);
  const rows = loadJsonl(manifestPath).filter((row) => row.matrix_protocol === proto);
  if (!rows.length) {
    throw new Error(`manifest has zero rows for protocol ${proto}: ${manifestPath}`);
  }
  return rows.sort((a, b) => {
    if (a.window !== b.window) return a.window - b.window;
    if (a.run !== b.run) return a.run - b.run;
    if (a.user_uid !== b.user_uid) return a.user_uid.localeCompare(b.user_uid);
    return a.case_id.localeCompare(b.case_id);
  });
}

function runTargetedReplay(opts) {
  if (!opts.out.startsWith('/tmp')) {
    throw new Error('targeted replay output must be under /tmp');
  }
  if (sha256File(DEFAULTS.artifactPath) !== DEFAULTS.expectedArtifactSha) {
    throw new Error('participant artifact SHA mismatch');
  }

  const protocolKey = normalizeProtocolKey(opts.protocol);
  const matrixRoot = resolveMatrixRoot(opts.out);
  fs.mkdirSync(opts.out, { recursive: true });

  let manifest = loadManifestForProtocol(opts.manifest, protocolKey);
  if (opts.limit != null) {
    if (!Number.isFinite(opts.limit) || opts.limit < 1) {
      throw new Error(`--limit must be a positive integer, got ${opts.limit}`);
    }
    manifest = manifest.slice(0, opts.limit);
  } else if (manifest.length !== TARGETED_REPLAY_PER_PROTOCOL) {
    throw new Error(
      `protocol ${protocolKey} manifest count ${manifest.length} != expected ${TARGETED_REPLAY_PER_PROTOCOL}`,
    );
  }

  const jsonlPath = path.join(opts.out, 'phase31m-matrix.jsonl');
  const users = resolveTargetedReplayUsers();
  const completed = opts.resume && fs.existsSync(jsonlPath) ? loadCompletedIds(jsonlPath) : new Set();

  const cfg = {
    ...DEFAULTS,
    password: DEFAULTS.password || process.env.T20_PARTICIPANT_LOGIN_PASSWORD || 'ContractPass123!',
    curlResolve: resolveCurlTarget(DEFAULTS.baseUrl),
    ragPauseMs: Number(process.env.T20_EVAL_RAG_PAUSE_SEC || '0.02') * 1000,
    mgmtProto: PROTOCOLS.h1,
  };

  const tokenCache = new Map();
  const getToken = (email) => {
    if (!tokenCache.has(email)) tokenCache.set(email, login(email, cfg));
    return tokenCache.get(email);
  };

  validateAllParticipants(users, getToken);

  const smokeMode = opts.smoke || opts.limit === 1;
  const coordinator = new PreviewWindowCoordinator(coordinatorRootFromRunnerOut(opts.out), {
    matrixId: smokeMode ? 'phase31m-smoke' : 'phase31m',
    windowSequence: TARGETED_REPLAY_WINDOWS,
    expectedProtocols: smokeMode ? [protocolKey] : undefined,
  });

  const failures = [];
  let lastWindow = null;
  let wroteRows = 0;
  for (const probe of manifest) {
    if (completed.has(probe.probe_id)) continue;

    if (probe.window !== lastWindow) {
      if (lastWindow !== null) {
        coordinator.completeWindowProtocol(lastWindow, protocolKey);
      }
      coordinator.enterWindow(probe.window, protocolKey, {
        resetAndVerify: () => resetAndVerifyWindowGates(users, getToken, cfg),
      });
      lastWindow = probe.window;
    }

    const { row, probeFail, failureClass } = executeProbe(probe, cfg, getToken);
    fs.appendFileSync(jsonlPath, `${JSON.stringify(row)}\n`, 'utf8');
    wroteRows += 1;
    completed.add(probe.probe_id);

    if (probeFail) {
      failures.push({
        probe_id: probe.probe_id,
        gate_reason: row.gate_reason,
        http_status: row.http_status,
        response_pass: row.response_pass,
        failure_class: failureClass,
      });
      if (opts.failFast) break;
    }

    if (!smokeMode && completed.size % 50 === 0) {
      process.stderr.write(
        `phase31m targeted progress ${protocolKey}: ${completed.size}/${manifest.length}\n`,
      );
    }
  }

  if (lastWindow !== null) {
    coordinator.completeWindowProtocol(lastWindow, protocolKey);
  }

  if (wroteRows === 0 && manifest.length > 0 && completed.size >= manifest.length) {
    process.stderr.write(`phase31m targeted ${protocolKey}: all ${manifest.length} probes already complete\n`);
  }

  const shardRows = loadJsonl(jsonlPath);
  return {
    summary: smokeMode
      ? { status: shardRows.length > 0 ? 'SMOKE_OK' : 'SMOKE_EMPTY', rows: shardRows.length }
      : writeTargetedReplayArtifacts(matrixRoot, loadTargetedShardRows(matrixRoot), {
          git_sha: gitSha(),
          shard_protocol: protocolKey,
          manifest_target: manifest.length,
          failures: failures.slice(0, 50),
        }),
    jsonlPath,
    failures,
    manifestCount: manifest.length,
    wroteRows,
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.summaryOnly) {
    const summary = writeTargetedReplayArtifacts(
      resolveMatrixRoot(opts.out),
      loadTargetedShardRows(resolveMatrixRoot(opts.out)),
    );
    console.log(JSON.stringify(summary, null, 2));
    return summary.status === 'PASS' ? 0 : 1;
  }
  const result = runTargetedReplay(opts);
  console.log(JSON.stringify(result.summary, null, 2));
  if (opts.smoke || opts.limit === 1) {
    return result.wroteRows >= 1 || result.jsonlPath && fs.existsSync(result.jsonlPath) ? 0 : 1;
  }
  return result.summary.status === 'PASS' ? 0 : result.summary.status === 'IN_PROGRESS' ? 2 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main());
}

export { runTargetedReplay, loadManifestForProtocol, parseArgs as parseTargetedReplayArgs };
