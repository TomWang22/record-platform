/**
 * Phase 34 product gauntlet — real Playwright screenshot capture + manifest.
 * Success-state captures must not use mocked intelligence responses.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRODUCT_SCREENSHOT_SCHEMA_VERSION = 'phase34-product-screenshot-manifest-v1';
export const VISUAL_REVIEW_STATUS_DEFAULT = 'OWNER_VISUAL_REVIEW_REQUIRED';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function contractScreenshotDate(now = new Date()) {
  const env = process.env.CONTRACT_SCREENSHOT_DATE?.trim();
  if (env && /^\d{4}-\d{2}-\d{2}$/.test(env)) return env;
  return now.toISOString().slice(0, 10);
}

/**
 * Dated output roots under webapp/e2e/screenshots.
 * @param {'authenticated'|'guest'} authClass
 * @param {'gauntlet'|'canary'|'smoke'} pack
 */
export function productScreenshotDir(authClass = 'authenticated', pack = 'gauntlet', date = contractScreenshotDate()) {
  const leaf =
    pack === 'canary'
      ? 'phase34-product-canary'
      : pack === 'smoke'
        ? 'phase34-product-smoke'
        : 'phase34-product-gauntlet';
  return path.join(REPO_ROOT, 'webapp/e2e/screenshots', authClass, date, leaf);
}

/**
 * Deterministic filename — no PII.
 * Example: negotiation-authorized-seller-desktop-success-s7fa2-turn03.png
 */
export function buildScreenshotFilename({
  capability,
  scenario_id,
  participant_side,
  viewport,
  state,
  session_id,
  turn_index,
}) {
  const cap = slug(capability);
  const scen = slug(String(scenario_id || 'scenario').split('__').pop() || 'scenario').slice(0, 24);
  const side = slug(participant_side || 'buyer');
  const vp = slug(viewportLabel(viewport));
  const st = slug(state || 'success');
  const sess = String(session_id || 'sess').replace(/^sess_/, '').slice(0, 5);
  const turn = `turn${String(turn_index ?? 0).padStart(2, '0')}`;
  return `${cap}-${scen}-${side}-${vp}-${st}-s${sess}-${turn}.png`;
}

function slug(s) {
  return String(s || 'x')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'x';
}

export function viewportLabel(viewport) {
  if (!viewport) return 'desktop';
  if (typeof viewport === 'string') return viewport;
  const w = viewport.width || 1280;
  if (w <= 430) return 'mobile';
  if (w <= 900) return 'tablet';
  return 'desktop';
}

export const REQUIRED_SCREENSHOT_STATES = Object.freeze([
  'before_action',
  'loading',
  'success',
  'evidence_expanded',
  'limitations_expanded',
  'abstention',
  'unauthorized_refusal',
  'weak_data',
  'stale_data',
  'dense_evidence',
  'service_failure',
  'rate_limit',
]);

/**
 * Call real page.screenshot(). Returns absolute path + sha256.
 * @param {import('playwright').Page} page
 * @param {object} meta
 */
export async function captureProductScreenshot(page, meta) {
  if (!page || typeof page.screenshot !== 'function') {
    const err = new Error('page.screenshot is required for product visual evidence');
    err.code = 'PHASE34_PRODUCT_SCREENSHOT_API_MISSING';
    throw err;
  }
  const authClass = meta.authClass || 'authenticated';
  const pack = meta.pack || 'gauntlet';
  const date = meta.date || contractScreenshotDate();
  const dir = productScreenshotDir(authClass, pack, date);
  fs.mkdirSync(dir, { recursive: true });
  const filename = buildScreenshotFilename(meta);
  const absPath = path.join(dir, filename);
  const relative_path = path.relative(REPO_ROOT, absPath).split(path.sep).join('/');

  await page.screenshot({
    path: absPath,
    fullPage: meta.fullPage !== false,
    type: 'png',
  });

  if (!fs.existsSync(absPath)) {
    const err = new Error(`screenshot file missing after page.screenshot: ${absPath}`);
    err.code = 'PHASE34_PRODUCT_SCREENSHOT_MISSING_FILE';
    throw err;
  }
  const buf = fs.readFileSync(absPath);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const screenshot_id = `ss_${sha256.slice(0, 16)}`;

  const row = {
    schema_version: PRODUCT_SCREENSHOT_SCHEMA_VERSION,
    screenshot_id,
    relative_path,
    absolute_path: absPath,
    sha256,
    bytes: buf.length,
    captured_at: new Date().toISOString(),
    session_id: meta.session_id || null,
    turn_id: meta.turn_id || null,
    journey_id: meta.journey_id || null,
    triplet_id: meta.triplet_id || null,
    capability: meta.capability || null,
    scenario_id: meta.scenario_id || null,
    participant_side: meta.participant_side || null,
    browser_route: meta.browser_route || null,
    viewport: viewportLabel(meta.viewport),
    state: meta.state || 'success',
    canonical_request_hash: meta.canonical_request_hash || null,
    accepted_response_hash: meta.accepted_response_hash || null,
    rendered_result_hash: meta.rendered_result_hash || null,
    rendered_evidence_hash: meta.rendered_evidence_hash || null,
    rendered_limitations_hash: meta.rendered_limitations_hash || null,
    H1_probe_id: meta.H1_probe_id || null,
    H2_probe_id: meta.H2_probe_id || null,
    H3_probe_id: meta.H3_probe_id || null,
    browser_console_error_count: meta.browser_console_error_count ?? 0,
    failed_request_count: meta.failed_request_count ?? 0,
    accessibility_status: meta.accessibility_status || 'NOT_EXECUTED',
    horizontal_overflow: meta.horizontal_overflow ?? null,
    visual_review_status: VISUAL_REVIEW_STATUS_DEFAULT,
    private_fields_redacted: true,
  };
  return row;
}

/**
 * Capture the standard journey state set that applies to a turn.
 * Always includes before_action (caller may pass pre-nav page) and final success/fail state.
 */
export async function captureJourneyScreenshotSet(page, baseMeta, states) {
  const rows = [];
  for (const state of states) {
    const row = await captureProductScreenshot(page, { ...baseMeta, state });
    rows.push(row);
  }
  return rows;
}

export class ScreenshotManifestWriter {
  constructor(outRoot) {
    this.outRoot = outRoot;
    this.path = path.join(outRoot, 'screenshot-manifest.jsonl');
    this.rows = [];
    fs.mkdirSync(outRoot, { recursive: true });
  }

  append(row) {
    this.rows.push(row);
    fs.appendFileSync(this.path, `${JSON.stringify(row)}\n`);
    return row;
  }

  finalize() {
    const jsonPath = path.join(this.outRoot, 'screenshot-manifest.json');
    const payload = {
      schema_version: PRODUCT_SCREENSHOT_SCHEMA_VERSION,
      count: this.rows.length,
      visual_review_status: VISUAL_REVIEW_STATUS_DEFAULT,
      rows: this.rows,
    };
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n');
    const sums = this.rows.map((r) => `${r.sha256}  ${r.relative_path}`).join('\n') + '\n';
    fs.writeFileSync(path.join(this.outRoot, 'SHA256SUMS'), sums);
    return payload;
  }
}

/**
 * Disk projection for screenshot storage policy.
 */
export function projectScreenshotDiskUsage({
  canarySessions = 240,
  multiTurnSessions = 24,
  avgMultiTurns = 4,
  fullSessions = 20_000,
  stratifiedSampleRate = 0.05,
  hardFailureEstimate = 50,
  avgPngKb = 180,
  statesPerCanaryTurn = 3,
} = {}) {
  const canaryTurns = canarySessions - multiTurnSessions + multiTurnSessions * avgMultiTurns;
  const canaryShots = canaryTurns * statesPerCanaryTurn;
  const fullSampleShots = Math.ceil(fullSessions * stratifiedSampleRate) * 2;
  const fullHardShots = hardFailureEstimate * 4;
  const fullShots = fullSampleShots + fullHardShots;
  const canaryBytes = canaryShots * avgPngKb * 1024;
  const fullBytes = fullShots * avgPngKb * 1024;
  return {
    schema_version: 'phase34-product-screenshot-disk-projection-v1',
    avg_png_kb: avgPngKb,
    canary: {
      sessions: canarySessions,
      estimated_screenshots: canaryShots,
      estimated_bytes: canaryBytes,
      estimated_gb: Number((canaryBytes / 1e9).toFixed(3)),
      policy: 'capture_every_session_and_turn',
    },
    full: {
      sessions: fullSessions,
      stratified_sample_rate: stratifiedSampleRate,
      estimated_screenshots: fullShots,
      estimated_bytes: fullBytes,
      estimated_gb: Number((fullBytes / 1e9).toFixed(3)),
      policy: 'hard_failures_plus_stratified_success_sample',
      note: 'Do not silently capture 20k full-resolution screenshots without owner-approved storage policy',
    },
    sample_policy_sha256: crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          stratifiedSampleRate,
          hardFailureEstimate,
          statesPerCanaryTurn,
          canary: 'every_session_turn',
        }),
      )
      .digest('hex'),
  };
}

/**
 * Playwright tracing policy for selected sessions.
 */
export const PLAYWRIGHT_TRACE_POLICY = Object.freeze({
  version: 'phase34-product-trace-v1',
  mode: 'on-first-retry_and_selected_sessions',
  screenshots: true,
  snapshots: true,
  sources: false,
  retain_on: ['hard_failure', 'ui_api_mismatch', 'privacy_adversarial', 'multi_turn_boundary'],
  output_subdir: 'playwright-traces',
});

/**
 * Generate contact-sheet HTML stubs linking to captured screenshots.
 * Full visual index tooling may refine these after freeze.
 */
export function generateContactSheets(manifestRows, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const by = {
    combined: manifestRows,
    authenticated: manifestRows.filter((r) => r.relative_path.includes('/authenticated/')),
    guest: manifestRows.filter((r) => r.relative_path.includes('/guest/')),
    mobile: manifestRows.filter((r) => r.viewport === 'mobile'),
    tablet: manifestRows.filter((r) => r.viewport === 'tablet'),
    desktop: manifestRows.filter((r) => r.viewport === 'desktop'),
    abstentions: manifestRows.filter((r) => r.state === 'abstention'),
    refusals: manifestRows.filter((r) => r.state === 'unauthorized_refusal'),
    failures: manifestRows.filter((r) => String(r.state).includes('failure') || r.state === 'rate_limit'),
  };
  const caps = [...new Set(manifestRows.map((r) => r.capability).filter(Boolean))];
  const files = [];
  for (const [name, rows] of Object.entries(by)) {
    const html = renderContactSheet(name, rows);
    const fp = path.join(outDir, `${name}.html`);
    fs.writeFileSync(fp, html);
    files.push(fp);
  }
  for (const cap of caps) {
    const rows = manifestRows.filter((r) => r.capability === cap);
    const fp = path.join(outDir, `capability-${cap}.html`);
    fs.writeFileSync(fp, renderContactSheet(cap, rows));
    files.push(fp);
  }
  const gaps = [
    '# visual-gaps.md',
    '',
    `captured: ${manifestRows.length}`,
    `visual_review_status: ${VISUAL_REVIEW_STATUS_DEFAULT}`,
    'Do not auto-accept baselines.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'visual-gaps.md'), gaps);
  return { files, visual_review_status: VISUAL_REVIEW_STATUS_DEFAULT };
}

function renderContactSheet(title, rows) {
  const cards = rows
    .map((r) => {
      const rel = String(r.relative_path || '').replace(/^webapp\//, '');
      const src = escapeAttr(`../../${rel}`);
      return `<figure><img src="${src}" alt="${escapeAttr(r.state)}" width="240"/><figcaption>${escapeAttr(r.screenshot_id)} · ${escapeAttr(r.state)} · ${escapeAttr(r.capability)}</figcaption></figure>`;
    })
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeAttr(title)}</title>
<style>body{font-family:system-ui;margin:1rem}figure{display:inline-block;margin:.5rem;vertical-align:top}figcaption{font-size:11px;max-width:240px}</style>
</head><body><h1>${escapeAttr(title)}</h1><p>OWNER_VISUAL_REVIEW_REQUIRED — ${rows.length} shots</p>${cards}</body></html>\n`;
}

function escapeAttr(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

/**
 * Assert required screenshots exist before session PASS.
 */
export function assertScreenshotsBeforePass(screenshotRows, { requireFinal = true } = {}) {
  if (!Array.isArray(screenshotRows) || screenshotRows.length === 0) {
    const err = new Error('required screenshots missing — cannot PASS session');
    err.code = 'PHASE34_PRODUCT_SCREENSHOT_REQUIRED';
    throw err;
  }
  if (requireFinal) {
    const finals = new Set([
      'final',
      'success',
      'abstention',
      'unauthorized_refusal',
      'weak_data',
      'stale_data',
      'dense_evidence',
      'service_failure',
      'rate_limit',
      'evidence_expanded',
      'limitations_expanded',
    ]);
    if (!screenshotRows.some((r) => finals.has(r.state))) {
      const err = new Error('final-state screenshot missing');
      err.code = 'PHASE34_PRODUCT_SCREENSHOT_FINAL_MISSING';
      throw err;
    }
  }
  for (const r of screenshotRows) {
    if (!r.sha256 || !r.relative_path) {
      const err = new Error('screenshot manifest incomplete');
      err.code = 'PHASE34_PRODUCT_SCREENSHOT_MANIFEST_INCOMPLETE';
      throw err;
    }
  }
  return true;
}
