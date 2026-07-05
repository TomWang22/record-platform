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
  return [];
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
  if (!files.length) {
    console.log('NO_DATA: KPI summarizer found no local Phase 22 result files');
    process.exit(0);
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
