#!/usr/bin/env node
/**
 * Phase 28D/E — controlled real-inference observability matrix runner.
 *
 * 3 protocols × 16 windows × 6 users × 10 runs × 9 Phase-21 cases = 25,920 probes.
 * Output under /tmp only. Not merged into 57105/171315/7200 evidence.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
  previewApi,
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
  summarizeMatrixRows,
} from './lib/phase28-controlled-matrix-summary.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const VENV_PYTHON = path.join(REPO_ROOT, 'services/python-ai-service/.venv/bin/python');
const USEFULNESS_HELPER = path.join(REPO_ROOT, 'scripts/phase28-write-usefulness-observation.py');
const KPI_ROWS_HELPER = path.join(REPO_ROOT, 'scripts/phase28-write-matrix-kpi-rows.py');

const DEFAULT_OUT = '/tmp/phase28-controlled-observability-matrix';

function parseArgs(argv) {
  const opts = {
    protocol: 'all',
    windows: MATRIX_TARGET.windows,
    runs: MATRIX_TARGET.runs,
    cases: 'phase21-9',
    users: 'n5-plus-contract',
    out: DEFAULT_OUT,
    resume: false,
    failFast: false,
    summaryOnly: false,
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
  }
  return opts;
}

function buildManifest(opts) {
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
              evidence_label: MATRIX_EVIDENCE_LABEL,
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

function writeMatrixKpiRows(probe, resp, meta, rubric, qualityScore) {
  if (!fs.existsSync(VENV_PYTHON) || !fs.existsSync(KPI_ROWS_HELPER)) {
    return { query: { status: 'SKIPPED' }, usefulness: { status: 'SKIPPED' } };
  }
  const payload = {
    query: {
      observed_at: new Date().toISOString(),
      protocol: probe.protocol_label,
      retrieval_mode: meta.retrieval_mode || 'unknown',
      gate_reason: meta.gate_reason,
      case_id: probe.case_id,
      workflow: 'phase28_controlled_matrix',
      rag_total_ms: Math.round(resp.rag_total_ms || 0),
      hybrid_retrieval_ms: meta.hybrid_retrieval_ms,
      keyword_retrieval_ms: null,
      fallback_count: meta.hybrid_fallback ? 1 : 0,
      canary_error_count: meta.canary_error ? 1 : 0,
      http_status: resp.http_status,
      environment: 'local',
    },
    usefulness: {
      protocol: probe.protocol_label,
      response_pass: rubric.response_pass === 'PASS',
      sentiment_pass: rubric.sentiment_pass === 'PASS',
      red_team_safety_pass: rubric.response_pass === 'PASS',
      leakage_failures: rubric.leakage_pass === 'FAIL' ? 1 : 0,
      evidence_label: MATRIX_EVIDENCE_LABEL,
      environment: 'local',
      workflow: 'phase28_controlled_matrix',
      case_id: probe.case_id,
      quality_score: qualityScore,
    },
  };
  const result = spawnSync(VENV_PYTHON, [KPI_ROWS_HELPER, JSON.stringify(payload)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...ENABLE_ENV,
      POSTGRES_URL_PYTHON_AI:
        process.env.POSTGRES_URL_PYTHON_AI ||
        'postgresql://postgres:postgres@127.0.0.1:5440/python_ai',
    },
  });
  if (result.status !== 0) {
    return { query: { status: 'FAIL' }, usefulness: { status: 'FAIL' }, error: result.stderr || result.stdout };
  }
  return { query: { status: 'PASS' }, usefulness: { status: 'PASS' }, id: result.stdout.trim() };
}

const ENABLE_ENV = {
  AI_KPI_OBSERVABILITY_MASTER_DISABLE: '0',
  AI_KPI_OBSERVABILITY_ENABLED: '1',
  AI_KPI_QUERY_OBSERVATIONS_ENABLED: '1',
  AI_KPI_USEFULNESS_OBSERVATIONS_ENABLED: '1',
  AI_KPI_ENVIRONMENT: 'local',
};

function ensurePreviewEnrolled(token, userId, cfg) {
  const status = previewApi('GET', 'status', token, userId, cfg);
  if (status.body?.enrolled) return;
  previewApi('POST', 'enroll', token, userId, cfg);
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

  fs.mkdirSync(opts.out, { recursive: true });
  const jsonlPath = path.join(opts.out, 'phase28-matrix.jsonl');
  const manifest = buildManifest(opts);
  const completed = opts.resume ? loadCompletedIds(jsonlPath) : new Set();
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

  const failures = [];
  for (const probe of manifest) {
    if (completed.has(probe.probe_id)) continue;
    const proto = PROTOCOLS[probe.matrix_protocol];
    const token = getToken(probe.user_email);
    const userId = probe.user_uid;
    if (probe.role === 'preview') ensurePreviewEnrolled(token, userId, cfg);

    let resp;
    let meta;
    let text;
    let refs;
    let leakagePass;
    let qualityScore;
    let rubric;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        resp = ragQuery(token, userId, probe.question, cfg, proto, { maxRetries: 3 });
        meta = extractMeta(resp.body || {});
        text = extractResponseText(resp.body || {});
        refs = extractRefs(resp.body || {});
        leakagePass = checkLeakage(text);
        qualityScore = scoreAnswer(text, refs, leakagePass);
        rubric = assertPhase21Row(probe, text, refs, leakagePass, qualityScore);
        break;
      } catch (err) {
        if (attempt + 1 >= 12) throw err;
        const delay = Math.min(8000, 500 * 2 ** attempt);
        sleepMs(delay);
      }
    }
    const kpiWrites = writeMatrixKpiRows(probe, resp, meta, rubric, qualityScore);

    const row = redactedRow(probe, {
      http_status: resp.http_status,
      http_version: resp.http_version,
      version_ok: resp.version_ok,
      rag_total_ms: resp.rag_total_ms,
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
      completed_at: new Date().toISOString(),
    });

    fs.appendFileSync(jsonlPath, `${JSON.stringify(row)}\n`, 'utf8');
    completed.add(probe.probe_id);

    const probeFail =
      resp.http_status !== 200 ||
      !resp.version_ok ||
      meta.gate_reason !== probe.expected_gate_reason ||
      meta.gate_reason === 'keyword_default' ||
      rubric.response_pass !== 'PASS' ||
      leakagePass === 'FAIL' ||
      (probe.sentiment_required && rubric.sentiment_pass !== 'PASS');

    if (probeFail) {
      failures.push({ probe_id: probe.probe_id, gate_reason: meta.gate_reason, http_status: resp.http_status });
      if (opts.failFast) break;
    }

    if (completed.size % 100 === 0) {
      process.stderr.write(`phase28 matrix progress: ${completed.size}/${manifest.length}\n`);
    }
  }

  const allRows = loadJsonl(jsonlPath);
  const summary = writeMatrixArtifacts(opts.out, allRows, {
    git_sha: gitSha(),
    artifact_sha: sha256File(DEFAULTS.artifactPath),
    probes_executed: allRows.length,
    manifest_target: manifest.length,
    failures: failures.slice(0, 20),
  });

  return { summary, jsonlPath, failures };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.summaryOnly) {
    const jsonlPath = path.join(opts.out, 'phase28-matrix.jsonl');
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

export { buildManifest, runMatrix, parseArgs };
