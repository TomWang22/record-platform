#!/usr/bin/env node
/**
 * Phase 22I/J — full 57105 protocol replay runner (H2 or H3).
 * Usage: node scripts/phase22-full-protocol-replay-runner.mjs --protocol h2|h3
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  BATCHES,
  DEFAULTS,
  PROTOCOLS,
  REPO_ROOT,
  assertPhase21Row,
  buildReplaySummary,
  checkLeakage,
  countFallback,
  emailHash,
  expandManifestRows,
  extractMeta,
  extractResponseText,
  gitSha,
  jwtSub,
  login,
  previewApi,
  ragQuery,
  resolveBatchUsers,
  resolveCurlTarget,
  scoreAnswer,
  sha256File,
  sleepMs,
  verifyKeepEnv,
} from './lib/phase22-full-replay-common.mjs';

function parseArgs(argv) {
  const opts = {
    protocol: 'h2',
    manifest: path.join(REPO_ROOT, 'bench_logs/ai-platform/phase22/full-replay/phase22-full-57105-manifest.jsonl'),
    writeJsonl: '',
    summary: '',
    checkpoint: '',
    batchDir: '',
    resume: false,
    failFast: true,
    maxProbes: 0,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--protocol') opts.protocol = argv[++i];
    else if (arg === '--manifest') opts.manifest = path.resolve(argv[++i]);
    else if (arg === '--write-jsonl') opts.writeJsonl = path.resolve(argv[++i]);
    else if (arg === '--summary') opts.summary = path.resolve(argv[++i]);
    else if (arg === '--checkpoint') opts.checkpoint = path.resolve(argv[++i]);
    else if (arg === '--batch-dir') opts.batchDir = path.resolve(argv[++i]);
    else if (arg === '--resume') opts.resume = true;
    else if (arg === '--max-probes') opts.maxProbes = Number(argv[++i]);
    else if (arg === '--fail-fast') opts.failFast = true;
    else if (arg === '--no-fail-fast') opts.failFast = false;
    else throw new Error(`unknown arg: ${arg}`);
  };
  const phase = opts.protocol === 'h3' ? '22J' : '22I';
  const tag = opts.protocol === 'h3' ? 'phase22j-h3' : 'phase22i-h2';
  if (!opts.writeJsonl) {
    opts.writeJsonl = path.join(REPO_ROOT, 'bench_logs/ai-platform/phase22', `${tag}-full-replay.jsonl`);
  }
  if (!opts.summary) {
    opts.summary = path.join(REPO_ROOT, 'bench_logs/ai-platform/phase22', `${tag}-full-replay-summary.json`);
  }
  if (!opts.checkpoint) {
    opts.checkpoint = opts.writeJsonl.replace(/\.jsonl$/, '-checkpoint.json');
  }
  if (!opts.batchDir) {
    opts.batchDir = opts.writeJsonl.replace(/\.jsonl$/, '-batches');
  }
  opts.phase = phase;
  return opts;
}

function loadCompletedRows(opts) {
  const byProbe = new Map();
  const sources = [];
  if (opts.resume && fs.existsSync(opts.writeJsonl)) sources.push(opts.writeJsonl);
  if (opts.resume && fs.existsSync(opts.batchDir)) {
    for (const name of fs.readdirSync(opts.batchDir)) {
      if (name.endsWith('.jsonl')) sources.push(path.join(opts.batchDir, name));
    }
  }
  for (const file of sources) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      byProbe.set(row.probe_id, row);
    }
  }
  return [...byProbe.values()].sort((a, b) => a.probe_id - b.probe_id);
}

function flushBatchRows(batchId, batchRows, opts) {
  if (!batchRows.length) return;
  fs.mkdirSync(opts.batchDir, { recursive: true });
  fs.writeFileSync(
    path.join(opts.batchDir, `${batchId}.jsonl`),
    `${batchRows.map((r) => JSON.stringify(r)).join('\n')}\n`,
  );
}

function writeCheckpoint(opts, proto, results) {
  const last = results[results.length - 1];
  const completedBatches = [...new Set(results.map((r) => r.batch_id))];
  fs.writeFileSync(
    opts.checkpoint,
    JSON.stringify(
      {
        protocol: proto.label,
        phase: opts.phase,
        last_probe_id: last?.probe_id ?? 0,
        probes_completed: results.length,
        completed_batches: completedBatches,
        updated_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

function fail(msg, opts) {
  console.error(`FAIL: ${msg}`);
  if (opts?.failFast !== false) process.exit(1);
}

function loadManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest missing: ${manifestPath}`);
  }
  const rows = fs
    .readFileSync(manifestPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  if (rows.length !== DEFAULTS.manifestTarget) {
    throw new Error(`manifest row count ${rows.length} != ${DEFAULTS.manifestTarget}`);
  }
  return rows;
}

function ragProbe(token, uid, cfg, proto) {
  const resp = ragQuery(token, uid, 'Which of my listings need attention first, and why?', cfg, proto);
  const meta = extractMeta(resp.body || {});
  return { ...meta, http_status: resp.http_status, http_version: resp.http_version, version_ok: resp.version_ok };
}

function verifyUserGate(sessions, uid, expectedMode, expectedGate, label, cfg, proto, opts) {
  const meta = sessions[uid];
  const probe = ragProbe(meta.token, uid, cfg, proto);
  if (probe.http_status !== 200 || !probe.version_ok) {
    fail(`${label}: probe HTTP/version fail status=${probe.http_status} version=${probe.http_version}`, opts);
  }
  if (probe.retrieval_mode !== expectedMode || probe.gate_reason !== expectedGate) {
    fail(`${label}: gate ${probe.retrieval_mode}/${probe.gate_reason} != ${expectedMode}/${expectedGate}`, opts);
  }
}

function previewUsers(batch) {
  return resolveBatchUsers(batch).filter((u) => u.role === 'preview');
}

function ensureSessions(users, sessions, cfg) {
  for (const user of users) {
    if (!sessions[user.uid]) {
      const token = login(user.email, cfg);
      if (jwtSub(token) !== user.uid) throw new Error(`JWT sub mismatch for ${user.email}`);
      sessions[user.uid] = { ...user, token };
    }
  }
}

function batchStartLifecycle(batch, sessions, cfg, proto, opts) {
  const preview = previewUsers(batch);
  if (batch.lifecycle === 'allowlist-only') {
    ensureSessions(batch.users === 'n5' ? resolveBatchUsers(batch) : batch.users, sessions, cfg);
    verifyUserGate(sessions, DEFAULTS.contractUid, 'hybrid_canary', 'allowlist', `${batch.id}-contract`, cfg, proto, opts);
    return;
  }
  ensureSessions(resolveBatchUsers(batch), sessions, cfg);
  if (batch.lifecycle === 'early-equivalence') {
    for (const user of preview) {
      previewApi('POST', 'revoke', sessions[user.uid].token, user.uid, cfg);
    }
    for (const user of preview) {
      previewApi('POST', 'enroll', sessions[user.uid].token, user.uid, cfg);
    }
    for (const user of preview) {
      let ok = false;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const probe = ragProbe(sessions[user.uid].token, user.uid, cfg, proto);
        if (probe.retrieval_mode === 'hybrid_canary' && probe.gate_reason === 'preview_opt_in') {
          ok = true;
          break;
        }
        previewApi('POST', 'enroll', sessions[user.uid].token, user.uid, cfg);
        sleepMs(200);
      }
      if (!ok) fail(`${batch.id}: early-equivalence enroll failed for ${user.email}`, opts);
    }
    verifyUserGate(sessions, DEFAULTS.contractUid, 'hybrid_canary', 'allowlist', `${batch.id}-contract`, cfg, proto, opts);
    verifyKeepEnv();
    return;
  }
  if (batch.lifecycle === 'per-window') {
    return;
  }
  throw new Error(`unknown lifecycle ${batch.lifecycle}`);
}

function perWindowLifecycle(batch, window, sessions, cfg, proto, opts) {
  const preview = previewUsers(batch);
  for (const user of preview) {
    previewApi('POST', 'revoke', sessions[user.uid].token, user.uid, cfg);
  }
  for (const user of preview) {
    verifyUserGate(sessions, user.uid, 'keyword', 'keyword_default', `${batch.id}-w${window}-revoke-${user.email}`, cfg, proto, opts);
  }
  for (const user of preview) {
    previewApi('POST', 'enroll', sessions[user.uid].token, user.uid, cfg);
  }
  for (const user of preview) {
    let ok = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const probe = ragProbe(sessions[user.uid].token, user.uid, cfg, proto);
      if (probe.retrieval_mode === 'hybrid_canary' && probe.gate_reason === 'preview_opt_in') {
        ok = true;
        break;
      }
      previewApi('POST', 'enroll', sessions[user.uid].token, user.uid, cfg);
      sleepMs(200);
    }
    if (!ok) fail(`${batch.id} w${window}: enroll verify failed for ${user.email}`, opts);
  }
  verifyUserGate(sessions, DEFAULTS.contractUid, 'hybrid_canary', 'allowlist', `${batch.id}-w${window}-contract`, cfg, proto, opts);
  verifyKeepEnv();
}

function batchEndLifecycle(batch, sessions, cfg) {
  if (batch.lifecycle === 'allowlist-only') return;
  const preview = previewUsers(batch);
  for (const user of preview) {
    previewApi('POST', 'revoke', sessions[user.uid].token, user.uid, cfg);
  }
}

function executeProbe(manifestRow, sessions, cfg, proto, opts, phase) {
  const user = sessions[manifestRow.user_uid];
  if (!user) throw new Error(`no session for ${manifestRow.user_uid}`);
  const resp = ragQuery(user.token, manifestRow.user_uid, manifestRow.question, cfg, proto);
  const body = resp.body || {};
  const responseText = extractResponseText(body);
  const meta = extractMeta(body);
  const fallbackCount = countFallback(body);
  const leakagePass = checkLeakage(responseText + JSON.stringify(body.details || {}));
  const refs = body.source_refs || [];
  const qualityScore = meta.quality_score != null ? meta.quality_score : scoreAnswer(responseText, refs, leakagePass);
  const { response_pass, sentiment_pass, grounding_pass } = assertPhase21Row(manifestRow, responseText, refs, leakagePass, qualityScore);

  const row = {
    phase,
    protocol: proto.label,
    probe_id: manifestRow.probe_id,
    batch_id: manifestRow.batch_id,
    window: manifestRow.window,
    run: manifestRow.run,
    case_id: manifestRow.case_id,
    user_class: manifestRow.user_class,
    participant_label: emailHash(manifestRow.user_email),
    expected_gate_reason: manifestRow.expected_gate_reason,
    sentiment_required: manifestRow.sentiment_required,
    red_team_case: manifestRow.red_team_case,
    http_status: resp.http_status,
    http_version: resp.http_version,
    retrieval_mode: meta.retrieval_mode,
    gate_reason: meta.gate_reason,
    fallback_count: fallbackCount,
    response_pass,
    sentiment_pass,
    grounding_pass,
    leakage_pass: leakagePass,
    rag_total_ms: resp.rag_total_ms,
    hybrid_retrieval_ms: meta.hybrid_retrieval_ms,
    quality_score: qualityScore,
    timestamp: new Date().toISOString(),
    git_sha: gitSha(),
    artifact_sha: sha256File(DEFAULTS.artifactPath),
  };

  const label = `${manifestRow.batch_id} p${manifestRow.probe_id} ${manifestRow.case_id}`;
  if (resp.http_status !== 200) fail(`${label}: HTTP ${resp.http_status}`, opts);
  if (!resp.version_ok) fail(`${label}: HTTP version ${resp.http_version} != ${proto.expected}`, opts);
  if (meta.retrieval_mode !== 'hybrid_canary') fail(`${label}: retrieval_mode=${meta.retrieval_mode}`, opts);
  if (meta.gate_reason !== manifestRow.expected_gate_reason) {
    fail(`${label}: gate=${meta.gate_reason} expected ${manifestRow.expected_gate_reason}`, opts);
  }
  if (fallbackCount > 0 || meta.hybrid_fallback) fail(`${label}: fallback`, opts);
  if (leakagePass === 'FAIL') fail(`${label}: leakage`, opts);
  if (response_pass !== 'PASS') fail(`${label}: response rubric`, opts);
  if (manifestRow.sentiment_required && sentiment_pass !== 'PASS') fail(`${label}: sentiment`, opts);
  if (qualityScore != null && qualityScore < cfg.qualityMin) fail(`${label}: quality ${qualityScore}`, opts);

  return row;
}

function main() {
  const opts = parseArgs(process.argv);
  if (!DEFAULTS.password) fail('CONTRACT_PASSWORD or T20_PARTICIPANT_LOGIN_PASSWORD required', opts);

  const proto = PROTOCOLS[opts.protocol];
  if (!proto) fail(`unknown protocol ${opts.protocol}`, opts);

  const artifactSha = sha256File(DEFAULTS.artifactPath);
  if (artifactSha !== DEFAULTS.expectedArtifactSha) fail('artifact SHA mismatch', opts);

  if (!fs.existsSync(opts.manifest)) {
    console.log('Manifest missing — generating inline...');
    const rows = expandManifestRows();
    if (rows.length !== DEFAULTS.manifestTarget) {
      fail(`manifest expansion ${rows.length} != ${DEFAULTS.manifestTarget}`, opts);
    }
    fs.mkdirSync(path.dirname(opts.manifest), { recursive: true });
    fs.writeFileSync(opts.manifest, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  }

  const manifest = loadManifest(opts.manifest);

  const cfg = {
    ...DEFAULTS,
    curlResolve: resolveCurlTarget(DEFAULTS.baseUrl),
    mgmtProto: PROTOCOLS.h1,
  };

  verifyKeepEnv();

  fs.mkdirSync(path.dirname(opts.writeJsonl), { recursive: true });
  fs.mkdirSync(opts.batchDir, { recursive: true });
  const completedSet = new Set();
  const results = opts.resume ? loadCompletedRows(opts) : [];
  for (const row of results) completedSet.add(row.probe_id);
  const sessions = {};
  const batchMap = new Map(BATCHES.map((b) => [b.id, b]));
  let currentBatch = null;
  let currentWindow = null;
  let batchRows = [];
  const limit = opts.maxProbes > 0 ? opts.maxProbes : manifest.length;

  console.log(`=== Phase ${opts.phase} ${proto.label} full replay (${limit} probes) ===`);
  if (opts.resume && results.length) {
    console.log(`resume: skipping ${results.length} completed probes (last p${results[results.length - 1].probe_id})`);
  }

  for (const manifestRow of manifest) {
    if (manifestRow.probe_id > limit) break;
    if (completedSet.has(manifestRow.probe_id)) continue;
    const batch = batchMap.get(manifestRow.batch_id);
    if (!batch) throw new Error(`unknown batch ${manifestRow.batch_id}`);

    if (currentBatch?.id !== batch.id) {
      if (currentBatch) {
        flushBatchRows(currentBatch.id, batchRows, opts);
        batchEndLifecycle(currentBatch, sessions, cfg);
        writeCheckpoint(opts, proto, results);
        batchRows = [];
      }
      currentBatch = batch;
      currentWindow = null;
      console.log(`=== batch ${batch.id} start (${batch.lifecycle}) ===`);
      batchStartLifecycle(batch, sessions, cfg, proto, opts);
    }

    if (batch.lifecycle === 'per-window' && currentWindow !== manifestRow.window) {
      currentWindow = manifestRow.window;
      console.log(`=== ${batch.id} window ${manifestRow.window}/${batch.windows} ===`);
      perWindowLifecycle(batch, manifestRow.window, sessions, cfg, proto, opts);
    }

    const row = executeProbe(manifestRow, sessions, cfg, proto, opts, opts.phase);
    results.push(row);
    batchRows.push(row);
    completedSet.add(row.probe_id);
    if (results.length % 500 === 0) {
      console.log(`progress=${results.length}/${limit}`);
      fs.writeFileSync(opts.writeJsonl, `${results.map((r) => JSON.stringify(r)).join('\n')}\n`);
      writeCheckpoint(opts, proto, results);
    }
  }

  if (currentBatch) {
    flushBatchRows(currentBatch.id, batchRows, opts);
    batchEndLifecycle(currentBatch, sessions, cfg);
    writeCheckpoint(opts, proto, results);
  }

  console.log('=== post-matrix revoke (N=5 participants) ===');
  const n5 = resolveBatchUsers({ users: 'n5' }).filter((u) => u.role === 'preview');
  for (const user of n5) {
    if (sessions[user.uid]) previewApi('POST', 'revoke', sessions[user.uid].token, user.uid, cfg);
  }
  for (const user of n5) {
    if (sessions[user.uid]) {
      verifyUserGate(sessions, user.uid, 'keyword', 'keyword_default', `final-${user.email}`, cfg, proto, opts);
    }
  }
  verifyUserGate(sessions, DEFAULTS.contractUid, 'hybrid_canary', 'allowlist', 'final-contract', cfg, proto, opts);
  verifyKeepEnv();

  fs.writeFileSync(opts.writeJsonl, `${results.map((r) => JSON.stringify(r)).join('\n')}\n`);
  const summary = buildReplaySummary(results, opts.phase, proto);
  fs.writeFileSync(opts.summary, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ summary_path: opts.summary, ...summary }, null, 2));
  process.exit(summary.status === 'PASS' ? 0 : 2);
}

main();
