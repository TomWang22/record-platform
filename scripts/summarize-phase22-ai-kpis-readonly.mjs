#!/usr/bin/env node
/**
 * Read-only Phase 22 KPI summarizer — local JSON/JSONL smoke outputs only.
 * No raw response bodies. Exit 0 when no input files exist.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_GLOBS = [
  'bench_logs/ai-platform/phase22/**/*.json',
  'bench_logs/ai-platform/phase22/**/*.jsonl',
  '/tmp/phase22-*.json',
  '/tmp/phase22-*.jsonl',
];

function parseGlobPattern(pattern) {
  if (pattern.startsWith('/tmp/')) {
    const dir = '/tmp';
    const re = /^\/tmp\/phase22-.*\.(jsonl?)$/;
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((name) => re.test(path.join('/tmp', name)))
      .map((name) => path.join('/tmp', name));
  }
  const rel = pattern.replace(/^\.\//, '');
  const absDirect = path.isAbsolute(rel) ? rel : path.join(REPO_ROOT, rel);
  if (!rel.includes('**/') && fs.existsSync(absDirect) && fs.statSync(absDirect).isFile()) {
    return [absDirect];
  }
  const base = path.join(REPO_ROOT, rel.split('/**/')[0]);
  if (!fs.existsSync(base)) return [];
  const ext = rel.endsWith('.jsonl') ? '.jsonl' : '.json';
  const out = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(ext)) out.push(full);
    }
  }
  walk(base);
  return out;
}

function collectInputFiles() {
  const envGlob = process.env.PHASE22_KPI_INPUT_GLOB;
  const patterns = envGlob ? envGlob.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_GLOBS;
  const seen = new Set();
  const files = [];
  for (const pattern of patterns) {
    for (const file of parseGlobPattern(pattern)) {
      const abs = path.resolve(file);
      if (!seen.has(abs) && fs.existsSync(abs)) {
        seen.add(abs);
        files.push(abs);
      }
    }
  }
  return files.sort();
}

function loadRowsFromFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').trim();
  if (!text) return [];
  if (filePath.endsWith('.jsonl')) {
    return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  }
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.results)) return parsed.results;
  if (parsed && parsed.results && Array.isArray(parsed.results.results)) return parsed.results.results;
  if (parsed && parsed.protocol_matrix_total != null && parsed.http200 != null) {
    return [];
  }
  return [];
}

function loadSummaryFile(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (parsed && parsed.protocol_matrix_total != null) return parsed;
  return null;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function isPass(value) {
  return String(value || '').toUpperCase() === 'PASS';
}

function main() {
  const files = collectInputFiles();
  const phase22cSummary = files
    .filter((f) => f.includes('phase22c-matrix-summary') || f.includes('phase22c-matrix-summary.json'))
    .sort()
    .pop();
  if (phase22cSummary) {
    const summaryDoc = loadSummaryFile(phase22cSummary);
    if (summaryDoc) {
      const output = `${JSON.stringify({
        status: summaryDoc.status || 'PASS',
        source: 'phase22c-matrix-summary',
        input_files: 1,
        total_cases: summaryDoc.protocol_matrix_total,
        response_pass_rate: summaryDoc.response_pass_rate,
        sentiment_pass_rate: summaryDoc.sentiment_pass_rate,
        red_team_safety_pass_rate: summaryDoc.red_team_safety_pass_rate,
        grounding_pass_rate: summaryDoc.grounding_pass_rate,
        fallback_count: summaryDoc.fallback_count,
        leakage_failures: summaryDoc.leakage_failures,
        http200_by_protocol: summaryDoc.http200_by_protocol,
        gate_reason_counts: summaryDoc.gate_reason_counts,
        latency: {
          by_protocol: summaryDoc.latency_by_protocol,
          by_case: summaryDoc.latency_by_case,
        },
        notes: [
          'Loaded from Phase 22C matrix summary JSON (no raw response bodies)',
          'Protocol matrix is separate from Phase 21 cumulative 57105',
        ],
      }, null, 2)}\n`;
      process.stdout.write(output);
      process.exit(0);
    }
  }

  const summaryFiles = files.filter((f) => f.endsWith('-summary.json') || f.endsWith('summary.json'));
  if (!files.length && !summaryFiles.length) {
    console.log('NO_DATA: KPI summarizer found no local Phase 22 result files');
    process.exit(0);
  }

  if (!files.some((f) => f.endsWith('.jsonl')) && summaryFiles.length) {
    const summaryDoc = loadSummaryFile(summaryFiles[summaryFiles.length - 1]);
    if (summaryDoc) {
      const output = `${JSON.stringify({
        status: summaryDoc.status || 'PASS',
        source: 'phase22-summary-json',
        input_files: summaryFiles.length,
        total_cases: summaryDoc.protocol_matrix_total,
        response_pass_rate: summaryDoc.response_pass_rate,
        sentiment_pass_rate: summaryDoc.sentiment_pass_rate,
        red_team_safety_pass_rate: summaryDoc.red_team_safety_pass_rate,
        grounding_pass_rate: summaryDoc.grounding_pass_rate,
        fallback_count: summaryDoc.fallback_count,
        leakage_failures: summaryDoc.leakage_failures,
        http200_by_protocol: summaryDoc.http200_by_protocol,
        gate_reason_counts: summaryDoc.gate_reason_counts,
        latency: {
          by_protocol: summaryDoc.latency_by_protocol,
          by_case: summaryDoc.latency_by_case,
        },
        notes: [
          'Loaded from Phase 22C summary JSON (no raw response bodies)',
          'Protocol matrix is separate from Phase 21 cumulative 57105',
        ],
      }, null, 2)}\n`;
      process.stdout.write(output);
      process.exit(0);
    }
  }

  const rows = [];
  for (const file of files) {
    try {
      rows.push(...loadRowsFromFile(file));
    } catch (err) {
      console.error(`WARN: skipped ${file}: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (!rows.length) {
    console.log('NO_DATA: KPI summarizer found no local Phase 22 result files');
    process.exit(0);
  }

  const protocols = {};
  let responsePass = 0;
  let sentimentRequired = 0;
  let sentimentPass = 0;
  let fallbackCount = 0;
  let leakageFailures = 0;
  let redTeamTotal = 0;
  let redTeamPass = 0;
  let groundingPass = 0;
  const ragLatencies = [];
  const qualityScores = [];

  for (const row of rows) {
    const protocol = row.protocol || 'unknown';
    if (!protocols[protocol]) {
      protocols[protocol] = { cases: 0, response_pass: 0, sentiment_pass: 0 };
    }
    protocols[protocol].cases += 1;
    if (isPass(row.response_pass)) {
      responsePass += 1;
      protocols[protocol].response_pass += 1;
    }
    if (row.sentiment_required === true || row.intent === 'sentiment_analysis') {
      sentimentRequired += 1;
      if (isPass(row.sentiment_pass)) {
        sentimentPass += 1;
        protocols[protocol].sentiment_pass += 1;
      }
    } else if (isPass(row.sentiment_pass)) {
      protocols[protocol].sentiment_pass += 1;
    }
    fallbackCount += Number(row.fallback_count || 0);
    if (!isPass(row.leakage_pass) && row.leakage_pass != null) leakageFailures += 1;
    if (isPass(row.grounding_pass) || isPass(row.response_pass)) groundingPass += 1;
    if (row.intent === 'safety_refusal') {
      redTeamTotal += 1;
      if (isPass(row.response_pass) && isPass(row.leakage_pass)) redTeamPass += 1;
    }
    if (typeof row.rag_total_ms === 'number' && Number.isFinite(row.rag_total_ms)) {
      ragLatencies.push(row.rag_total_ms);
    }
    if (typeof row.quality_score === 'number' && Number.isFinite(row.quality_score)) {
      qualityScores.push(row.quality_score);
    }
  }

  const totalCases = rows.length;
  const summary = {
    status: responsePass === totalCases && leakageFailures === 0 && fallbackCount === 0 ? 'PASS' : 'BLOCKED',
    input_files: files.length,
    total_cases: totalCases,
    protocols,
    response_pass_rate: totalCases ? responsePass / totalCases : 0,
    sentiment_pass_rate: sentimentRequired ? sentimentPass / sentimentRequired : null,
    avg_quality_score: qualityScores.length
      ? qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length
      : null,
    worst_quality_score: qualityScores.length ? Math.min(...qualityScores) : null,
    red_team_safety_pass_rate: redTeamTotal ? redTeamPass / redTeamTotal : null,
    grounding_pass_rate: totalCases ? groundingPass / totalCases : 0,
    fallback_count: fallbackCount,
    leakage_failures: leakageFailures,
    latency: {
      rag_total_ms_p50: percentile(ragLatencies, 50),
      rag_total_ms_p95: percentile(ragLatencies, 95),
      rag_total_ms_max: ragLatencies.length ? Math.max(...ragLatencies) : null,
    },
    notes: [
      'No raw response bodies included',
      'Protocol smoke is not counted in cumulative live matrix',
      'Usefulness metrics are rubric pass rates, not labeled model accuracy',
    ],
  };

  const output = `${JSON.stringify(summary, null, 2)}\n`;
  if (process.env.PHASE22_KPI_WRITE_SUMMARY === '1') {
    const outPath = process.env.PHASE22_KPI_SUMMARY_OUT
      || path.join(REPO_ROOT, 'bench_logs/ai-platform/phase22/kpi-summary.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, output);
    console.log(`summary_written=${outPath}`);
  } else {
    process.stdout.write(output);
  }
}

main();
