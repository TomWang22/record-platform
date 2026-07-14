#!/usr/bin/env node
/**
 * Phase 32H R9 — OLS + Theil-Sen slope analysis vs completed batch index.
 */
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const opts = { timeseries: null, outJson: null, projectedBatch: 2880 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--timeseries') opts.timeseries = argv[++i];
    else if (argv[i] === '--out') opts.outJson = argv[++i];
    else if (argv[i] === '--projected-batch') opts.projectedBatch = Number(argv[++i]);
  }
  if (!opts.timeseries || !opts.outJson) {
    throw new Error('usage: --timeseries <jsonl> --out <json> [--projected-batch N]');
  }
  return opts;
}

function median(sorted) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function ols(xs, ys) {
  const n = xs.length;
  if (n < 2) return { slope: null, intercept: null, r2: null, ci95: null };
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    syy += ys[i] * ys[i];
    sxy += xs[i] * ys[i];
  }
  const den = n * sxx - sx * sx;
  if (den === 0) return { slope: 0, intercept: sy / n, r2: null, ci95: null };
  const slope = (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n;
  let ssRes = 0;
  let ssTot = 0;
  const yMean = sy / n;
  for (let i = 0; i < n; i += 1) {
    const pred = intercept + slope * xs[i];
    ssRes += (ys[i] - pred) ** 2;
    ssTot += (ys[i] - yMean) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  let ci95 = null;
  if (n > 2) {
    const xMean = sx / n;
    let sxxDev = 0;
    for (const x of xs) sxxDev += (x - xMean) ** 2;
    const mse = ssRes / (n - 2);
    const se = sxxDev > 0 ? Math.sqrt(mse / sxxDev) : null;
    // Approx normal critical value 1.96 for large n; still useful for n~40+.
    if (se != null && Number.isFinite(se)) {
      ci95 = { low: slope - 1.96 * se, high: slope + 1.96 * se, se };
    }
  }
  return { slope, intercept, r2, ci95 };
}

function theilSen(xs, ys) {
  const slopes = [];
  for (let i = 0; i < xs.length; i += 1) {
    for (let j = i + 1; j < xs.length; j += 1) {
      const dx = xs[j] - xs[i];
      if (dx === 0) continue;
      slopes.push((ys[j] - ys[i]) / dx);
    }
  }
  if (!slopes.length) return { slope: null, intercept: null };
  slopes.sort((a, b) => a - b);
  const slope = median(slopes);
  const residuals = ys.map((y, i) => y - slope * xs[i]).sort((a, b) => a - b);
  return { slope, intercept: median(residuals) };
}

function sliceWindow(samples, mode) {
  if (mode === 'full') return samples;
  if (mode === 'final_half') return samples.slice(Math.floor(samples.length / 2));
  if (mode === 'final_quarter') return samples.slice(Math.floor(samples.length * 0.75));
  throw new Error(`unknown window ${mode}`);
}

function metricSeries(samples, key) {
  const xs = [];
  const ys = [];
  for (const s of samples) {
    const x = Number(s.completed_batch ?? s.batch_complete);
    const y = Number(s[key]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    xs.push(x);
    ys.push(y);
  }
  return { xs, ys };
}

function summarizeMetric(samples, key) {
  const vals = samples.map((s) => Number(s[key])).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return {
    min: vals[0] ?? null,
    median: median(vals),
    p95: percentile(vals, 95),
    max: vals.length ? vals[vals.length - 1] : null,
    final: samples.length ? Number(samples[samples.length - 1][key]) : null,
    initial: samples.length ? Number(samples[0][key]) : null,
  };
}

function analyzeMetric(samples, key, projectedBatch) {
  const windows = {};
  for (const mode of ['full', 'final_half', 'final_quarter']) {
    const win = sliceWindow(samples, mode);
    const { xs, ys } = metricSeries(win, key);
    const o = ols(xs, ys);
    const t = theilSen(xs, ys);
    windows[mode] = {
      n: xs.length,
      batch_min: xs[0] ?? null,
      batch_max: xs[xs.length - 1] ?? null,
      ols_slope_mib_per_batch: o.slope,
      ols_intercept: o.intercept,
      ols_r2: o.r2,
      ols_ci95: o.ci95,
      theil_sen_slope_mib_per_batch: t.slope,
      theil_sen_intercept: t.intercept,
    };
  }
  const full = windows.full;
  const projOls =
    full.ols_slope_mib_per_batch == null
      ? null
      : full.ols_intercept + full.ols_slope_mib_per_batch * projectedBatch;
  const projTs =
    full.theil_sen_slope_mib_per_batch == null
      ? null
      : full.theil_sen_intercept + full.theil_sen_slope_mib_per_batch * projectedBatch;
  let projUpper = null;
  if (full.ols_ci95 && full.ols_intercept != null) {
    projUpper = full.ols_intercept + full.ols_ci95.high * projectedBatch;
  }
  return {
    summary: summarizeMetric(samples, key),
    windows,
    projected_batch: projectedBatch,
    projected_ols: projOls,
    projected_theil_sen: projTs,
    projected_ols_upper_ci95: projUpper,
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const lines = fs.readFileSync(opts.timeseries, 'utf8').trim().split(/\n+/).filter(Boolean);
  const samples = lines.map((l) => JSON.parse(l));
  const metrics = ['heap_used_mb', 'rss_mb', 'external_mb', 'array_buffers_mb'];
  const analysis = {
    timeseries: opts.timeseries,
    sample_count: samples.length,
    first_batch: samples[0]?.completed_batch ?? samples[0]?.batch_complete ?? null,
    last_batch: samples.at(-1)?.completed_batch ?? samples.at(-1)?.batch_complete ?? null,
    batch_span:
      samples.length > 1
        ? (samples.at(-1).completed_batch ?? samples.at(-1).batch_complete) -
          (samples[0].completed_batch ?? samples[0].batch_complete)
        : null,
    metrics: Object.fromEntries(metrics.map((m) => [m, analyzeMetric(samples, m, opts.projectedBatch)])),
  };
  fs.mkdirSync(path.dirname(opts.outJson), { recursive: true });
  fs.writeFileSync(opts.outJson, `${JSON.stringify(analysis, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ sample_count: analysis.sample_count, out: opts.outJson }, null, 2)}\n`);
}

main();
