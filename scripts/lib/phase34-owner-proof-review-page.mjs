/**
 * Compact HTML timeline review for the 24-scenario owner-proof rehearsal.
 */
import fs from 'node:fs';
import path from 'node:path';

export function generateOwnerProofReviewPage({ outRoot, scenarios, ledgerRows, screenshotsByScenario }) {
  const reviewDir = path.join(outRoot, 'review');
  fs.mkdirSync(reviewDir, { recursive: true });
  const byScenario = new Map();
  for (const row of ledgerRows || []) {
    if (!byScenario.has(row.scenario_id)) byScenario.set(row.scenario_id, []);
    byScenario.get(row.scenario_id).push(row);
  }

  const cards = (scenarios || [])
    .map((s) => {
      const rows = byScenario.get(s.scenario_id) || [];
      const shots = screenshotsByScenario?.[s.scenario_id] || [];
      const negoTimeline =
        s.scenario_id === 'negotiation-four-turn-live'
          ? `<ol class="turns">${rows
              .map(
                (r) =>
                  `<li><strong>Turn ${r.turn_index + 1}</strong>: ${escapeHtml(r.visible_user_intent || '')}<br/><span class="meta">result=${escapeHtml(r.result_summary || '')} · ready=${r.browser_action_to_panel_ready_ms ?? 'null'}ms · H1/H2/H3=${r.H1_status}/${r.H2_status}/${r.H3_status}</span></li>`,
              )
              .join('')}</ol>`
          : '';
      const imgHtml = shots
        .slice(0, 4)
        .map((sh) => `<figure><img src="${escapeHtml(sh.rel)}" alt="${escapeHtml(sh.label || '')}"/><figcaption>${escapeHtml(sh.label || '')}</figcaption></figure>`)
        .join('');
      const first = rows[0] || {};
      return `<article class="card" id="${escapeHtml(s.scenario_id)}">
  <h2>${escapeHtml(s.scenario_id)}</h2>
  <p><strong>Capability:</strong> ${escapeHtml(s.capability)} · <strong>Class:</strong> ${escapeHtml(s.scenario_class)}</p>
  <p><strong>User intent:</strong> ${escapeHtml(s.user_intent)}</p>
  <p><strong>Route:</strong> ${escapeHtml(s.canonical_route)}</p>
  <p><strong>Result:</strong> ${escapeHtml(first.result_summary || 'NOT_EXECUTED')}</p>
  <p><strong>Evidence count:</strong> ${first.evidence_count ?? '—'}</p>
  <p><strong>Latency (action→ready):</strong> ${first.browser_action_to_panel_ready_ms ?? 'null'} <span class="meta">(${first.browser_action_to_panel_ready_ms == null ? 'NOT_INSTRUMENTED' : 'MEASURED'})</span></p>
  <p><strong>H1/H2/H3:</strong> ${first.H1_status || '—'} / ${first.H2_status || '—'} / ${first.H3_status || '—'}</p>
  <p><strong>Owner review:</strong> ${escapeHtml(s.human_review_question)}</p>
  ${negoTimeline}
  <div class="shots">${imgHtml}</div>
</article>`;
    })
    .join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Phase 34 owner-proof rehearsal review</title>
  <style>
    body{font-family:ui-sans-serif,system-ui,sans-serif;margin:24px;background:#f7f7f5;color:#1a1a1a}
    h1{font-size:1.4rem} .card{background:#fff;border:1px solid #ddd;border-radius:8px;padding:16px;margin:16px 0}
    .shots{display:flex;flex-wrap:wrap;gap:12px} figure{margin:0;width:220px} img{width:100%;border:1px solid #eee}
    figcaption{font-size:11px;color:#666} .meta{color:#666;font-size:12px} .turns{padding-left:18px}
  </style>
</head>
<body>
  <h1>Phase 34 — 24-scenario owner-proof rehearsal</h1>
  <p>Interaction-first review: intent, evidence, conclusion, correction progression, safe next action.</p>
  <p class="meta">Cards: ${(scenarios || []).length} · Ledger rows: ${(ledgerRows || []).length}</p>
  ${cards}
</body>
</html>`;
  const indexPath = path.join(reviewDir, 'index.html');
  fs.writeFileSync(indexPath, html);
  return { indexPath, card_count: (scenarios || []).length };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
