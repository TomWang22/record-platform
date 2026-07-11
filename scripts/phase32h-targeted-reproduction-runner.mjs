#!/usr/bin/env node
/**
 * Phase 32H — targeted reproduction runner with in-flight registry + heartbeats.
 */
import fs from 'node:fs';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  DEFAULTS,
  PROTOCOLS,
  resolveCurlTarget,
  login,
  gitSha,
  sha256File,
  loadN5Participants,
} from './lib/phase22-full-replay-common.mjs';
import { loadJsonl } from './lib/phase31-controlled-matrix-summary.mjs';
import {
  executeProbe,
  validateAllParticipants,
  normalizeProtocolKey,
  loadCompletedIds,
} from './phase31-controlled-observability-matrix-runner.mjs';
import {
  coordinatorRootFromRunnerOut,
  PreviewWindowCoordinator,
  resetAndVerifyWindowGates,
} from './lib/phase31-preview-window-coordinator.mjs';
import {
  buildInflightRecord,
  completeInflight,
  registerInflight,
} from './lib/phase32h-inflight-probe-registry.mjs';
import {
  PHASE32H_EVIDENCE_LABEL,
  TARGET_PER_PROTOCOL,
  TARGETED_WINDOWS,
  resolvePhase32hRoot,
} from './lib/phase32h-targeted-reproduction-config.mjs';
import { buildPhase32hSummary, writePhase32hSummary } from './lib/phase32h-targeted-summary.mjs';
import { loadManifestForProtocol, parseTargetedReplayArgs } from './phase31-targeted-preview-lifecycle-replay.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const base = parseTargetedReplayArgs(argv);
  if (!base.out || base.out === '/tmp/phase31-preview-lifecycle-repair-replay') {
    base.out = resolvePhase32hRoot();
  }
  if (!argv.includes('--manifest')) {
    base.manifest = path.join(base.out, 'phase32h-targeted-manifest.jsonl');
  }
  return base;
}

function shardDir(outRoot, protocolKey) {
  return path.join(outRoot, `shard-${protocolKey}`);
}

function writeHeartbeatRow(hbPath, loopHandle, current, inflightMs = null) {
  const cpu = process.cpuUsage();
  const mem = process.memoryUsage();
  const row = {
    ts: new Date().toISOString(),
    monotonic_ms: Date.now(),
    pid: process.pid,
    event_loop_delay_ms: loopHandle.mean / 1e6,
    cpu_user_ms: cpu.user / 1000,
    cpu_system_ms: cpu.system / 1000,
    rss_mb: mem.rss / (1024 * 1024),
    probe_id: current.probe_id,
    window: current.window,
    run: current.run,
    in_flight_elapsed_ms: inflightMs,
  };
  fs.appendFileSync(hbPath, `${JSON.stringify(row)}\n`);
}

function startHeartbeat(outRoot, protocolKey) {
  const hbPath = path.join(outRoot, 'heartbeats', `${protocolKey}.jsonl`);
  fs.mkdirSync(path.dirname(hbPath), { recursive: true });
  const loopHandle = monitorEventLoopDelay({ resolution: 20 });
  loopHandle.enable();
  let current = { probe_id: null, window: null, run: null };
  const timer = setInterval(() => {
    writeHeartbeatRow(hbPath, loopHandle, current);
  }, 1000);
  return {
    path: hbPath,
    loopHandle,
    setCurrent(probe) {
      current = { probe_id: probe?.probe_id ?? null, window: probe?.window ?? null, run: probe?.run ?? null };
    },
    pulse(inflightMs = null) {
      writeHeartbeatRow(hbPath, loopHandle, current, inflightMs);
    },
    stop() {
      clearInterval(timer);
      loopHandle.disable();
    },
  };
}

export function runPhase32hTargeted(opts) {
  if (!opts.out.startsWith('/tmp')) throw new Error('phase32h output must be under /tmp');
  if (sha256File(DEFAULTS.artifactPath) !== DEFAULTS.expectedArtifactSha) {
    throw new Error('participant artifact SHA mismatch');
  }
  const protocolKey = normalizeProtocolKey(opts.protocol);
  const outRoot = opts.out;
  fs.mkdirSync(outRoot, { recursive: true });
  const shard = shardDir(outRoot, protocolKey);
  fs.mkdirSync(shard, { recursive: true });

  let manifest = loadManifestForProtocol(opts.manifest, protocolKey);
  if (opts.limit != null) {
    manifest = manifest.slice(0, opts.limit);
  } else if (!opts.smoke && manifest.length !== TARGET_PER_PROTOCOL) {
    throw new Error(
      `protocol ${protocolKey} manifest count ${manifest.length} != ${TARGET_PER_PROTOCOL}`,
    );
  }

  const jsonlPath = path.join(shard, 'phase32h-matrix.jsonl');
  const users = loadN5Participants();
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

  const smokeMode = opts.smoke || (opts.limit != null && opts.limit <= 6);
  const coordinator = new PreviewWindowCoordinator(coordinatorRootFromRunnerOut(outRoot), {
    matrixId: smokeMode ? 'phase32h-smoke' : 'phase32h',
    windowSequence: TARGETED_WINDOWS,
    expectedProtocols: smokeMode ? [protocolKey] : undefined,
  });

  const heartbeat = startHeartbeat(outRoot, protocolKey);
  const failures = [];
  let lastWindow = null;
  let wroteRows = 0;

  for (const probe of manifest) {
    if (completed.has(probe.probe_id)) continue;
    heartbeat.setCurrent(probe);

    if (probe.window !== lastWindow) {
      if (lastWindow !== null) coordinator.completeWindowProtocol(lastWindow, protocolKey);
      coordinator.enterWindow(probe.window, protocolKey, {
        resetAndVerify: () => resetAndVerifyWindowGates(users, getToken, cfg),
      });
      lastWindow = probe.window;
    }

    registerInflight(outRoot, protocolKey, buildInflightRecord(probe, { runnerPid: process.pid }));
    const inflightStarted = Date.now();
    heartbeat.pulse(0);
    const { row, probeFail, failureClass } = executeProbe(probe, cfg, getToken);
    row.evidence_label = PHASE32H_EVIDENCE_LABEL;
    row.git_sha = gitSha();
    completeInflight(outRoot, protocolKey, { probe_finished_at: row.timing?.probe_finished_at });
    heartbeat.pulse(Date.now() - inflightStarted);
    fs.appendFileSync(jsonlPath, `${JSON.stringify(row)}\n`, 'utf8');
    wroteRows += 1;
    completed.add(probe.probe_id);

    if (probeFail) {
      failures.push({
        probe_id: probe.probe_id,
        gate_reason: row.gate_reason,
        http_status: row.http_status,
        failure_class: failureClass,
      });
      if (opts.failFast) break;
    }
    if (!smokeMode && completed.size % 100 === 0) {
      process.stderr.write(
        `phase32h targeted progress ${protocolKey}: ${completed.size}/${manifest.length}\n`,
      );
    }
  }

  if (lastWindow !== null) coordinator.completeWindowProtocol(lastWindow, protocolKey);
  heartbeat.stop();

  const allRows = loadShardRowsAll(outRoot);
  const summary = buildPhase32hSummary(outRoot, allRows);
  writePhase32hSummary(outRoot, summary);
  return { summary, jsonlPath, failures, manifestCount: manifest.length, wroteRows };
}

function loadShardRowsAll(outRoot) {
  const rows = [];
  for (const shard of ['h1', 'h2', 'h3']) {
    const file = path.join(outRoot, `shard-${shard}`, 'phase32h-matrix.jsonl');
    if (!fs.existsSync(file)) continue;
    rows.push(...loadJsonl(file));
  }
  return rows;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.summaryOnly) {
    const summary = buildPhase32hSummary(opts.out);
    writePhase32hSummary(opts.out, summary);
    console.log(JSON.stringify(summary, null, 2));
    return summary.status === 'PASS' || summary.status === 'PASS_WITH_EXTREMES' ? 0 : 2;
  }
  const result = runPhase32hTargeted(opts);
  console.log(JSON.stringify(result.summary, null, 2));
  if (opts.smoke) return result.wroteRows >= 1 ? 0 : 1;
  return result.summary.status === 'PASS' || result.summary.status === 'PASS_WITH_EXTREMES' ? 0 : 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main());
}

export { parseArgs as parsePhase32hArgs };
