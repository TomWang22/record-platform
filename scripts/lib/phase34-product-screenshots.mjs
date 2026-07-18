/**
 * Phase 34 product gauntlet — real Playwright screenshot capture + manifest.
 * Success-state captures must not use mocked intelligence responses.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  measurePageHeightGeometry,
  assertScreenshotGeometryAllowed,
  assertCapturedImageBounds,
  readPngDimensions,
} from './phase34-product-screenshot-geometry.mjs';

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
 * @param {'gauntlet'|'canary'|'smoke'|'smoke-v2'|'smoke-v3'|'smoke-v4'|'smoke-v5'} pack
 */
export function productScreenshotDir(authClass = 'authenticated', pack = 'gauntlet', date = contractScreenshotDate()) {
  const leaf =
    pack === 'canary'
      ? 'phase34-product-canary'
      : pack === 'smoke-v5'
        ? 'phase34-product-smoke-v5'
        : pack === 'smoke-v4'
          ? 'phase34-product-smoke-v4'
          : pack === 'smoke-v3'
            ? 'phase34-product-smoke-v3'
            : pack === 'smoke-v2'
              ? 'phase34-product-smoke-v2'
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
 * Call real page.screenshot() or locator.screenshot().
 * Defaults to viewport capture. Unbounded fullPage is gated by height ratio ≤ 4.
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

  const vpEarly = meta.viewport && typeof meta.viewport === 'object' ? meta.viewport : await page.viewportSize?.();
  const geometry = await measurePageHeightGeometry(page);
  const wantFullPage = meta.fullPage === true;
  const capture_mode =
    meta.capture_mode ||
    (meta.locator ? 'locator' : wantFullPage ? 'full_page' : 'viewport');
  const capture_kind =
    meta.capture_kind ||
    (capture_mode === 'locator'
      ? 'LOCATOR'
      : capture_mode === 'full_page'
        ? 'FULL_PAGE'
        : meta.clip_rectangle
          ? 'BOUNDED_REGION'
          : 'VIEWPORT');

  let locator_bounding_box = meta.locator_bounding_box || null;
  if (meta.locator && typeof meta.locator.boundingBox === 'function' && !locator_bounding_box) {
    try {
      locator_bounding_box = await meta.locator.boundingBox();
    } catch {
      locator_bounding_box = null;
    }
  }

  if (capture_mode === 'full_page' || wantFullPage) {
    assertScreenshotGeometryAllowed(geometry, {
      route: meta.browser_route || meta.route,
      session_id: meta.session_id,
      turn_id: meta.turn_id,
      viewport: vpEarly,
    });
  } else if (capture_mode === 'viewport' && geometry.height_ratio > 4 && !meta.locator) {
    // Prefer viewport clip; still record geometry but do not capture full pathological page.
  }

  if (meta.locator && typeof meta.locator.screenshot === 'function') {
    await meta.locator.screenshot({
      path: absPath,
      animations: 'disabled',
      caret: 'hide',
      type: 'png',
    });
  } else {
    await page.screenshot({
      path: absPath,
      fullPage: wantFullPage,
      animations: 'disabled',
      caret: 'hide',
      type: 'png',
    });
  }

  if (!fs.existsSync(absPath)) {
    const err = new Error(`screenshot file missing after page.screenshot: ${absPath}`);
    err.code = 'PHASE34_PRODUCT_SCREENSHOT_MISSING_FILE';
    throw err;
  }
  const buf = fs.readFileSync(absPath);
  const dims = readPngDimensions(buf);
  assertCapturedImageBounds({
    width: dims.width,
    height: dims.height,
    bytes: buf.length,
    viewport_height: geometry.viewport_height || vpEarly?.height,
    capture_mode,
    allow_small_component_crop: meta.allow_small_component_crop === true,
    state: meta.state || meta.capture_phase || null,
  });
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const screenshot_id = `ss_${sha256.slice(0, 16)}`;

  const vp = meta.viewport && typeof meta.viewport === 'object' ? meta.viewport : null;
  const viewport_name = viewportLabel(meta.viewport || meta.viewport_name);
  const viewport_width = Number(meta.viewport_width ?? vp?.width ?? geometry.viewport_width ?? 0) || 0;
  const viewport_height = Number(meta.viewport_height ?? vp?.height ?? geometry.viewport_height ?? 0) || 0;
  const state = meta.state || 'success';
  const capture_phase = meta.capture_phase || state;
  const response_available_at_capture =
    meta.response_available_at_capture != null
      ? Boolean(meta.response_available_at_capture)
      : state !== 'before_action' && state !== 'loading';

  let page_url = meta.page_url || null;
  let page_title_hash = meta.page_title_hash || null;
  if (page && typeof page.url === 'function') {
    try {
      page_url = page_url || page.url();
      const title = typeof page.title === 'function' ? await page.title() : '';
      page_title_hash =
        page_title_hash ||
        crypto.createHash('sha256').update(String(title || '')).digest('hex');
    } catch {
      /* ignore */
    }
  }

  const row = {
    schema_version: PRODUCT_SCREENSHOT_SCHEMA_VERSION,
    screenshot_id,
    relative_path,
    absolute_path: absPath,
    sha256,
    bytes: buf.length,
    image_width: dims.width,
    image_height: dims.height,
    capture_mode,
    capture_kind,
    locator_bounding_box,
    clip_rectangle: meta.clip_rectangle || null,
    dimension_validation_policy:
      capture_kind === 'LOCATOR' || capture_kind === 'BOUNDED_REGION'
        ? 'LOCATOR_OR_BOUNDED_MATCH'
        : 'VIEWPORT_MATCH',
    page_height_geometry: geometry,
    captured_at: new Date().toISOString(),
    session_id: meta.session_id || null,
    turn_id: meta.turn_id || null,
    turn_index: meta.turn_index ?? null,
    journey_id: meta.journey_id || null,
    triplet_id: meta.triplet_id || null,
    capability: meta.capability || null,
    scenario_id: meta.scenario_id || null,
    participant_side: meta.participant_side || null,
    browser_route: meta.browser_route || null,
    viewport: viewport_name,
    viewport_name,
    viewport_width,
    viewport_height,
    device_scale_factor: meta.device_scale_factor ?? 1,
    color_scheme: meta.color_scheme || 'light',
    browser_name: meta.browser_name || 'chromium',
    browser_version: meta.browser_version || null,
    trace_path: meta.trace_path || null,
    trace_sha256: meta.trace_sha256 || null,
    state,
    terminal_state: meta.terminal_state ?? null,
    capture_phase,
    expected_locator: meta.expected_locator || null,
    expected_locator_visible: meta.expected_locator_visible ?? null,
    page_url,
    page_title_hash,
    response_available_at_capture,
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
 * Generate contact-sheet HTML with images copied beside the HTML (no /tmp↔repo traversal).
 */
export function generateContactSheets(manifestRows, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const imagesDir = path.join(outDir, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });

  const localRows = [];
  for (const r of manifestRows) {
    const abs =
      r.absolute_path && fs.existsSync(r.absolute_path)
        ? r.absolute_path
        : r.relative_path
          ? path.resolve(REPO_ROOT, r.relative_path)
          : null;
    if (!abs || !fs.existsSync(abs)) {
      localRows.push({ ...r, _local_href: null });
      continue;
    }
    const base = `${r.screenshot_id || path.basename(abs, path.extname(abs))}${path.extname(abs) || '.png'}`;
    const dest = path.join(imagesDir, base);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(abs, dest);
    }
    // Reject accidental symlinks in the pack.
    const st = fs.lstatSync(dest);
    if (st.isSymbolicLink()) {
      const err = new Error(`contact-sheet image must not be a symlink: ${dest}`);
      err.code = 'CONTACT_SHEET_SYMLINK';
      throw err;
    }
    localRows.push({ ...r, _local_href: `images/${base}` });
  }

  const by = {
    combined: localRows,
    authenticated: localRows.filter((r) => String(r.relative_path || '').includes('/authenticated/')),
    guest: localRows.filter((r) => String(r.relative_path || '').includes('/guest/')),
    mobile: localRows.filter((r) => r.viewport === 'mobile'),
    tablet: localRows.filter((r) => r.viewport === 'tablet'),
    desktop: localRows.filter((r) => r.viewport === 'desktop'),
    abstentions: localRows.filter((r) => r.state === 'abstention'),
    refusals: localRows.filter((r) => r.state === 'unauthorized_refusal'),
    failures: localRows.filter((r) => String(r.state).includes('failure') || r.state === 'rate_limit'),
  };
  const caps = [...new Set(localRows.map((r) => r.capability).filter(Boolean))];
  const files = [];
  for (const [name, rows] of Object.entries(by)) {
    const html = renderContactSheet(name, rows);
    const fp = path.join(outDir, `${name}.html`);
    fs.writeFileSync(fp, html);
    files.push(fp);
  }
  for (const cap of caps) {
    const rows = localRows.filter((r) => r.capability === cap);
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
  const linkValidation = validateContactSheetLinks(outDir, files);
  if (linkValidation.missing.length || linkValidation.traversal.length || linkValidation.symlinks.length) {
    const err = new Error(
      `contact-sheet link validation failed: missing=${linkValidation.missing.length} traversal=${linkValidation.traversal.length} symlinks=${linkValidation.symlinks.length}`,
    );
    err.code = 'CONTACT_SHEET_BROKEN_LINKS';
    err.linkValidation = linkValidation;
    throw err;
  }
  return { files, visual_review_status: VISUAL_REVIEW_STATUS_DEFAULT, linkValidation };
}

/**
 * @deprecated Prefer pack-local images/ copies. Kept for tests that only need path math.
 */
export function contactSheetHrefForRow(row, outDir) {
  if (row._local_href) return row._local_href;
  const abs =
    row.absolute_path && fs.existsSync(row.absolute_path)
      ? row.absolute_path
      : row.relative_path
        ? path.resolve(REPO_ROOT, row.relative_path)
        : null;
  if (!abs || !fs.existsSync(abs)) return null;
  const from = fs.realpathSync(outDir);
  const to = fs.realpathSync(abs);
  return path.relative(from, to).split(path.sep).join('/');
}

/**
 * Open every local src/href in generated contact-sheet HTML and ensure targets exist
 * inside the pack directory (no traversal, no symlinks).
 */
export function validateContactSheetLinks(outDir, htmlFiles) {
  const missing = [];
  const checked = [];
  const traversal = [];
  const symlinks = [];
  const rootReal = fs.realpathSync(outDir);
  for (const fp of htmlFiles) {
    if (!fp.endsWith('.html') || !fs.existsSync(fp)) continue;
    const html = fs.readFileSync(fp, 'utf8');
    const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    for (const ref of refs) {
      if (!ref || ref.startsWith('http') || ref.startsWith('mailto:') || ref.startsWith('#')) continue;
      if (ref.includes('..')) {
        traversal.push({ from: fp, ref });
        continue;
      }
      const target = path.resolve(path.dirname(fp), ref);
      checked.push(target);
      if (!fs.existsSync(target)) {
        missing.push({ from: fp, ref, target });
        continue;
      }
      const real = fs.realpathSync(target);
      if (!real.startsWith(rootReal + path.sep) && real !== rootReal) {
        traversal.push({ from: fp, ref, target: real });
      }
      if (fs.lstatSync(target).isSymbolicLink()) {
        symlinks.push({ from: fp, ref, target });
      }
    }
  }
  return { checked: checked.length, missing, traversal, symlinks };
}

function renderContactSheet(title, rows) {
  const cards = rows
    .map((r) => {
      const hrefRaw = r._local_href || '';
      const href = escapeAttr(hrefRaw);
      const src = href;
      const w = r.image_width || r.viewport_width || '?';
      const h = r.image_height || r.viewport_height || '?';
      const pathological =
        Number(r.image_height) > (Number(r.viewport_height) || 1024) * 4 ||
        Number(r.image_height) > 5000;
      const flag = pathological
        ? `<span class="pathology">PATHOLOGICAL ${w}×${h}</span>`
        : `<span class="dims">${w}×${h}</span>`;
      return `<article class="card">
  <a href="${href}" target="_blank" rel="noopener">
    <div class="thumb"><img src="${src}" alt="${escapeAttr(r.state)}" loading="lazy"/></div>
  </a>
  <figcaption>
    <strong>${escapeAttr(r.capability)}</strong> · ${escapeAttr(r.state)}<br/>
    ${escapeAttr(r.viewport || r.viewport_name)} ${escapeAttr(String(r.viewport_width || ''))}×${escapeAttr(String(r.viewport_height || ''))}<br/>
    sess ${escapeAttr(String(r.session_id || '').slice(-8))} turn${String(r.turn_index ?? '').padStart(2, '0')}<br/>
    ${flag} · ${(Number(r.bytes) / 1024).toFixed(0)} KB<br/>
    <code>${escapeAttr(r.screenshot_id)}</code>
  </figcaption>
</article>`;
    })
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeAttr(title)}</title>
<style>
body{font-family:system-ui,sans-serif;margin:1rem;background:#f6f7f9;color:#111}
h1{font-size:1.25rem}
.grid{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start}
.card{width:280px;background:#fff;border:1px solid #ddd;border-radius:8px;padding:8px;box-sizing:border-box}
.thumb{width:100%;height:480px;max-height:480px;display:flex;align-items:flex-start;justify-content:center;overflow:hidden;background:#111}
.thumb img{max-width:100%;max-height:480px;width:auto;height:auto;object-fit:contain}
figcaption{font-size:11px;line-height:1.35;margin-top:6px}
.pathology{color:#b00020;font-weight:700}
.dims{color:#444}
code{font-size:10px}
</style>
</head><body><h1>${escapeAttr(title)}</h1><p>OWNER_VISUAL_REVIEW_REQUIRED — ${rows.length} shots — click thumbnail for original</p><div class="grid">${cards}</div></body></html>\n`;
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
    // Expanded/limitations are NOT terminal — require a true terminal state.
    const terminals = new Set([
      'final',
      'final_success',
      'success',
      'abstention',
      'refusal',
      'unauthorized_refusal',
      'weak_data',
      'stale_data',
      'dense_evidence',
      'service_failure',
      'rate_limit',
      'terminal_error',
    ]);
    if (!screenshotRows.some((r) => terminals.has(r.state))) {
      const err = new Error('terminal-state screenshot missing');
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
    if (!(r.viewport_width > 0 && r.viewport_height > 0)) {
      const err = new Error('screenshot missing viewport_width/viewport_height');
      err.code = 'PHASE34_PRODUCT_SCREENSHOT_VIEWPORT_MISSING';
      throw err;
    }
  }
  return true;
}
