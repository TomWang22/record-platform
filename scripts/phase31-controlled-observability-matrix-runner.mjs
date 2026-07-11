#!/usr/bin/env node
/**
 * Phase 31D/E — controlled real-inference observability matrix runner.
 *
 * 3 protocols × 32 windows × 6 users × 10 runs × 9 Phase-21 cases = 25,920 probes.
 * Output under /tmp only. Not merged into 57105/171315/7200 evidence.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULTS,
  PROMPTS,
  PROTOCOLS,
  CONTRACT,
  loadN5Participants,
  expectedGate,
  resolveCurlTarget,
  login,
  ragQuery,
  extractMeta,
  extractResponseText,
  checkLeakage,
  scoreAnswer,
  assertPhase21Row,
  sha256File,
  gitSha,
  sleepMs,
} from './lib/phase22-full-replay-common.mjs';
import {
  MATRIX_TARGET,
  MATRIX_EVIDENCE_LABEL,
  protocolLabel,
  writeMatrixArtifacts,
  loadJsonl,
  classifyMatrixProbeFailure,
  isDeterministicPreviewGateMismatch,
} from './lib/phase31-controlled-matrix-summary.mjs';
import { resolvePhase31MatrixRoot } from './lib/phase31-controlled-matrix-config.mjs';
import {
  resolveMatrixEvidenceLabel,
} from './lib/phase32g-long-soak-config.mjs';
import {
  PreviewWindowCoordinator,
  coordinatorRootFromRunnerOut,
  resetAndVerifyWindowGates,
  validateParticipantIdentity,
} from './lib/phase31-preview-window-coordinator.mjs';
import {
  attachTimingToProbeRow,
  buildTimingAttribution,
  extractServerTimingFromBody,
  finalizeProbeTiming,
} from './lib/phase32-timing-attribution.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const VENV_PYTHON = path.join(REPO_ROOT, 'services/python-ai-service/.venv/bin/python');
const USEFULNESS_HELPER = path.join(REPO_ROOT, 'scripts/phase31-write-usefulness-observation.py');
const KPI_ROWS_HELPER = path.join(REPO_ROOT, 'scripts/phase31-write-matrix-kpi-rows.py');

function parseArgs(argv) {
  const opts = {
    protocol: 'all',
    windows: MATRIX_TARGET.windows,
    runs: MATRIX_TARGET.runs,
    cases: 'phase21-9',
    users: 'n5-plus-contract',
    out: resolvePhase31MatrixRoot(),
    resume: false,
    failFast: false,
    summaryOnly: false,
    retryFailures: null,
    onlyFailures: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--protocol') opts.protocol = argv[++i];
    else if (arg === '--windows') opts.windows = Number(argv[++i]);
    else if (arg === '--runs') opts.runs = Number(argv[++i]);
    else if (arg === '--cases') opts.cases = argv[++i];
    else if (arg === '--users') opts.users = argv[++i];
    else if (arg === '--out') opts.out = argv[++i];
    else if (arg === '--resume') opts.resume = true;
    else if (arg === '--fail-fast') opts.failFast = true;
    else if (arg === '--summary-only') opts.summaryOnly = true;
    else if (arg === '--retry-failures') opts.retryFailures = argv[++i];
    else if (arg === '--only-failures') opts.onlyFailures = argv[++i];
  }
  return opts;
}

function buildManifest(opts, evidenceLabel = MATRIX_EVIDENCE_LABEL) {
  const users = loadN5Participants();
  const protocols =
    opts.protocol === 'all' ? ['h1', 'h2', 'h3'] : [opts.protocol.replace(/^h/i, 'h')];
  const rows = [];
  let probeId = 0;
  for (const protoKey of protocols) {
    const proto = PROTOCOLS[protoKey];
    if (!proto) throw new Error(`unknown protocol: ${protoKey}`);
    for (let window = 1; window <= opts.windows; window += 1) {
      for (const user of users) {
        for (let run = 1; run <= opts.runs; run += 1) {
          for (const [case_id, question] of PROMPTS) {
            probeId += 1;
            rows.push({
              probe_id: probeId,
              matrix_protocol: protoKey,
              protocol_label: protocolLabel(proto.expected),
              window,
              run,
              case_id,
              question,
              user_uid: user.uid,
              user_email: user.email,
              user_class: user.user_class,
              role: user.role,
              expected_gate_reason: expectedGate(user),
              expected_retrieval_mode: 'hybrid_canary',
              sentiment_required: case_id === 'buyer_psychology',
              red_team_case: case_id === 'red_team_overclaim' || case_id === 'final_tagged_plan',
              evidence_label: evidenceLabel,
            });
          }
        }
      }
    }
  }
  return rows;
}

function redactedRow(base, extras) {
  const row = {
    probe_id: base.probe_id,
    matrix_protocol: base.matrix_protocol,
    protocol_label: base.protocol_label,
    window: base.window,
    run: base.run,
    case_id: base.case_id,
    user_uid_hash: createHash('sha256').update(base.user_uid).digest('hex').slice(0, 12),
    user_class: base.user_class,
    expected_gate_reason: base.expected_gate_reason,
    evidence_label: base.evidence_label,
    ...extras,
  };
  return row;
}

function extractRefs(body) {
  return (
    body?.source_refs ||
    body?.citations ||
    body?.references ||
    body?.details?.references ||
    []
  );
}

const ENABLE_ENV = {
  AI_KPI_OBSERVABILITY_MASTER_DISABLE: '0',
  AI_KPI_OBSERVABILITY_ENABLED: '1',
  AI_KPI_QUERY_OBSERVATIONS_ENABLED: '1',
  AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED: '1',
  AI_KPI_ENVIRONMENT: 'local',
};

function loadShardRestartCount(outDir) {
  const countPath = path.join(outDir, 'shard-restart-count.txt');
  if (!fs.existsSync(countPath)) return 0;
  const value = Number(String(fs.readFileSync(countPath, 'utf8')).trim());
  return Number.isFinite(value) ? value : 0;
}

function sampleProcessMetrics(cpuStart, eventLoopHandle) {
  const cpuDelta = process.cpuUsage(cpuStart);
  if (eventLoopHandle) eventLoopHandle.disable();
  const eventLoopDelayMs =
    eventLoopHandle && eventLoopHandle.mean > 0
      ? Math.round((eventLoopHandle.mean / 1e6) * 10) / 10
      : null;
  return {
    event_loop_delay_ms: eventLoopDelayMs,
    process_cpu_user_ms: Math.round((cpuDelta.user / 1000) * 10) / 10,
    process_cpu_system_ms: Math.round((cpuDelta.system / 1000) * 10) / 10,
    rss_mb: Math.round((process.memoryUsage().rss / (1024 * 1024)) * 10) / 10,
  };
}

function writeMatrixKpiRows(probe, resp, meta, rubric, qualityScore) {
  if (!fs.existsSync(VENV_PYTHON) || !fs.existsSync(KPI_ROWS_HELPER)) {
    return {
      query: { status: 'SKIPPED' },
      usefulness: { status: 'SKIPPED' },
      child_process_spawn_ms: 0,
    };
  }
  const payload = {
    query: {
      observed_at: new Date().toISOString(),
      protocol: probe.protocol_label,
      retrieval_mode: meta.retrieval_mode || 'unknown',
      gate_reason: meta.gate_reason,
      case_id: probe.case_id,
      workflow: 'phase31_staging_long_soak',
      rag_total_ms: Math.round(resp.rag_total_ms || 0),
      hybrid_retrieval_ms: meta.hybrid_retrieval_ms,
      keyword_retrieval_ms: null,
      fallback_count: meta.hybrid_fallback ? 1 : 0,
      canary_error_count: meta.canary_error ? 1 : 0,
      http_status: resp.http_status,
      environment: 'staging',
    },
    usefulness: {
      protocol: probe.protocol_label,
      response_pass: rubric.response_pass === 'PASS',
      sentiment_pass: rubric.sentiment_pass === 'PASS',
      red_team_safety_pass: rubric.response_pass === 'PASS',
      leakage_failures: rubric.leakage_pass === 'FAIL' ? 1 : 0,
      evidence_label: probe.evidence_label || MATRIX_EVIDENCE_LABEL,
      environment: 'staging',
      workflow: 'phase31_staging_long_soak',
      case_id: probe.case_id,
      quality_score: qualityScore,
    },
  };
  const injectionEnv = {
    AI_KPI_TEST_INJECT_WRITE_DELAY_MS: process.env.AI_KPI_TEST_INJECT_WRITE_DELAY_MS || '0',
    AI_KPI_TEST_INJECT_WRITE_FAILURE_RATE: process.env.AI_KPI_TEST_INJECT_WRITE_FAILURE_RATE || '0',
    AI_KPI_TEST_INJECT_TIMEOUT_MS: process.env.AI_KPI_TEST_INJECT_TIMEOUT_MS || '0',
    AI_KPI_TEST_INJECT_DB_UNAVAILABLE: process.env.AI_KPI_TEST_INJECT_DB_UNAVAILABLE || '0',
  };
  const spawnStartMs = Date.now();
  const result = spawnSync(VENV_PYTHON, [KPI_ROWS_HELPER, JSON.stringify(payload)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...ENABLE_ENV,
      ...injectionEnv,
      POSTGRES_URL_PYTHON_AI:
        process.env.POSTGRES_URL_PYTHON_AI ||
        'postgresql://postgres:postgres@127.0.0.1:5440/python_ai',
    },
  });
  const child_process_spawn_ms = Date.now() - spawnStartMs;
  if (result.status !== 0) {
    return {
      query: { status: 'FAIL' },
      usefulness: { status: 'FAIL' },
      error: result.stderr || result.stdout,
      child_process_spawn_ms,
    };
  }
  return {
    query: { status: 'PASS' },
    usefulness: { status: 'PASS' },
    id: result.stdout.trim(),
    child_process_spawn_ms,
  };
}

function validateAllParticipants(users, getToken) {
  for (const user of users) {
    const token = getToken(user.email);
    validateParticipantIdentity(user, token);
  }
}

function normalizeProtocolKey(protocolOpt) {
  if (protocolOpt === 'all') return null;
  return protocolOpt.replace(/^h/i, 'h');
}

function loadFailureProbeIds(triagePath) {
  const triage = JSON.parse(fs.readFileSync(triagePath, 'utf8'));
  const probes = triage.failure_probes || triage.retryable_failures || [];
  const keys = new Set(
    probes.map((f) =>
      [f.matrix_protocol, f.window, f.run, f.case_id, f.user_uid_hash].join('|'),
    ),
  );
  return { keys, probes, triage };
}

function probeMatchKey(probe, userUidHash) {
  const hash =
    userUidHash ||
    createHash('sha256').update(probe.user_uid).digest('hex').slice(0, 12);
  return [probe.matrix_protocol, probe.window, probe.run, probe.case_id, hash].join('|');
}

function executeProbe(probe, cfg, getToken, probeContext = {}) {
  const probeStartedAt = new Date().toISOString();
  const probeStartMs = Date.now();
  const cpuStart = process.cpuUsage();
  const eventLoopHandle = monitorEventLoopDelay({ resolution: 20 });
  eventLoopHandle.enable();
  const proto = PROTOCOLS[probe.matrix_protocol];
  const token = getToken(probe.user_email);
  const userId = probe.user_uid;

  let resp;
  let meta;
  let text;
  let refs;
  let leakagePass;
  let qualityScore;
  let rubric;
  let retry_count = 0;
  let retry_delay_ms = 0;
  let curl_time_total_ms = null;
  let app_rag_total_ms = null;
  let serverTiming = {};
  let curl_exit_code = null;
  let curl_error_class = null;
  let curl_time_namelookup_ms = null;
  let curl_time_connect_ms = null;
  let curl_time_appconnect_ms = null;
  let curl_time_pretransfer_ms = null;
  let curl_time_starttransfer_ms = null;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    try {
      resp = ragQuery(token, userId, probe.question, cfg, proto, { maxRetries: 8 });
      retry_count += Number(resp.retry_count || 0);
      retry_delay_ms += Number(resp.retry_delay_ms || 0);
      curl_time_total_ms = resp.curl_time_total_ms ?? resp.rag_total_ms ?? null;
      curl_exit_code = resp.curl_exit_code ?? 0;
      curl_error_class = resp.curl_error_class ?? 'ok';
      curl_time_namelookup_ms = resp.curl_time_namelookup_ms ?? null;
      curl_time_connect_ms = resp.curl_time_connect_ms ?? null;
      curl_time_appconnect_ms = resp.curl_time_appconnect_ms ?? null;
      curl_time_pretransfer_ms = resp.curl_time_pretransfer_ms ?? null;
      curl_time_starttransfer_ms = resp.curl_time_starttransfer_ms ?? null;
      serverTiming = extractServerTimingFromBody(resp.body || {});
      app_rag_total_ms = serverTiming.rag_total_ms;
      if ([502, 503, 504, 429].includes(resp.http_status) && attempt + 1 < 16) {
        const delay = Math.min(10000, 500 * 2 ** attempt);
        retry_count += 1;
        retry_delay_ms += delay;
        sleepMs(delay);
        continue;
      }
      meta = extractMeta(resp.body || {});
      text = extractResponseText(resp.body || {});
      refs = extractRefs(resp.body || {});
      leakagePass = checkLeakage(text);
      qualityScore = scoreAnswer(text, refs, leakagePass);
      rubric = assertPhase21Row(probe, text, refs, leakagePass, qualityScore);
      if (resp.http_status !== 200 && attempt + 1 < 16) {
        const delay = Math.min(10000, 500 * 2 ** attempt);
        retry_count += 1;
        retry_delay_ms += delay;
        sleepMs(delay);
        continue;
      }
      break;
    } catch (err) {
      if (attempt + 1 >= 16) throw err;
      const delay = Math.min(10000, 500 * 2 ** attempt);
      retry_count += 1;
      retry_delay_ms += delay;
      sleepMs(delay);
    }
  }
  const kpiStartMs = Date.now();
  const kpiWrites = writeMatrixKpiRows(probe, resp, meta, rubric, qualityScore);
  const kpi_query_write_ms = Date.now() - kpiStartMs;
  const processMetrics = sampleProcessMetrics(cpuStart, eventLoopHandle);
  const probeFinishedAt = new Date().toISOString();
  const timing = buildTimingAttribution({
    probe_started_at: probeStartedAt,
    probe_finished_at: probeFinishedAt,
    wall_total_ms: Date.now() - probeStartMs,
    curl_time_total_ms,
    rag_total_ms: app_rag_total_ms,
    coordinator_wait_ms: probeContext.coordinator_wait_ms ?? 0,
    window_reset_ms: probeContext.window_reset_ms ?? 0,
    pre_probe_gate_verify_ms: probeContext.pre_probe_gate_verify_ms ?? 0,
    retry_count,
    retry_delay_ms,
    kpi_query_write_ms,
    kpi_usefulness_write_ms: 0,
    jsonl_write_ms: 0,
    stall: {
      ...processMetrics,
      coordinator_lock_wait_ms: probeContext.coordinator_lock_wait_ms ?? null,
      coordinator_stale_lock_recovered: probeContext.coordinator_stale_lock_recovered ?? false,
      coordinator_lock_owner_protocol: probeContext.coordinator_lock_owner_protocol ?? null,
      coordinator_lock_owner_pid: probeContext.coordinator_lock_owner_pid ?? null,
      child_process_spawn_ms: kpiWrites.child_process_spawn_ms ?? null,
      curl_exit_code,
      curl_error_class,
      curl_time_namelookup_ms,
      curl_time_connect_ms,
      curl_time_appconnect_ms,
      curl_time_pretransfer_ms,
      curl_time_starttransfer_ms,
      server_timing_rag_total_ms: serverTiming.server_timing_rag_total_ms ?? null,
      server_timing_retrieval_total_ms: serverTiming.server_timing_retrieval_total_ms ?? null,
      server_timing_kpi_query_write_ms: serverTiming.server_timing_kpi_query_write_ms ?? null,
      probe_gap_since_previous_ms: probeContext.probe_gap_since_previous_ms ?? null,
      shard_restart_count: probeContext.shard_restart_count ?? null,
    },
  });
  const row = attachTimingToProbeRow(
    redactedRow(probe, {
      http_status: resp.http_status,
      http_version: resp.http_version,
      version_ok: resp.version_ok,
      rag_total_ms: app_rag_total_ms ?? curl_time_total_ms,
      retrieval_mode: meta.retrieval_mode,
      gate_reason: meta.gate_reason,
      fallback_count: meta.hybrid_fallback ? 1 : 0,
      response_pass: rubric.response_pass,
      sentiment_pass: rubric.sentiment_pass,
      leakage_pass: leakagePass,
      usefulness_write: kpiWrites.usefulness?.status,
      query_observation_write: kpiWrites.query?.status,
      quality_score: qualityScore,
      sentiment_required: probe.sentiment_required,
      red_team_case: probe.red_team_case,
      completed_at: probeFinishedAt,
    }),
    timing,
  );
  if (isDeterministicPreviewGateMismatch(row)) {
    row.lifecycle_diagnostic = {
      failure_class: 'deterministic',
      reason: 'preview_opt_in_expected_keyword_default_observed',
      coordinator_required: true,
    };
  }
  const failureClass = classifyMatrixProbeFailure(row);
  const probeFail =
    failureClass === 'deterministic' ||
    failureClass === 'retryable' ||
    resp.http_status !== 200 ||
    !resp.version_ok ||
    meta.gate_reason !== probe.expected_gate_reason ||
    rubric.response_pass !== 'PASS' ||
    leakagePass === 'FAIL' ||
    (probe.sentiment_required && rubric.sentiment_pass !== 'PASS');
  return { row, probeFail, meta, resp, failureClass };
}

function resolveMatrixRoot(outDir) {
  const base = path.basename(outDir);
  if (base.startsWith('shard-')) return path.dirname(outDir);
  return outDir;
}

function loadCompletedIds(jsonlPath) {
  const rows = loadJsonl(jsonlPath);
  return new Set(rows.map((r) => r.probe_id));
}

function runMatrix(opts) {
  if (!opts.out.startsWith('/tmp')) {
    throw new Error('matrix output must be under /tmp');
  }
  if (sha256File(DEFAULTS.artifactPath) !== DEFAULTS.expectedArtifactSha) {
    throw new Error('participant artifact SHA mismatch');
  }

  const triagePath = opts.retryFailures || opts.onlyFailures;
  const retryMode = Boolean(triagePath);
  const matrixRoot = resolveMatrixRoot(opts.out);
  fs.mkdirSync(opts.out, { recursive: true });
  const evidenceLabel =
    resolveMatrixEvidenceLabel(process.env, opts.out) || MATRIX_EVIDENCE_LABEL;
  const jsonlPath = retryMode
    ? path.join(matrixRoot, 'phase31-retry-failures.jsonl')
    : path.join(opts.out, 'phase31-matrix.jsonl');
  const manifest = buildManifest(opts, evidenceLabel);
  const users = loadN5Participants();
  let targetProbes = manifest;
  if (retryMode) {
    const loaded = loadFailureProbeIds(triagePath);
    targetProbes = manifest.filter((p) => loaded.keys.has(probeMatchKey(p)));
    if (opts.onlyFailures && opts.protocol !== 'all') {
      const proto = opts.protocol.replace(/^h/i, 'h');
      targetProbes = targetProbes.filter((p) => p.matrix_protocol === proto);
    }
    fs.writeFileSync(jsonlPath, '', 'utf8');
  }

  const completed = !retryMode && opts.resume ? loadCompletedIds(jsonlPath) : new Set();
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

  const protocolKey = normalizeProtocolKey(opts.protocol);
  const useCoordinator = !retryMode && protocolKey != null;
  const coordinator = useCoordinator
    ? new PreviewWindowCoordinator(coordinatorRootFromRunnerOut(opts.out))
    : null;

  const failures = [];
  let lastWindow = null;
  let windowTiming = {
    coordinator_wait_ms: 0,
    window_reset_ms: 0,
    coordinator_lock_wait_ms: 0,
    coordinator_stale_lock_recovered: false,
    coordinator_lock_owner_protocol: null,
    coordinator_lock_owner_pid: null,
  };
  let firstProbeInWindow = true;
  let lastProbeFinishedMs = null;
  const shardRestartCount = loadShardRestartCount(opts.out);
  for (const probe of targetProbes) {
    if (!retryMode && completed.has(probe.probe_id)) continue;

    if (probe.window !== lastWindow) {
      if (useCoordinator && lastWindow !== null) {
        coordinator.completeWindowProtocol(lastWindow, protocolKey);
      }
      if (useCoordinator) {
        const entered = coordinator.enterWindow(probe.window, protocolKey, {
          resetAndVerify: () => resetAndVerifyWindowGates(users, getToken, cfg),
        });
        windowTiming = entered.timing || { coordinator_wait_ms: 0, window_reset_ms: 0 };
      } else {
        windowTiming = { coordinator_wait_ms: 0, window_reset_ms: 0 };
      }
      lastWindow = probe.window;
      firstProbeInWindow = true;
    }

    const probeContext = firstProbeInWindow
      ? {
          ...windowTiming,
          probe_gap_since_previous_ms:
            lastProbeFinishedMs == null ? null : Math.max(0, Date.now() - lastProbeFinishedMs),
          shard_restart_count: shardRestartCount,
        }
      : {
          coordinator_wait_ms: 0,
          window_reset_ms: 0,
          pre_probe_gate_verify_ms: 0,
          coordinator_lock_wait_ms: 0,
          coordinator_stale_lock_recovered: false,
          coordinator_lock_owner_protocol: null,
          coordinator_lock_owner_pid: null,
          probe_gap_since_previous_ms:
            lastProbeFinishedMs == null ? null : Math.max(0, Date.now() - lastProbeFinishedMs),
          shard_restart_count: shardRestartCount,
        };
    firstProbeInWindow = false;

    const { row, probeFail, failureClass } = executeProbe(probe, cfg, getToken, probeContext);
    if (retryMode) row.retry_of_probe_id = probe.probe_id;
    const jsonlStartMs = Date.now();
    row.timing = finalizeProbeTiming(row, { jsonl_write_ms: 0 });
    const jsonl_flush_ms = Date.now() - jsonlStartMs;
    row.timing = finalizeProbeTiming(row, { jsonl_write_ms: jsonl_flush_ms, jsonl_flush_ms });
    fs.appendFileSync(jsonlPath, `${JSON.stringify(row)}\n`, 'utf8');
    lastProbeFinishedMs = Date.now();
    if (!retryMode) completed.add(probe.probe_id);

    if (probeFail) {
      failures.push({
        probe_id: probe.probe_id,
        gate_reason: row.gate_reason,
        http_status: row.http_status,
        response_pass: row.response_pass,
        failure_class: failureClass || (row.lifecycle_diagnostic?.failure_class ?? 'deterministic'),
      });
      if (opts.failFast) break;
    }

    const progressTotal = retryMode ? targetProbes.length : manifest.length;
    const progressCount = retryMode
      ? failures.length + (targetProbes.length - failures.length)
      : completed.size;
    if (!retryMode && completed.size % 100 === 0) {
      process.stderr.write(`phase31 matrix progress: ${completed.size}/${manifest.length}\n`);
    } else if (retryMode && progressCount % 5 === 0) {
      process.stderr.write(`phase31 retry progress: ${progressCount}/${progressTotal}\n`);
    }
  }

  if (useCoordinator && lastWindow !== null) {
    coordinator.completeWindowProtocol(lastWindow, protocolKey);
  }

  const allRows = loadJsonl(jsonlPath);
  const summary = writeMatrixArtifacts(
    retryMode ? matrixRoot : opts.out,
    allRows,
    {
      git_sha: gitSha(),
      artifact_sha: sha256File(DEFAULTS.artifactPath),
      probes_executed: allRows.length,
      manifest_target: retryMode ? targetProbes.length : manifest.length,
      retry_mode: retryMode,
      failures: failures.slice(0, 50),
    },
  );
  if (retryMode) {
    fs.writeFileSync(
      path.join(matrixRoot, 'phase31-retry-summary.json'),
      `${JSON.stringify({ ...summary, retried_probe_ids: targetProbes.map((p) => p.probe_id), failures }, null, 2)}\n`,
      'utf8',
    );
  }

  return { summary, jsonlPath, failures, retryMode };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.summaryOnly) {
    const jsonlPath = path.join(opts.out, 'phase31-matrix.jsonl');
    const rows = loadJsonl(jsonlPath);
    const summary = writeMatrixArtifacts(opts.out, rows);
    console.log(JSON.stringify(summary, null, 2));
    return summary.status === 'PASS' ? 0 : 1;
  }
  const { summary } = runMatrix(opts);
  console.log(JSON.stringify(summary, null, 2));
  return summary.status === 'PASS' ? 0 : summary.status === 'IN_PROGRESS' ? 2 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main());
}

export {
  buildManifest,
  runMatrix,
  parseArgs,
  executeProbe,
  validateAllParticipants,
  normalizeProtocolKey,
  resolveMatrixRoot,
  loadCompletedIds,
};
