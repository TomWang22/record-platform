/**
 * Phase 33F readiness — fail closed on offline quality before any canary root.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from './phase33b-retrieval-corpus.mjs';
import { SUPPORTED_MODES, evaluateMode, evaluateHardFailures } from './phase33b-retrieval-metrics.mjs';
import { loadCommittedSplits } from './phase33f-retrieval-splits.mjs';
import { CAPABILITIES, loadManifest, validateManifestRows, hashManifest } from './phase33f-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const AI = path.join(REPO_ROOT, 'scripts/ai-platform');
const READINESS_OUT = '/tmp/phase33f-capability-gauntlet-readiness';
const CANARY_ROOT = '/tmp/phase33f-capability-gauntlet-canary-v1';
const TARGET_ROOT = '/tmp/phase33f-capability-gauntlet-target-v1';

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function metricKeyToPolicy(key) {
  // Recall_at_5 -> Recall@5_min style pairing handled explicitly
  return key;
}

function filterCorpusByQueryIds(corpus, ids) {
  const idSet = new Set(ids);
  const queries = corpus.queries.filter((q) => idSet.has(q.query_id));
  const qids = new Set(queries.map((q) => q.query_id));
  return {
    queries,
    documents: corpus.documents,
    judgments: corpus.judgments.filter((j) => qids.has(j.query_id)),
    hardNegatives: corpus.hardNegatives.filter((h) => qids.has(h.query_id)),
  };
}

function collectModeFailures(mode, global, thresholds, policy, failing) {
  const hard = evaluateHardFailures(global, policy);
  for (const h of hard) {
    failing.push({ mode, metric: h, measured: null, threshold: 0, delta: null, class: 'hard_failure' });
  }
  const checks = [
    ['Recall_at_5', 'Recall@5_min'],
    ['Recall_at_10', 'Recall@10_min'],
    ['MRR', 'MRR_min'],
    ['nDCG_at_5', 'nDCG@5_min'],
    ['nDCG_at_10', 'nDCG@10_min'],
    ['exact_pressing_accuracy', 'exact_pressing_accuracy_min'],
    ['abstention_precision', 'abstention_precision_min'],
  ];
  for (const [measuredKey, threshKey] of checks) {
    const measured = global[measuredKey];
    const threshold = thresholds[threshKey];
    if (typeof threshold === 'number' && typeof measured === 'number' && measured < threshold) {
      failing.push({
        mode,
        metric: threshKey.replace(/_min$/, ''),
        measured,
        threshold,
        delta: measured - threshold,
        class: 'quality_threshold',
      });
    }
  }
}

export function evaluateRetrievalQualityGates({ packageRoot = AI } = {}) {
  const policy = readJson(path.join(packageRoot, 'retrieval-acceptance-policy.json'));
  const corpus = loadCorpus(packageRoot);
  const thresholds = policy.quality_thresholds_development || {};
  const failing = [];
  const modes = {};
  const splits = loadCommittedSplits(packageRoot);
  if (!splits?.holdout_ids?.length) {
    failing.push({
      mode: 'semantic_fixture',
      metric: 'frozen_holdout_split',
      measured: 'missing',
      threshold: 'required',
      delta: null,
      class: 'quality_threshold',
    });
  }
  const holdoutCorpus = splits?.holdout_ids?.length
    ? filterCorpusByQueryIds(corpus, splits.holdout_ids)
    : null;

  for (const mode of SUPPORTED_MODES) {
    // Semantic readiness is gated on the frozen holdout only.
    // Keyword/hybrid remain full-corpus regressions so production default stays honest.
    const evalCorpus =
      mode === 'semantic_fixture' && holdoutCorpus
        ? holdoutCorpus
        : {
            queries: corpus.queries,
            documents: corpus.documents,
            judgments: corpus.judgments,
            hardNegatives: corpus.hardNegatives,
          };
    const report = evaluateMode({
      mode,
      queries: evalCorpus.queries,
      documents: evalCorpus.documents,
      judgments: evalCorpus.judgments,
      hardNegatives: evalCorpus.hardNegatives,
    });
    const g = report.global;
    modes[mode] = {
      evaluation_split: mode === 'semantic_fixture' ? 'holdout' : 'full_corpus',
      query_count: g.query_count,
      Recall_at_5: g.Recall_at_5,
      Recall_at_10: g.Recall_at_10,
      MRR: g.MRR,
      nDCG_at_5: g.nDCG_at_5,
      nDCG_at_10: g.nDCG_at_10,
      exact_pressing_accuracy: g.exact_pressing_accuracy,
      abstention_precision: g.abstention_precision,
    };
    collectModeFailures(mode, g, thresholds, policy, failing);
  }

  return {
    status: failing.length ? 'BLOCKED' : 'READY',
    modes,
    failing_policy_metrics: failing,
    thresholds,
    holdout_query_count: holdoutCorpus?.queries?.length || 0,
    split_leakage: splits?.leakage_checks?.cross_split_duplicates ?? null,
  };
}

function runNodeVerify(scriptRel) {
  const script = path.join(REPO_ROOT, scriptRel);
  const r = spawnSync(process.execPath, [script], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return {
    script: scriptRel,
    exit_code: r.status,
    ok: r.status === 0,
    stdout_tail: (r.stdout || '').slice(-500),
    stderr_tail: (r.stderr || '').slice(-500),
  };
}

function evaluateRecommendationsThresholds() {
  const policy = readJson(path.join(AI, 'phase33d-acceptance-policy.json'));
  const metricsPath = '/tmp/phase33d-negotiation-recommendations/recommendation-metrics.json';
  let measured = null;
  if (fs.existsSync(metricsPath)) {
    measured = readJson(metricsPath);
  } else {
    // Run evaluator if needed
    const ev = spawnSync(process.execPath, [path.join(AI, 'evaluate-phase33d-recommendations.mjs')], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    if (fs.existsSync(metricsPath)) measured = readJson(metricsPath);
    else {
      return {
        status: 'BLOCKED',
        reason: 'recommendation_metrics_unavailable',
        evaluator_exit: ev.status,
      };
    }
  }
  const thr = policy.development_quality_thresholds || {};
  const failing = [];
  const p5 = measured.Precision_at_5 ?? measured.precision_at_5 ?? measured.precisionAt5;
  const r5 = measured.Recall_at_5 ?? measured.recall_at_5 ?? measured.recallAt5;
  if (typeof p5 === 'number' && p5 < (thr.precision_at_5_min ?? 0)) {
    failing.push({
      metric: 'Precision@5',
      measured: p5,
      threshold: thr.precision_at_5_min,
      delta: p5 - thr.precision_at_5_min,
    });
  }
  if (typeof r5 === 'number' && r5 < (thr.recall_at_5_min ?? 0)) {
    failing.push({
      metric: 'Recall@5',
      measured: r5,
      threshold: thr.recall_at_5_min,
      delta: r5 - thr.recall_at_5_min,
    });
  }
  return {
    status: failing.length ? 'BLOCKED' : 'READY',
    measured: { precision_at_5: p5, recall_at_5: r5 },
    failing_policy_metrics: failing,
  };
}

function capabilityStatuses({ retrieval, recommendations, packageChecks }) {
  const semanticBlocked = (retrieval.failing_policy_metrics || []).some(
    (f) => f.mode === 'semantic_fixture' && f.class === 'quality_threshold',
  );
  const keywordBlocked = (retrieval.failing_policy_metrics || []).some(
    (f) => f.mode === 'keyword' && f.class === 'quality_threshold',
  );
  const hybridBlocked = (retrieval.failing_policy_metrics || []).some(
    (f) => f.mode === 'hybrid_fixture' && f.class === 'quality_threshold',
  );

  return {
    scarcity: packageChecks.phase33c ? 'READY' : 'BLOCKED',
    valuation: packageChecks.phase33c ? 'READY' : 'BLOCKED',
    auction_intelligence: packageChecks.phase33c ? 'READY' : 'BLOCKED',
    embeddings: packageChecks.phase33b ? 'READY' : 'BLOCKED',
    semantic_search: semanticBlocked || keywordBlocked || hybridBlocked ? 'BLOCKED' : 'READY',
    negotiation: packageChecks.phase33d ? 'READY' : 'BLOCKED',
    recommendations: recommendations.status === 'READY' && packageChecks.phase33d ? 'READY' : 'BLOCKED',
    market_analytics: packageChecks.phase33e ? 'READY' : 'BLOCKED',
    memory_recall: packageChecks.phase33e ? 'READY' : 'BLOCKED',
  };
}

export function refuseCanaryRootCreation({ reason }) {
  if (fs.existsSync(CANARY_ROOT)) {
    // Do not delete existing roots; record conflict.
    return {
      canary_root: CANARY_ROOT,
      canary_root_exists: true,
      refused_new_launch: true,
      reason,
      note: 'Existing canary root present; readiness refuse does not mutate evidence roots',
    };
  }
  return {
    canary_root: CANARY_ROOT,
    canary_root_exists: false,
    refused_new_launch: true,
    reason,
  };
}

export function evaluatePhase33fReadiness({
  outDir = READINESS_OUT,
  createCanaryRootIfReady = false,
} = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const policy = readJson(path.join(AI, 'phase33f-acceptance-policy.json'));
  if (policy.threshold_changes_allowed !== 0) {
    throw new Error('threshold_changes_not_allowed');
  }

  const retrieval = evaluateRetrievalQualityGates();
  writeJson(path.join(outDir, 'retrieval-quality.json'), retrieval);

  const packageChecks = {
    phase33a: runNodeVerify('scripts/ai-platform/verify-intelligence-capability-contracts.mjs').ok,
    phase33b: runNodeVerify('scripts/ai-platform/verify-phase33b-retrieval-corpus.mjs').ok,
    phase33c: runNodeVerify('scripts/ai-platform/verify-phase33c.mjs').ok,
    phase33d: runNodeVerify('scripts/ai-platform/verify-phase33d.mjs').ok,
    phase33e: runNodeVerify('scripts/ai-platform/verify-phase33e.mjs').ok,
  };
  writeJson(path.join(outDir, 'offline-policy-results.json'), { packageChecks, retrieval_status: retrieval.status });

  const recommendations = evaluateRecommendationsThresholds();
  writeJson(path.join(outDir, 'capability-metrics.json'), { recommendations });

  const manifestPath = path.join(AI, 'phase33f-capability-gauntlet-manifest.json');
  let manifestSummary = { status: 'FAIL', violations: ['manifest_missing'] };
  let manifestSha = null;
  if (fs.existsSync(manifestPath)) {
    const { rows, raw } = loadManifest(manifestPath);
    manifestSummary = validateManifestRows(rows);
    manifestSha = raw.manifest_sha || hashManifest(rows);
  }
  writeJson(path.join(outDir, 'manifest-summary.json'), { ...manifestSummary, manifest_sha: manifestSha });

  const caps = capabilityStatuses({ retrieval, recommendations, packageChecks });
  const blockedCaps = Object.entries(caps)
    .filter(([, v]) => v === 'BLOCKED')
    .map(([k]) => k);

  const failing = [
    ...(retrieval.failing_policy_metrics || []).map((f) => ({ source: 'retrieval', ...f })),
    ...(recommendations.failing_policy_metrics || []).map((f) => ({ source: 'recommendations', ...f })),
  ];
  if (!packageChecks.phase33a) failing.push({ source: 'phase33a', metric: 'contracts', measured: 'FAIL' });
  if (!packageChecks.phase33b) failing.push({ source: 'phase33b', metric: 'corpus', measured: 'FAIL' });
  if (!packageChecks.phase33c) failing.push({ source: 'phase33c', metric: 'intelligence', measured: 'FAIL' });
  if (!packageChecks.phase33d) failing.push({ source: 'phase33d', metric: 'negotiation_recommendations', measured: 'FAIL' });
  if (!packageChecks.phase33e) failing.push({ source: 'phase33e', metric: 'analytics_memory', measured: 'FAIL' });
  if (manifestSummary.status !== 'PASS') {
    failing.push({ source: 'manifest', metric: 'validation', measured: manifestSummary.violations?.slice(0, 5) });
  }

  const ready = failing.length === 0 && blockedCaps.length === 0;
  const status = ready ? 'READY' : 'BLOCKED';

  let canary = refuseCanaryRootCreation({
    reason: ready ? 'ready_but_create_flag_controls_launch' : 'offline_capability_quality_gate',
  });
  if (ready && createCanaryRootIfReady) {
    fs.mkdirSync(CANARY_ROOT, { recursive: true });
    canary = { canary_root: CANARY_ROOT, canary_root_exists: true, created: true };
  } else if (!ready) {
    canary = refuseCanaryRootCreation({ reason: 'offline_capability_quality_gate' });
  }

  const capabilityReadiness = {
    phase: '33F',
    status,
    banner: ready
      ? 'PHASE 33F CANARY READY — NOT LAUNCHED'
      : blockedCaps.includes('semantic_search')
        ? 'PHASE 33F BLOCKED — SEMANTIC RETRIEVAL QUALITY GATE'
        : 'PHASE 33F BLOCKED — OFFLINE CAPABILITY QUALITY GATE',
    capabilities: caps,
    failing_policy_metrics: failing,
    threshold_changes: 0,
    canary,
    target: {
      root: TARGET_ROOT,
      target_launched: false,
      requires_separate_owner_approval: true,
    },
    production: policy.production_hard_stops,
    manifest_sha: manifestSha,
  };

  writeJson(path.join(outDir, 'capability-readiness.json'), capabilityReadiness);
  writeJson(path.join(outDir, 'scenario-coverage.json'), manifestSummary.summary || {});
  writeJson(path.join(outDir, 'privacy-isolation.json'), {
    note: 'offline_hard_stops_revalidated_via_phase33_packages',
  });
  writeJson(path.join(outDir, 'safety-results.json'), {
    automatic_send_allowed: false,
    production_mutation_allowed: false,
  });
  writeJson(path.join(outDir, 'production-mutation-audit.json'), {
    production_mutations: 0,
    production_embedding_writes: false,
    production_db_migration: false,
  });
  writeJson(path.join(outDir, 'memory-recall.json'), {
    status: caps.memory_recall,
    durable_private_memory_authorized: false,
  });
  writeJson(path.join(outDir, 'canary-verdict.json'), {
    launched: false,
    status,
    reason: ready ? 'readiness_pass_canary_not_auto_launched' : 'blocked_offline_quality',
  });
  writeJson(path.join(outDir, 'target-launch-package.json'), {
    prepared: false,
    launched: false,
    root: TARGET_ROOT,
    probes: 17280,
    requires_separate_owner_approval: true,
  });

  const md = [
    `# ${capabilityReadiness.banner}`,
    '',
    `- Status: ${status}`,
    `- Threshold changes: 0`,
    `- Canary root exists: ${canary.canary_root_exists}`,
    `- Target launched: NO`,
    '',
    '## Capability status',
    ...Object.entries(caps).map(([k, v]) => `- ${k}: ${v}`),
    '',
    '## Failing policy metrics',
    failing.length
      ? failing
          .map(
            (f) =>
              `- ${f.source || ''} ${f.mode || ''} ${f.metric}: measured=${f.measured} threshold=${f.threshold} delta=${f.delta}`,
          )
          .join('\n')
      : '- none',
    '',
    '## Remediation',
    status === 'BLOCKED'
      ? [
          '- Improve semantic_fixture holdout quality above retrieval-acceptance-policy floors (Recall@5_min=0.35).',
          '- Tune only on development; select on validation; accept only on frozen holdout.',
          '- Do not reinterpret protocol parity as semantic correctness.',
          '- Do not lower thresholds or silently fall back to keyword/hybrid.',
          '- Re-run make ai-platform-verify-phase33f-semantic and make ai-platform-verify-phase33f-readiness after remediation.',
          '- Do not create /tmp/phase33f-capability-gauntlet-canary-v1 until READY.',
        ].join('\n')
      : '- Readiness PASS on frozen holdout; canary still requires separate owner approval and remains NOT LAUNCHED.',
    '',
    'Production: NOT APPROVED',
    'Phase 33G: NOT LAUNCHED',
  ];
  fs.writeFileSync(path.join(outDir, 'final-report.md'), `${md.join('\n')}\n`, 'utf8');

  return capabilityReadiness;
}

// silence unused
void metricKeyToPolicy;
void CAPABILITIES;
