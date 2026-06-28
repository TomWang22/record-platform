#!/usr/bin/env node
/**
 * P21.5 — Aggregate local AI product-quality artifacts into markdown + JSON reports.
 * Local-only output under bench_logs/ai-platform/quality-telemetry/ (never committed).
 *
 * Usage:
 *   node scripts/ai-quality-telemetry-report.mjs
 *   node scripts/ai-quality-telemetry-report.mjs --stamp seller-intelligence:4
 *   node scripts/ai-quality-telemetry-report.mjs --repo-root /path/to/repo
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const THRESHOLDS = {
  record_intelligence_avg_score: { op: 'gte', value: 3.5 },
  longform_avg_score: { op: 'gte', value: 3.5 },
  final_turn_score: { op: 'gte', value: 4.0 },
  leakage_pass: { op: 'eq', value: true },
  old_boilerplate_regression: { op: 'eq', value: false },
  source_refs_present_rate: { op: 'gte', value: 0.95 },
  source_excerpt_present_rate: { op: 'gte', value: 0.8 },
  ui_latency_p95_ms: { op: 'lte', value: 15000 },
  endpoint_latency_p95_ms: { op: 'lte', value: 12000 },
};

export const FORBIDDEN_PATTERN =
  /demo|mock|sample fallback|placeholder|lorem ipsum|proxy max|max_bid_cents|proxy_bids|off[- ]campus|message_body|thread_text|private obo message/i;

export const OLD_BOILERPLATE = 'Retrieved 8 grounded excerpts for your question.';

export const ARTIFACT_ROOTS = {
  recordIntelligence: 'ui-record-intelligence',
  longform: 'longform-rag-session',
  uiInference: 'ui-inference',
  sellerIntelligence: 'seller-intelligence-ui',
};

export const EXPECTED_SELLER_PANELS = 4;

export const STRUCTURED_SELLER_ENDPOINTS = [
  'listing-advice',
  'negotiation-strategy',
  'auction-pressure',
  'collector-metadata-gaps',
];

/** @param {number[]} values @param {number} p */
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[idx] * 10) / 10;
}

/** @param {unknown} value @param {{ op: string, value: unknown }} rule */
export function evaluateThreshold(value, rule) {
  if (value === null || value === undefined) return 'WARN';
  switch (rule.op) {
    case 'gte':
      return Number(value) >= Number(rule.value) ? 'PASS' : 'WARN';
    case 'lte':
      return Number(value) <= Number(rule.value) ? 'PASS' : 'WARN';
    case 'eq':
      return value === rule.value ? 'PASS' : 'WARN';
    default:
      return 'WARN';
  }
}

/** @param {Record<string, unknown>} metrics */
export function evaluateAllThresholds(metrics) {
  /** @type {Record<string, 'PASS' | 'WARN'>} */
  const statuses = {};
  for (const [key, rule] of Object.entries(THRESHOLDS)) {
    statuses[key] = evaluateThreshold(metrics[key], rule);
  }
  return statuses;
}

/** @param {string} text */
export function countForbiddenHits(text) {
  if (!text) return 0;
  const m = text.match(new RegExp(FORBIDDEN_PATTERN.source, 'gi'));
  return m ? m.length : 0;
}

/** @param {string} text */
export function parseCompletenessScore(text) {
  if (!text) return null;
  const m = text.match(/completeness score:\s*(\d+)\s*\/\s*100/i);
  return m ? Number(m[1]) : null;
}

/** @param {string} dir */
export function findLatestSessionJson(dir) {
  if (!existsSync(dir)) return null;
  /** @type {{ path: string, mtime: number }[]} */
  const candidates = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sessionDir = join(dir, entry.name);
    const jsonPath = join(sessionDir, `${entry.name}.json`);
    if (!existsSync(jsonPath)) continue;
    candidates.push({ path: jsonPath, mtime: statSync(jsonPath).mtimeMs });
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0]?.path ?? null;
}

/** @param {string} repoRoot */
export function resolveRepoRoot(repoRoot) {
  return repoRoot || join(__dirname, '..');
}

/** @param {string} repoRoot @param {string} subdir */
export function artifactBase(repoRoot, subdir) {
  return join(repoRoot, 'bench_logs', 'ai-platform', subdir);
}

/** @param {string} repoRoot */
export function loadStamps(repoRoot) {
  const path = join(repoRoot, 'bench_logs', 'ai-platform', 'quality-telemetry', 'stamps.json');
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

/** @param {string} repoRoot @param {Record<string, number>} stamps */
export function saveStamps(repoRoot, stamps) {
  const dir = join(repoRoot, 'bench_logs', 'ai-platform', 'quality-telemetry');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'stamps.json'), JSON.stringify(stamps, null, 2));
}

/** @param {string} repoRoot */
export function gitHeadSha(repoRoot) {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * @param {Record<string, unknown>[]} rows
 * @returns {{ refsRate: number|null, excerptRate: number|null }}
 */
export function sourceCoverageFromRows(rows) {
  if (!rows.length) return { refsRate: null, excerptRate: null };
  let refsOk = 0;
  let excerptOk = 0;
  for (const row of rows) {
    const refs = Number(row.refs_count ?? 0);
    if (refs > 0) refsOk += 1;
    const excerpt =
      String(row.response_source_excerpt ?? row.api_source_excerpt_1 ?? row.visible_source_excerpt ?? '').trim();
    if (excerpt.length > 10) excerptOk += 1;
  }
  return {
    refsRate: Math.round((refsOk / rows.length) * 1000) / 1000,
    excerptRate: Math.round((excerptOk / rows.length) * 1000) / 1000,
  };
}

/** @param {Record<string, unknown>[]} rows */
export function synthesisTemplateCounts(rows) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const row of rows) {
    const t = String(row.synthesis_template ?? 'unknown');
    counts[t] = (counts[t] ?? 0) + 1;
  }
  return counts;
}

/** @param {string} repoRoot */
export function loadContractAudit(repoRoot) {
  const path = join(repoRoot, 'bench_logs', 'ai-platform', 'python-ai-ollama-contract.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {string} repoRoot
 * @param {{ stamps?: Record<string, number> }} opts
 */
export function aggregateTelemetry(repoRoot, opts = {}) {
  const roots = {
    recordIntel: findLatestSessionJson(artifactBase(repoRoot, ARTIFACT_ROOTS.recordIntelligence)),
    longform: findLatestSessionJson(artifactBase(repoRoot, ARTIFACT_ROOTS.longform)),
    uiInference: findLatestSessionJson(artifactBase(repoRoot, ARTIFACT_ROOTS.uiInference)),
    sellerIntel: findLatestSessionJson(artifactBase(repoRoot, ARTIFACT_ROOTS.sellerIntelligence)),
  };

  /** @type {Record<string, string|null>} */
  const sources = {
    record_intelligence: roots.recordIntel,
    longform: roots.longform,
    ui_inference: roots.uiInference,
    seller_intelligence: roots.sellerIntel,
  };

  /** @type {Record<string, unknown>[]} */
  const allRows = [];
  /** @type {number[]} */
  const uiLatencies = [];
  /** @type {number[]} */
  const apiLatencies = [];
  let http200 = 0;
  let httpTotal = 0;
  let forbiddenHits = 0;
  let oldBoilerplate = false;
  let leakagePass = true;
  let completenessScores = [];

  /** @type {Record<string, unknown>|null} */
  let recordSession = null;
  /** @type {Record<string, unknown>|null} */
  let longformSession = null;
  /** @type {Record<string, unknown>|null} */
  let inferenceSession = null;
  /** @type {Record<string, unknown>|null} */
  let sellerSession = null;

  if (roots.sellerIntel) {
    try {
      sellerSession = JSON.parse(readFileSync(roots.sellerIntel, 'utf8'));
      const panels = /** @type {Record<string, unknown>[]} */ (sellerSession.panels ?? []);
      for (const p of panels) {
        const apiMs = Number(p.api_ms ?? 0);
        if (apiMs > 0) apiLatencies.push(apiMs);
        httpTotal += 1;
        if (Number(p.http_status) === 200) http200 += 1;
        if (p.leakage_result !== 'PASS') leakagePass = false;
      }
    } catch {
      sellerSession = null;
    }
  }
  if (roots.recordIntel) {
    recordSession = JSON.parse(readFileSync(roots.recordIntel, 'utf8'));
    const cases = /** @type {Record<string, unknown>[]} */ (recordSession.cases ?? []);
    allRows.push(...cases);
    for (const c of cases) {
      uiLatencies.push(Number(c.ui_total_ms ?? 0));
      apiLatencies.push(Number(c.network_request_ms ?? 0));
      httpTotal += 1;
      if (Number(c.http_status) === 200) http200 += 1;
      forbiddenHits += countForbiddenHits(String(c.answer_text ?? ''));
      if (c.old_boilerplate_only) oldBoilerplate = true;
      if (c.leakage_result !== 'PASS') leakagePass = false;
      const cs = parseCompletenessScore(String(c.answer_text ?? ''));
      if (cs !== null) completenessScores.push(cs);
    }
  }

  if (roots.longform) {
    longformSession = JSON.parse(readFileSync(roots.longform, 'utf8'));
    const turns = /** @type {Record<string, unknown>[]} */ (longformSession.turns ?? []);
    allRows.push(...turns);
    for (const t of turns) {
      uiLatencies.push(Number(t.ui_total_ms ?? 0));
      apiLatencies.push(Number(t.api_ms ?? 0));
      httpTotal += 1;
      if (Number(t.http_status) === 200) http200 += 1;
      forbiddenHits += countForbiddenHits(String(t.answer_text ?? ''));
      if (t.old_boilerplate_present) oldBoilerplate = true;
      if (t.leakage_result !== 'PASS') leakagePass = false;
      const cs = parseCompletenessScore(String(t.answer_text ?? ''));
      if (cs !== null) completenessScores.push(cs);
    }
  }

  if (roots.uiInference) {
    inferenceSession = JSON.parse(readFileSync(roots.uiInference, 'utf8'));
    const cases = /** @type {Record<string, unknown>[]} */ (inferenceSession.cases ?? []);
    allRows.push(...cases);
    for (const c of cases) {
      uiLatencies.push(Number(c.ui_total_ms ?? 0));
      apiLatencies.push(Number(c.network_request_ms ?? 0));
      httpTotal += 1;
      if (Number(c.http_status) === 200) http200 += 1;
      forbiddenHits += countForbiddenHits(String(c.answer_text ?? ''));
      if (c.old_boilerplate_only) oldBoilerplate = true;
      if (c.leakage_result !== 'PASS') leakagePass = false;
    }
  }

  const coverage = sourceCoverageFromRows(allRows);
  const templateCounts = synthesisTemplateCounts(allRows);

  const recordAgg = recordSession?.aggregate ?? {};
  const longformAgg = longformSession?.aggregate ?? {};
  const inferenceAgg = inferenceSession?.aggregate ?? {};

  if (recordAgg.old_boilerplate_regression) oldBoilerplate = true;
  if (longformAgg.old_boilerplate_regression) oldBoilerplate = true;
  if (inferenceAgg.old_boilerplate_regression) oldBoilerplate = true;
  if (recordAgg.leakage === 'FAIL' || longformAgg.leakage === 'FAIL' || inferenceAgg.leakage === 'FAIL') {
    leakagePass = false;
  }

  const stamps = { ...loadStamps(repoRoot), ...(opts.stamps ?? {}) };
  let sellerPanelsPassed = stamps['seller-intelligence'] ?? null;
  if (sellerSession) {
    sellerPanelsPassed = Number(
      sellerSession.aggregate?.panels_passed ?? sellerSession.aggregate?.panels_pass ?? sellerPanelsPassed,
    );
  }

  const contract = loadContractAudit(repoRoot);
  /** @type {{ id: string, status: string }[]} */
  const contractChecks = contract?.checks ?? [];
  const structuredEndpointStatus = contractChecks.filter((c) => c.id?.startsWith('endpoint_'));
  const contractPassCount = structuredEndpointStatus.filter((c) => c.status === 'pass').length;

  let sessionMemoryTurnCount = null;
  let sessionMemoryContextRetention = longformAgg.context_retention_turns_9_12 ?? null;
  const sessionStart = contract?.samples?.session_start;
  if (sessionStart?.details?.session_memory?.turn_count !== undefined) {
    sessionMemoryTurnCount = Number(sessionStart.details.session_memory.turn_count);
  }
  if (longformSession?.turns?.length) {
    sessionMemoryTurnCount = longformSession.turns.length;
  }

  const collectorCompleteness =
    completenessScores.length > 0
      ? Math.round(completenessScores.reduce((a, b) => a + b, 0) / completenessScores.length)
      : null;

  const metrics = {
    record_intelligence_avg_score: recordAgg.avg_domain_score ?? null,
    longform_avg_score: longformAgg.avg_score ?? null,
    final_turn_score: longformAgg.final_turn_score ?? null,
    seller_panels_count: EXPECTED_SELLER_PANELS,
    seller_panels_passed: sellerPanelsPassed,
    seller_dashboard_ready_ms: sellerSession?.seller_dashboard_ready_ms ?? null,
    seller_panel_api_p95_ms: sellerSession?.aggregate?.p95_api_ms ?? null,
    rag_ready_ms: sellerSession?.rag_ready_ms ?? null,
    endpoint_http_200_count: http200,
    endpoint_http_total: httpTotal,
    endpoint_latency_p50_ms: percentile(apiLatencies, 50),
    endpoint_latency_p95_ms: percentile(apiLatencies, 95),
    ui_latency_p50_ms: percentile(uiLatencies, 50),
    ui_latency_p95_ms: percentile(uiLatencies, 95),
    leakage_pass: leakagePass,
    forbidden_hit_count: forbiddenHits,
    source_refs_present_rate: coverage.refsRate,
    source_excerpt_present_rate: coverage.excerptRate,
    collector_completeness_score: collectorCompleteness,
    session_memory_turn_count: sessionMemoryTurnCount,
    session_memory_context_retention: sessionMemoryContextRetention,
    synthesis_template_counts: templateCounts,
    old_boilerplate_regression: oldBoilerplate,
    structured_endpoint_pass_count: contractPassCount,
    structured_endpoint_total: structuredEndpointStatus.length,
    contract_audit_exit_code: contract?.exit_code ?? null,
  };

  const thresholdStatuses = evaluateAllThresholds(metrics);
  const warns = Object.entries(thresholdStatuses)
    .filter(([, s]) => s === 'WARN')
    .map(([k]) => k);

  return {
    generated_at: new Date().toISOString(),
    baseline_sha: gitHeadSha(repoRoot),
    artifact_sources: sources,
    metrics,
    threshold_statuses: thresholdStatuses,
    warns,
    structured_endpoints: structuredEndpointStatus,
    contract_finished_at: contract?.finished_at ?? null,
  };
}

/** @param {ReturnType<typeof aggregateTelemetry>} summary */
export function buildMarkdownReport(summary) {
  const m = summary.metrics;
  const ts = summary.threshold_statuses;
  const lines = [
    '# AI quality telemetry report (P21.5)',
    '',
    `Generated: ${summary.generated_at}`,
    `Baseline SHA: \`${summary.baseline_sha}\``,
    '',
    '## 1. Executive status',
    '',
    `- Record intelligence avg: **${m.record_intelligence_avg_score ?? 'n/a'}** (${ts.record_intelligence_avg_score})`,
    `- Longform avg: **${m.longform_avg_score ?? 'n/a'}** (${ts.longform_avg_score})`,
    `- Final turn score: **${m.final_turn_score ?? 'n/a'}** (${ts.final_turn_score})`,
    `- Leakage: **${m.leakage_pass ? 'PASS' : 'FAIL'}** (${ts.leakage_pass})`,
    `- WARN count: **${summary.warns.length}**`,
    `- Vector rollout: **NOT APPROVED**`,
    `- T20.14/T20.15: **BLOCKED**`,
    '',
    '## 2. Scorecard',
    '',
    '| Metric | Value | Threshold | Status |',
    '| ------ | ----: | --------- | ------ |',
    `| record_intelligence_avg_score | ${fmt(m.record_intelligence_avg_score)} | ≥3.5 | ${ts.record_intelligence_avg_score} |`,
    `| longform_avg_score | ${fmt(m.longform_avg_score)} | ≥3.5 | ${ts.longform_avg_score} |`,
    `| final_turn_score | ${fmt(m.final_turn_score)} | ≥4.0 | ${ts.final_turn_score} |`,
    `| leakage_pass | ${m.leakage_pass} | true | ${ts.leakage_pass} |`,
    `| source_refs_present_rate | ${fmt(m.source_refs_present_rate)} | ≥0.95 | ${ts.source_refs_present_rate} |`,
    `| source_excerpt_present_rate | ${fmt(m.source_excerpt_present_rate)} | ≥0.80 | ${ts.source_excerpt_present_rate} |`,
    `| ui_latency_p95_ms | ${fmt(m.ui_latency_p95_ms)} | ≤15000 | ${ts.ui_latency_p95_ms} |`,
    `| endpoint_latency_p95_ms | ${fmt(m.endpoint_latency_p95_ms)} | ≤12000 | ${ts.endpoint_latency_p95_ms} |`,
    '',
    '## 3. Latency table',
    '',
    '| Layer | p50 (ms) | p95 (ms) |',
    '| ----- | -------: | -------: |',
    `| UI | ${fmt(m.ui_latency_p50_ms)} | ${fmt(m.ui_latency_p95_ms)} |`,
    `| API/network | ${fmt(m.endpoint_latency_p50_ms)} | ${fmt(m.endpoint_latency_p95_ms)} |`,
    '',
    '## 4. Endpoint health',
    '',
    `- HTTP 200: **${m.endpoint_http_200_count}/${m.endpoint_http_total}**`,
    `- Structured contract checks: **${m.structured_endpoint_pass_count}/${m.structured_endpoint_total}** pass`,
    `- Contract audit exit: **${m.contract_audit_exit_code ?? 'n/a'}**`,
    `- Seller panels passed: **${m.seller_panels_passed ?? 'unknown'}/${m.seller_panels_count}**`,
    `- Seller dashboard ready: **${fmt(m.seller_dashboard_ready_ms)} ms**`,
    `- Seller panel API p95: **${fmt(m.seller_panel_api_p95_ms)} ms**`,
    `- RAG ready (seller run): **${fmt(m.rag_ready_ms)} ms**`,
    '',
    '## 5. Source evidence coverage',
    '',
    `- Source refs present rate: **${fmt(m.source_refs_present_rate)}**`,
    `- Source excerpt present rate: **${fmt(m.source_excerpt_present_rate)}**`,
    '',
    '## 6. Leakage / safety',
    '',
    `- leakage_pass: **${m.leakage_pass}**`,
    `- forbidden_hit_count: **${m.forbidden_hit_count}**`,
    `- old_boilerplate_regression: **${m.old_boilerplate_regression}** (${ts.old_boilerplate_regression})`,
    '',
    '## 7. Template distribution',
    '',
    ...Object.entries(m.synthesis_template_counts).map(([k, v]) => `- \`${k}\`: ${v}`),
    '',
    '## 8. Session memory state',
    '',
    `- session_memory_turn_count: **${m.session_memory_turn_count ?? 'n/a'}**`,
    `- session_memory_context_retention (turns 9–12): **${m.session_memory_context_retention ?? 'n/a'}**`,
    `- collector_completeness_score (avg): **${m.collector_completeness_score ?? 'n/a'}**`,
    '',
    '## 9. Regressions',
    '',
    `- Old boilerplate regression: **${m.old_boilerplate_regression ? 'YES' : 'no'}**`,
    `- Threshold WARNs: ${summary.warns.length ? summary.warns.join(', ') : 'none'}`,
    '',
    '## 10. Recommended next actions',
    '',
    ...buildRecommendations(summary),
    '',
    '## Artifact sources',
    '',
    ...Object.entries(summary.artifact_sources).map(
      ([k, v]) => `- ${k}: ${v ? `\`${v}\`` : '_missing_'}`,
    ),
    '',
    '_Local-only report — do not commit bench_logs outputs._',
    '',
  ];
  return lines.join('\n');
}

/** @param {unknown} v */
function fmt(v) {
  if (v === null || v === undefined) return 'n/a';
  return String(v);
}

/** @param {ReturnType<typeof aggregateTelemetry>} summary */
function buildRecommendations(summary) {
  /** @type {string[]} */
  const rec = [];
  const m = summary.metrics;
  if (!summary.artifact_sources.longform) rec.push('- Run longform Playwright gauntlet to refresh longform artifacts.');
  if (!summary.artifact_sources.record_intelligence) {
    rec.push('- Run record intelligence Playwright acceptance to refresh domain scores.');
  }
  if (m.seller_panels_passed === null) {
    rec.push('- Stamp seller panel pass: `node scripts/ai-quality-telemetry-report.mjs --stamp seller-intelligence:4` after seller UI test.');
  }
  if (summary.warns.includes('ui_latency_p95_ms') || summary.warns.includes('endpoint_latency_p95_ms')) {
    rec.push('- Investigate UI/API latency p95; check cluster load and python-ai-service rollout.');
  }
  if (summary.warns.includes('source_excerpt_present_rate')) {
    rec.push('- Review source evidence UX — excerpt expansion coverage below 80%.');
  }
  if (!rec.length) rec.push('- Continue Phase 21 product track; refresh telemetry after each acceptance run.');
  rec.push('- Do **not** enable vector rollout (T20.14/T20.15 remain blocked).');
  return rec;
}

/** @param {string} repoRoot @param {{ stamps?: Record<string, number> }} opts */
export function writeTelemetryReport(repoRoot, opts = {}) {
  const summary = aggregateTelemetry(repoRoot, opts);
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const outDir = join(repoRoot, 'bench_logs', 'ai-platform', 'quality-telemetry');
  mkdirSync(outDir, { recursive: true });
  const mdPath = join(outDir, `${stamp}.md`);
  const jsonPath = join(outDir, `${stamp}.json`);
  writeFileSync(mdPath, buildMarkdownReport(summary));
  writeFileSync(jsonPath, JSON.stringify({ ...summary, report_md: mdPath, report_json: jsonPath }, null, 2));
  return { summary, mdPath, jsonPath, stamp };
}

function parseArgs(argv) {
  /** @type {{ repoRoot?: string, stamp?: Record<string, number> }} */
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo-root' && argv[i + 1]) {
      opts.repoRoot = argv[++i];
    } else if (argv[i] === '--stamp' && argv[i + 1]) {
      const [key, val] = argv[++i].split(':');
      opts.stamp = opts.stamp ?? {};
      opts.stamp[key] = Number(val);
    }
  }
  return opts;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolveRepoRoot(args.repoRoot);

  if (args.stamp) {
    const existing = loadStamps(repoRoot);
    saveStamps(repoRoot, { ...existing, ...args.stamp });
    console.log(`Stamps updated: ${JSON.stringify({ ...existing, ...args.stamp })}`);
  }

  const { summary, mdPath, jsonPath } = writeTelemetryReport(repoRoot, { stamps: args.stamp });
  console.log(`\nAI quality telemetry report written:`);
  console.log(`  MD:   ${mdPath}`);
  console.log(`  JSON: ${jsonPath}`);
  console.log(`\nWARNs (${summary.warns.length}): ${summary.warns.join(', ') || 'none'}`);
  console.log(
    `Scores — record: ${summary.metrics.record_intelligence_avg_score ?? 'n/a'}, longform: ${summary.metrics.longform_avg_score ?? 'n/a'}, final turn: ${summary.metrics.final_turn_score ?? 'n/a'}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
