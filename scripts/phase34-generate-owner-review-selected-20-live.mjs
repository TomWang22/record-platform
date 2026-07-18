#!/usr/bin/env node
/**
 * Curate exactly 20 high-signal PNGs from a frozen smoke-v4 PASS root
 * into /tmp/phase34-owner-review-selected-20-live/ with HTML + telemetry reports.
 *
 * NOT product acceptance — OWNER_VISUAL_REVIEW_REQUIRED.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPngDimensions } from './lib/phase34-product-screenshot-geometry.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.PHASE34_OWNER_REVIEW_20_OUT || '/tmp/phase34-owner-review-selected-20-live';
const SMOKE_ROOT =
  process.env.PHASE34_SMOKE_V4_ROOT || '/tmp/phase34-product-harness-live-smoke-v4';

const REQUIRED_NAMES = [
  '01-scarcity-loading.png',
  '02-scarcity-final-evidence.png',
  '03-valuation-listing-edit-before.png',
  '04-valuation-final-ranges.png',
  '05-auction-watchlist-temperature.png',
  '06-auction-seller-dashboard.png',
  '07-embeddings-lineage-current.png',
  '08-embeddings-lineage-stale.png',
  '09-search-mode-query.png',
  '10-search-results-why-matched.png',
  '11-negotiation-turn-01-strategy.png',
  '12-negotiation-turn-02-correction.png',
  '13-negotiation-turn-03-memory-change.png',
  '14-negotiation-turn-04-draft.png',
  '15-negotiation-insert-not-send.png',
  '16-recommendations-personalized.png',
  '17-recommendations-constraints.png',
  '18-market-analytics-report.png',
  '19-market-analytics-methodology.png',
  '20-memory-correction-forget.png',
];

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function percentileNearestRank(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length < 100 && p >= 99.9) return 'NOT_ESTIMABLE';
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

function pick(rows, pred) {
  return rows.find(pred) || null;
}

function main() {
  if (!fs.existsSync(path.join(SMOKE_ROOT, 'FROZEN_PASS_EVIDENCE'))) {
    const err = new Error(`smoke-v4 FROZEN_PASS_EVIDENCE missing at ${SMOKE_ROOT}`);
    err.code = 'SMOKE_V4_NOT_PASS';
    throw err;
  }
  const manifestPath = path.join(SMOKE_ROOT, 'screenshot-manifest.json');
  const man = loadJson(manifestPath);
  const rows = Array.isArray(man) ? man : man.rows || man.screenshots || [];
  const turns = loadJsonl(path.join(SMOKE_ROOT, 'ledgers/turn-ledger.jsonl'));
  const inv = loadJsonl(path.join(SMOKE_ROOT, 'ledgers/invocation-ledger.jsonl'));
  const latency = loadJsonl(path.join(SMOKE_ROOT, 'ledgers/latency-ledger.jsonl'));
  const sessions = loadJsonl(path.join(SMOKE_ROOT, 'ledgers/session-ledger.jsonl'));

  const byCap = (cap) => rows.filter((r) => r.capability === cap);
  const abs = (r) =>
    r.absolute_path && fs.existsSync(r.absolute_path)
      ? r.absolute_path
      : path.resolve(REPO_ROOT, r.relative_path);

  const negoSessions = sessions.filter(
    (s) => s.capability === 'negotiation_assistance' && s.executed_turn_count >= 4,
  );
  const negoSessionId = negoSessions[0]?.session_id || null;
  const negoShots = rows
    .filter((r) => r.session_id === negoSessionId)
    .sort((a, b) => Number(a.turn_index) - Number(b.turn_index));

  const plan = [
    () => pick(byCap('scarcity'), (r) => String(r.state).includes('loading')),
    () =>
      pick(byCap('scarcity'), (r) =>
        ['final', 'stale_data', 'evidence_expanded', 'success'].some((s) =>
          String(r.state).includes(s.replace('_', '-')) || String(r.state) === s,
        ),
      ) || pick(byCap('scarcity'), (r) => r.capture_phase === 'terminal'),
    () =>
      pick(byCap('valuation'), (r) =>
        String(r.browser_route || '').includes('/edit') && String(r.state).includes('before'),
      ) || pick(byCap('valuation'), (r) => String(r.state).includes('before')),
    () =>
      pick(byCap('valuation'), (r) =>
        ['final', 'stale_data', 'success'].includes(String(r.state)) ||
          String(r.state).includes('final'),
      ),
    () =>
      pick(byCap('auction_intelligence'), (r) =>
        String(r.browser_route || '').includes('watchlist'),
      ) || pick(byCap('auction_intelligence'), (r) => String(r.state).includes('before')),
    () =>
      pick(byCap('auction_intelligence'), (r) =>
        String(r.browser_route || '').includes('auction'),
      ) || pick(byCap('auction_intelligence'), (r) => String(r.state).includes('limitations')),
    () => pick(byCap('embeddings'), (r) => String(r.state).includes('before') || r.capture_phase === 'terminal'),
    () => pick(byCap('embeddings'), (r) => String(r.state).includes('stale') || String(r.state).includes('final')),
    () => pick(byCap('semantic_search'), (r) => String(r.state).includes('before')),
    () =>
      pick(byCap('semantic_search'), (r) =>
        String(r.state).includes('evidence') || String(r.state).includes('final') || String(r.state).includes('stale'),
      ),
    () => negoShots.find((r) => Number(r.turn_index) === 0 && String(r.state).includes('before')) || negoShots[0],
    () => negoShots.find((r) => Number(r.turn_index) === 1) || negoShots[1],
    () => negoShots.find((r) => Number(r.turn_index) === 2) || negoShots[2],
    () =>
      negoShots.find((r) => Number(r.turn_index) === 3 && (String(r.state).includes('final') || String(r.state).includes('draft'))) ||
      negoShots.find((r) => Number(r.turn_index) === 3),
    () =>
      negoShots.find((r) => String(r.state).includes('limitations') || String(r.state).includes('evidence')) ||
      negoShots[negoShots.length - 1],
    () => pick(byCap('recommendations'), (r) => String(r.state).includes('final') || String(r.state).includes('before')),
    () => pick(byCap('recommendations'), (r) => String(r.state).includes('limitations') || String(r.state).includes('evidence')),
    () => pick(byCap('market_analytics'), (r) => String(r.state).includes('final') || String(r.state).includes('before')),
    () => pick(byCap('market_analytics'), (r) => String(r.state).includes('limitations')),
    () =>
      pick(rows, (r) => String(r.capability).includes('memory') || String(r.state).includes('stale')) ||
      negoShots.find((r) => Number(r.turn_index) === 2),
  ];

  if (fs.existsSync(OUT)) {
    fs.rmSync(OUT, { recursive: true, force: true });
  }
  fs.mkdirSync(OUT, { recursive: true });

  const selected = [];
  const used = new Set();
  for (let i = 0; i < 20; i += 1) {
    let row = plan[i]();
    if (row && used.has(row.screenshot_id)) {
      row = rows.find((r) => r.capability === row.capability && !used.has(r.screenshot_id)) || row;
    }
    if (!row) {
      const err = new Error(`missing selection for ${REQUIRED_NAMES[i]}`);
      err.code = 'OWNER_REVIEW_20_SELECTION_GAP';
      throw err;
    }
    used.add(row.screenshot_id);
    const src = abs(row);
    const destName = REQUIRED_NAMES[i];
    const dest = path.join(OUT, destName);
    fs.copyFileSync(src, dest);
    const buf = fs.readFileSync(dest);
    const dims = readPngDimensions(buf);
    if (dims.width < 320 || dims.height < 240) {
      const err = new Error(`${destName} too small ${dims.width}x${dims.height}`);
      err.code = 'VISUAL_SCREENSHOT_TOO_SMALL';
      throw err;
    }
    const turn = turns.find((t) => t.turn_id === row.turn_id) || {};
    const lat = latency.find((t) => t.turn_id === row.turn_id) || {};
    const turnInv = inv.filter((x) => x.turn_id === row.turn_id);
    selected.push({
      selection_index: i + 1,
      selection_reason: `Curated live proof slot ${REQUIRED_NAMES[i]} from smoke-v4`,
      filename: destName,
      source_relative_path: row.relative_path,
      sha256: sha256File(dest),
      width: dims.width,
      height: dims.height,
      bytes: buf.length,
      captured_at: row.captured_at,
      capability: row.capability,
      scenario_id: row.scenario_id,
      participant_side: row.participant_side,
      route: row.browser_route,
      session_id: row.session_id,
      turn_id: row.turn_id,
      turn_index: row.turn_index,
      journey_id: row.journey_id,
      triplet_id: row.triplet_id || turn.triplet_id || null,
      canonical_request_hash: row.canonical_request_hash || turn.canonical_request_hash || null,
      accepted_response_hash: row.accepted_response_hash || turn.accepted_response_hash || null,
      rendered_result_hash: row.rendered_result_hash || turn.rendered_result_hash || null,
      rendered_evidence_hash: row.rendered_evidence_hash || null,
      rendered_limitations_hash: row.rendered_limitations_hash || null,
      H1_probe_id: turn.H1_probe_id || turn.h1_probe_id || null,
      H2_probe_id: turn.H2_probe_id || turn.h2_probe_id || null,
      H3_probe_id: turn.H3_probe_id || turn.h3_probe_id || null,
      terminal_state: row.terminal_state || row.state,
      accessibility_status: row.accessibility_status || null,
      horizontal_overflow: row.horizontal_overflow ?? null,
      browser_console_error_count: row.browser_console_error_count ?? 0,
      failed_request_count: row.failed_request_count ?? 0,
      visual_review_status: 'OWNER_VISUAL_REVIEW_REQUIRED',
      latency: lat,
      invocations: turnInv,
      config_pins: turn.config_pins || null,
    });
  }

  const manifest = {
    schema_version: 'phase34-owner-review-selected-20-live-v1',
    product_acceptance: false,
    visual_review_status: 'OWNER_VISUAL_REVIEW_REQUIRED',
    smoke_root: SMOKE_ROOT,
    multi_turn_negotiation_session_id: negoSessionId,
    count: 20,
    images: selected,
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const latSamples = selected.map((s) => s.latency || {});
  const fieldStats = {};
  for (const key of [
    'browser_action_to_request_ms',
    'browser_request_total_ms',
    'browser_action_to_panel_ready_ms',
    'H1_total_ms',
    'H2_total_ms',
    'H3_total_ms',
    'gateway_total_ms',
    'service_total_ms',
    'model_generation_ms',
  ]) {
    const vals = latSamples
      .map((l) => l[key])
      .filter((v) => typeof v === 'number')
      .sort((a, b) => a - b);
    fieldStats[key] = {
      sample_count: vals.length,
      missing_count: latSamples.length - vals.length,
      p50: percentileNearestRank(vals, 50),
      p95: percentileNearestRank(vals, 95),
      p99: percentileNearestRank(vals, 99),
      p100: vals.length ? vals[vals.length - 1] : null,
      p99_9: 'NOT_ESTIMABLE',
      measurement_status: vals.length ? 'OBSERVED' : 'NOT_INSTRUMENTED',
    };
  }
  const latencyReport = {
    schema_version: 'phase34-owner-review-latency-v1',
    selected: selected.map((s) => ({
      selection_index: s.selection_index,
      filename: s.filename,
      session_id: s.session_id,
      turn_id: s.turn_id,
      ...Object.fromEntries(
        Object.entries(s.latency || {}).map(([k, v]) => [
          k,
          v == null ? null : v,
        ]),
      ),
      unavailable_fields_policy: 'null + measurement_status NOT_INSTRUMENTED',
    })),
    run_summary: fieldStats,
  };
  fs.writeFileSync(path.join(OUT, 'latency-report.json'), JSON.stringify(latencyReport, null, 2) + '\n');

  const pipeline = {
    schema_version: 'phase34-owner-review-pipeline-telemetry-v1',
    turns: selected.map((s) => ({
      selection_index: s.selection_index,
      filename: s.filename,
      session_id: s.session_id,
      turn_id: s.turn_id,
      components: Object.fromEntries(
        (s.invocations || []).map((i) => [
          i.component,
          i.result || i.observation_status || 'NOT_INVOKED_BY_POLICY',
        ]),
      ),
      pins: s.config_pins,
    })),
  };
  fs.writeFileSync(path.join(OUT, 'pipeline-telemetry.json'), JSON.stringify(pipeline, null, 2) + '\n');

  const runtimePath = path.join(SMOKE_ROOT, 'runtime-telemetry.json');
  if (fs.existsSync(runtimePath)) {
    fs.copyFileSync(runtimePath, path.join(OUT, 'runtime-telemetry.json'));
  } else {
    fs.writeFileSync(
      path.join(OUT, 'runtime-telemetry.json'),
      JSON.stringify(
        {
          schema_version: 'phase34-owner-review-runtime-telemetry-v1',
          note: 'runtime series not present on smoke root; populate from harness if instrumented',
          evidence_root_bytes: null,
        },
        null,
        2,
      ) + '\n',
    );
  }

  const cards = selected
    .map(
      (s) => `
<article class="card">
  <h2>${String(s.selection_index).padStart(2, '0')}. ${s.filename}</h2>
  <p class="meta">${s.capability} · ${s.route || ''} · ${s.terminal_state}</p>
  <a href="${s.filename}" target="_blank" rel="noopener"><img src="${s.filename}" alt="${s.filename}"/></a>
  <dl>
    <dt>Session / turn</dt><dd>${s.session_id} / ${s.turn_id} (idx ${s.turn_index})</dd>
    <dt>Viewport</dt><dd>${s.width}×${s.height}</dd>
    <dt>H1/H2/H3</dt><dd>${s.H1_probe_id || '—'} / ${s.H2_probe_id || '—'} / ${s.H3_probe_id || '—'}</dd>
    <dt>A11y</dt><dd>${s.accessibility_status}</dd>
    <dt>Request hash</dt><dd><code>${s.canonical_request_hash || '—'}</code></dd>
    <dt>Visual</dt><dd>${s.visual_review_status}</dd>
  </dl>
</article>`,
    )
    .join('\n');

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Phase 34 curated live 20-pack — OWNER REVIEW REQUIRED</title>
<style>
body{margin:0;padding:1.25rem;font-family:ui-sans-serif,system-ui,sans-serif;background:#f4f1ea;color:#111}
.banner{background:#1f3d2b;color:#fff;padding:.75rem 1rem;border-radius:8px;font-weight:700}
.grid{display:grid;grid-template-columns:1fr;gap:1.25rem;margin-top:1rem}
@media(min-width:960px){.grid{grid-template-columns:1fr 1fr}}
.card{background:#fff;border:1px solid #d8d2c8;border-radius:10px;padding:.75rem}
.card img{display:block;width:100%;max-height:720px;height:auto;object-fit:contain;background:#eee}
.meta{color:#444;font-size:.9rem}
dl{display:grid;grid-template-columns:9rem 1fr;gap:.25rem .75rem;font-size:.85rem}
dt{font-weight:600;color:#555} dd{margin:0;word-break:break-word} code{font-size:.75rem}
</style></head><body>
<p class="banner">OWNER_VISUAL_REVIEW_REQUIRED — curated 20 from smoke-v4 — NOT product acceptance — NOT canary ready</p>
<h1>Phase 34 live AI product proof (20 screenshots)</h1>
<p>Multi-turn negotiation session: <code>${negoSessionId || '—'}</code></p>
<div class="grid">${cards}</div>
</body></html>\n`;
  fs.writeFileSync(path.join(OUT, 'index.html'), html);

  const latencyHtml = `<!doctype html><html><head><meta charset="utf-8"/><title>Latency report</title></head>
<body><h1>Latency report</h1><pre>${JSON.stringify(latencyReport.run_summary, null, 2)}</pre></body></html>\n`;
  fs.writeFileSync(path.join(OUT, 'latency-report.html'), latencyHtml);
  const pipeHtml = `<!doctype html><html><head><meta charset="utf-8"/><title>Pipeline telemetry</title></head>
<body><h1>Pipeline telemetry</h1><pre>${JSON.stringify(pipeline, null, 2)}</pre></body></html>\n`;
  fs.writeFileSync(path.join(OUT, 'pipeline-telemetry.html'), pipeHtml);

  const sums = [];
  for (const s of selected) sums.push(`${s.sha256}  ${s.filename}`);
  for (const meta of [
    'index.html',
    'manifest.json',
    'latency-report.json',
    'latency-report.html',
    'pipeline-telemetry.json',
    'pipeline-telemetry.html',
    'runtime-telemetry.json',
  ]) {
    sums.push(`${sha256File(path.join(OUT, meta))}  ${meta}`);
  }
  fs.writeFileSync(path.join(OUT, 'SHA256SUMS'), sums.join('\n') + '\n');

  // link validation
  const missing = [];
  for (const s of selected) {
    if (!fs.existsSync(path.join(OUT, s.filename))) missing.push(s.filename);
  }
  for (const m of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const ref = m[1];
    if (ref.startsWith('http') || ref.startsWith('#')) continue;
    if (!fs.existsSync(path.join(OUT, ref))) missing.push(ref);
  }
  if (missing.length) {
    const err = new Error(`broken links: ${missing.join(',')}`);
    err.code = 'OWNER_REVIEW_20_BROKEN_LINKS';
    throw err;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        out: OUT,
        count: 20,
        multi_turn_negotiation_session_id: negoSessionId,
        screenshot_total_bytes: selected.reduce((a, s) => a + s.bytes, 0),
        missing_links: missing,
        visual_review_status: 'OWNER_VISUAL_REVIEW_REQUIRED',
      },
      null,
      2,
    ),
  );
}

main();
