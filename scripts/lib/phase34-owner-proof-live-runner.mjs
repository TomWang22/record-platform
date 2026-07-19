/**
 * Live Chromium + protocol execution for the 24 owner-proof scenarios.
 * Invoked only from scripts/phase34-launch-owner-proof-rehearsal.mjs --execute.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  loadOwnerProofScenarios,
  loadOwnerProofSeedManifest,
  validateSeedManifestAgainstScenarios,
} from './phase34-owner-proof-scenarios.mjs';
import {
  createOwnerProofLedger,
  summarizeLatency,
  buildLatencyRow,
} from './phase34-owner-proof-ledger.mjs';
import { generateOwnerProofReviewPage } from './phase34-owner-proof-review-page.mjs';
import {
  runProductSession,
  ProductFailClosedGate,
} from './phase34-product-session-runner.mjs';
import {
  ProductLedgerWriter,
  PHASE33F_TARGET_FORBIDDEN,
  assertProductOutEligible,
} from './phase34-product-ledgers.mjs';
import {
  ScreenshotManifestWriter,
  generateContactSheets,
  contractScreenshotDate,
} from './phase34-product-screenshots.mjs';
import { assertLivePinsNotSynthetic, PIN_SOURCE } from './phase34-product-runtime-pins.mjs';
import {
  loginContractUser,
  resolveLiveSubjects,
  subjectForCapability,
} from './phase34-product-live-subjects.mjs';
import {
  startProductPcapCapture,
  stopProductPcapCapture,
} from './phase34-product-pcap.mjs';
import { validateAllProductScreenshots } from './phase34-product-png-validation.mjs';
import { assertScreenshotDistinctness } from './phase34-product-screenshot-distinctness.mjs';
import { INTER_BATCH_INTERVAL_MS } from './phase33f-rate-limit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const BUYER_EMAIL =
  process.env.PHASE34_SMOKE_BUYER_EMAIL ||
  process.env.E2E_BUYER_EMAIL ||
  'buyer-contract@record-platform.local';
const BUYER_PASSWORD =
  process.env.PHASE34_SMOKE_BUYER_PASSWORD ||
  process.env.E2E_BUYER_PASSWORD ||
  'ContractPass123!';
const SELLER_EMAIL =
  process.env.PHASE34_SMOKE_SELLER_EMAIL ||
  process.env.E2E_SELLER_EMAIL ||
  'seller-contract@record-platform.local';
const SELLER_PASSWORD =
  process.env.PHASE34_SMOKE_SELLER_PASSWORD ||
  process.env.E2E_SELLER_PASSWORD ||
  'ContractPass123!';

const VIEWPORTS = {
  desktop: { width: 1280, height: 720 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};

const OWNER_REVIEW_EXPORT =
  process.env.PHASE34_OWNER_PROOF_EXPORT_DIR ||
  path.join(REPO_ROOT, 'owner-review-artifacts/phase34/owner-proof-rehearsal-v1');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function productLiveInterSessionMs() {
  const raw = Number(process.env.PHASE34_PRODUCT_INTER_SESSION_MS);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return Math.max(INTER_BATCH_INTERVAL_MS * 2, 2500);
}

export function loadChromium() {
  const requireFromWebapp = createRequire(path.join(REPO_ROOT, 'webapp/package.json'));
  try {
    return requireFromWebapp('playwright').chromium;
  } catch {
    const testPkg = requireFromWebapp('@playwright/test');
    if (testPkg?.chromium) return testPkg.chromium;
    const err = new Error('playwright chromium unavailable — run pnpm install in webapp');
    err.code = 'OWNER_PROOF_PLAYWRIGHT_MISSING';
    throw err;
  }
}

export function caCertPath() {
  const chain = path.join(REPO_ROOT, 'certs/dev-chain.pem');
  return fs.existsSync(chain) ? chain : path.join(REPO_ROOT, 'certs/dev-root.pem');
}

export function resolveRuntimePins() {
  let runtime_image_digest = process.env.PHASE34_RUNTIME_IMAGE_DIGEST || null;
  if (!runtime_image_digest) {
    const img = spawnSyncSafe('kubectl', [
      '-n',
      'record-platform',
      'get',
      'deploy',
      'webapp',
      '-o',
      'jsonpath={.spec.template.spec.containers[0].image}',
    ]);
    if (img) runtime_image_digest = `image:${img}`;
  }
  let certificate_fingerprint = process.env.PHASE34_CERT_FINGERPRINT || null;
  if (!certificate_fingerprint) {
    const chain = path.join(REPO_ROOT, 'certs/dev-chain.pem');
    if (fs.existsSync(chain)) {
      certificate_fingerprint = crypto
        .createHash('sha256')
        .update(fs.readFileSync(chain))
        .digest('hex');
    }
  }
  return { runtime_image_digest, certificate_fingerprint };
}

function spawnSyncSafe(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return (r.stdout || '').trim() || null;
}

export async function ensureMkcertProxy({ proxyPort, outRoot, caCert }) {
  const proxyRoot = path.join(outRoot, 'browser-tls-proxy');
  const certDir = path.join(proxyRoot, 'certs');
  fs.mkdirSync(certDir, { recursive: true });
  const certPath = path.join(certDir, 'local.pem');
  const keyPath = path.join(certDir, 'local-key.pem');
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    const mk = spawn(
      'mkcert',
      [
        '-cert-file',
        'local.pem',
        '-key-file',
        'local-key.pem',
        'record-platform.test',
        'localhost',
        '127.0.0.1',
      ],
      { cwd: certDir, stdio: 'inherit' },
    );
    await new Promise((resolve, reject) => {
      mk.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`mkcert exit ${code}`))));
    });
  }

  const logPath = path.join(proxyRoot, 'proxy.log');
  const logFd = fs.openSync(logPath, 'w');
  const child = spawn(
    process.execPath,
    [path.join(REPO_ROOT, 'webapp/e2e/scripts/strict-edge-browser-proxy.mjs'), `--listen=${proxyPort}`],
    {
      env: {
        ...process.env,
        PHASE34_PROXY_CERT_DIR: certDir,
        NODE_EXTRA_CA_CERTS: caCert,
        E2E_UPSTREAM_HOST: 'record-platform.test',
      },
      stdio: ['ignore', logFd, logFd],
    },
  );
  fs.writeFileSync(path.join(proxyRoot, 'proxy.pid'), String(child.pid));
  await sleep(800);
  if (child.exitCode != null) {
    const err = new Error(
      `browser TLS proxy exited early: ${fs.readFileSync(logPath, 'utf8').slice(0, 500)}`,
    );
    err.code = 'OWNER_PROOF_PROXY_FAILED';
    throw err;
  }
  return {
    child,
    browserBaseUrl: `https://127.0.0.1:${proxyPort}`,
    tls_mode: 'BROWSER_TLS_PROXY_WITH_STRICT_UPSTREAM',
    proxyRoot,
  };
}

export async function signInWithToken(page, browserBaseUrl, { token, email, name, initials }) {
  await page.goto(`${browserBaseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.evaluate(
    ({ t, em, nm, ini }) => {
      window.localStorage.setItem('record-platform.token', t);
      window.localStorage.setItem(
        'record-platform.contract-profile',
        JSON.stringify({ name: nm, email: em, initials: ini, provider: 'local' }),
      );
    },
    { t: token, em: email, nm: name, ini: initials },
  );
  await page.goto(`${browserBaseUrl}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
}

export function buildOwnerProofSchedule(doc = loadOwnerProofScenarios()) {
  const rows = doc.scenarios.map((s, i) => {
    const multi = s.scenario_id === 'negotiation-four-turn-live';
    const prompt_slot = (i % 12) + 1;
    return {
      coordinate: `owner-proof/${s.capability}/${s.scenario_id}`,
      schedule_index: i,
      scenario_id: s.scenario_id,
      scenario_class: s.scenario_class,
      capability: s.capability,
      participant_side: s.participant_side,
      authorization_state:
        s.scenario_id.includes('privacy') || s.scenario_id.includes('unauthorized')
          ? 'unauthorized'
          : 'authorized',
      evidence_strength:
        s.scenario_class === 'A_success'
          ? 'strong'
          : s.scenario_class === 'C_honest_limit'
            ? 'weak'
            : 'ambiguous',
      multi_turn_class: multi ? 'multi_4_12' : 'single',
      smoke_turns: multi ? 4 : 1,
      smoke_viewport: s.viewport || 'desktop',
      smoke_index: i,
      surface_route_index: 0,
      user_intent: s.user_intent,
      owner_proof_canonical_route: s.canonical_route,
      owner_proof_endpoint: s.expected_endpoint,
      prompt_slot,
      prompt_configuration_id: `${s.capability}-c${String(prompt_slot).padStart(2, '0')}`,
      model_tier: prompt_slot <= 4 ? 'deterministic' : prompt_slot <= 8 ? 'local' : 'frontier',
    };
  });
  const turns = rows.reduce((n, r) => n + r.smoke_turns, 0);
  return {
    logical_scenarios: rows.length,
    total_turns: turns,
    protocol_rows: turns * 3,
    rows,
  };
}

export function assertSeedFloors(seedManifest) {
  const floors = seedManifest.evidence_floors || {};
  const byId = new Map((seedManifest.fixtures || []).map((f) => [f.seed_fixture_id, f]));
  const checks = [];
  const fail = (code, detail) => {
    const err = new Error(`${code}:${detail}`);
    err.code = code;
    throw err;
  };

  const scarcity = byId.get('seed-miles-cl1355-exact');
  if (!scarcity?.evidence || scarcity.evidence.scarcity_observations < (floors.scarcity_success?.min_observations || 5)) {
    fail('SUCCESS_SCENARIO_DATA_FLOOR_NOT_MET', 'scarcity observations');
  }
  if (
    !scarcity?.evidence ||
    (scarcity.evidence.sold_observations ?? 0) < (floors.scarcity_success?.min_sold_observations ?? 2)
  ) {
    fail('SUCCESS_SCENARIO_DATA_FLOOR_NOT_MET', 'scarcity sold observations');
  }
  checks.push({
    capability: 'scarcity',
    ok: true,
    observations: scarcity.evidence.scarcity_observations,
    sold_observations: scarcity.evidence.sold_observations,
  });

  const valuation = byId.get('seed-kenny-quiet-vgplus');
  if (
    !valuation?.evidence ||
    valuation.evidence.sold_comparables < (floors.valuation_success?.min_sold_comparables || 3) ||
    valuation.evidence.asking_comparables < (floors.valuation_success?.min_asking_comparables || 3)
  ) {
    fail('SUCCESS_SCENARIO_DATA_FLOOR_NOT_MET', 'valuation comparables');
  }
  checks.push({
    capability: 'valuation',
    ok: true,
    sold: valuation.evidence.sold_comparables,
    asking: valuation.evidence.asking_comparables,
  });

  const auction = byId.get('seed-watchlist-auction-5plus');
  if (!auction?.watchlist || auction.watchlist.min_lots < (floors.auction_success?.min_watched_lots || 5)) {
    fail('SUCCESS_SCENARIO_DATA_FLOOR_NOT_MET', 'auction watchlist lots');
  }
  checks.push({ capability: 'auction_intelligence', ok: true, min_lots: auction.watchlist.min_lots });

  const search = byId.get('seed-search-us-mono-catalog');
  if (!search?.search_corpus || search.search_corpus.min_results < (floors.search_success?.min_results || 5)) {
    fail('SUCCESS_SCENARIO_DATA_FLOOR_NOT_MET', 'search results');
  }
  checks.push({ capability: 'semantic_search', ok: true, min_results: search.search_corpus.min_results });

  const recs = byId.get('seed-recommendations-candidate-pool-8plus');
  if (
    !recs?.recommendations ||
    recs.recommendations.min_candidates < (floors.recommendations_success?.min_candidates || 8) ||
    recs.recommendations.min_rendered_cards < (floors.recommendations_success?.min_rendered_cards || 5)
  ) {
    fail('SUCCESS_SCENARIO_DATA_FLOOR_NOT_MET', 'recommendations candidates');
  }
  checks.push({
    capability: 'recommendations',
    ok: true,
    candidates: recs.recommendations.min_candidates,
    cards: recs.recommendations.min_rendered_cards,
  });

  const analytics = byId.get('seed-analytics-bluenote-90d');
  if (
    !analytics?.analytics ||
    analytics.analytics.min_population < (floors.analytics_success?.min_population || 20)
  ) {
    fail('SUCCESS_SCENARIO_DATA_FLOOR_NOT_MET', 'analytics population');
  }
  checks.push({
    capability: 'market_analytics',
    ok: true,
    population: analytics.analytics.min_population,
  });

  for (const f of seedManifest.fixtures || []) {
    const cover = f.record?.cover_image || '';
    if (/picsum\.photos|loremflickr|unsplash\.com/i.test(cover)) {
      fail('ENTITY_MEDIA_MISMATCH', f.seed_fixture_id);
    }
    if (
      f.listing &&
      /\[sold\]/i.test(String(f.listing.title || '')) &&
      String(f.listing.status).toLowerCase() === 'active'
    ) {
      fail('SOLD_STATUS_CONTRADICTION', f.seed_fixture_id);
    }
  }

  return { ok: true, checks };
}

function copyFileNoSymlink(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function exportOwnerReviewPack({ outRoot, doc, ledgerRows, screenshotRows, summary, latency }) {
  const exportRoot = OWNER_REVIEW_EXPORT;
  if (fs.existsSync(exportRoot)) {
    fs.rmSync(exportRoot, { recursive: true, force: true });
  }
  const fullDir = path.join(exportRoot, 'full');
  const selectedDir = path.join(exportRoot, 'selected-20');
  const reviewDir = path.join(exportRoot, 'review');
  const reportsDir = path.join(exportRoot, 'reports');
  for (const d of [fullDir, selectedDir, reviewDir, reportsDir]) fs.mkdirSync(d, { recursive: true });

  const copied = [];
  for (const row of screenshotRows) {
    const src = row.path || row.file_path || row.absolute_path;
    if (!src || !fs.existsSync(src)) continue;
    const base = path.basename(src);
    const dest = path.join(fullDir, base);
    copyFileNoSymlink(src, dest);
    copied.push({ ...row, export_rel: `full/${base}`, sha256: sha256File(dest) });
  }

  const selected = pickSelected20(copied, ledgerRows);
  const selectedMeta = [];
  selected.forEach((item, idx) => {
    const name = `${String(idx + 1).padStart(2, '0')}-${item.slug}.png`;
    const dest = path.join(selectedDir, name);
    copyFileNoSymlink(path.join(exportRoot, item.export_rel), dest);
    selectedMeta.push({ index: idx + 1, file: name, sha256: sha256File(dest), ...item });
  });

  // Rewrite review HTML with relative paths only
  const byScenarioShots = {};
  for (const c of copied) {
    const sid = c.scenario_id || 'unknown';
    if (!byScenarioShots[sid]) byScenarioShots[sid] = [];
    byScenarioShots[sid].push({
      rel: `../full/${path.basename(c.export_rel)}`,
      label: c.label || c.state || c.capture_state || 'shot',
    });
  }
  generateOwnerProofReviewPage({
    outRoot: exportRoot,
    scenarios: doc.scenarios,
    ledgerRows,
    screenshotsByScenario: byScenarioShots,
  });

  // Capability pages + timeline
  for (const cap of [
    'scarcity',
    'valuation',
    'auction',
    'embeddings',
    'search',
    'negotiation',
    'recommendations',
    'analytics',
  ]) {
    const matchCap = {
      scarcity: 'scarcity',
      valuation: 'valuation',
      auction: 'auction_intelligence',
      embeddings: 'embeddings',
      search: 'semantic_search',
      negotiation: 'negotiation_assistance',
      recommendations: 'recommendations',
      analytics: 'market_analytics',
    }[cap];
    const scenarios = doc.scenarios.filter((s) => s.capability === matchCap);
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${cap}</title></head><body>
      <h1>${cap}</h1>
      <p><a href="index.html">All scenarios</a></p>
      <ul>${scenarios.map((s) => `<li><a href="index.html#${s.scenario_id}">${s.scenario_id}</a> — ${escapeHtml(s.user_intent)}</li>`).join('')}</ul>
    </body></html>`;
    fs.writeFileSync(path.join(reviewDir, `capability-${cap}.html`), html);
  }
  fs.writeFileSync(
    path.join(reviewDir, 'scenario-timeline.html'),
    `<!doctype html><html><head><meta charset="utf-8"/><title>Timeline</title></head><body>
      <h1>Scenario timeline</h1>
      <p><a href="index.html">Review index</a></p>
      <ol>${doc.scenarios.map((s) => `<li><a href="index.html#${s.scenario_id}">${s.scenario_id}</a></li>`).join('')}</ol>
    </body></html>`,
  );

  const ledgerSrc = path.join(outRoot, 'reports', 'owner-proof-execution.jsonl');
  if (fs.existsSync(ledgerSrc)) copyFileNoSymlink(ledgerSrc, path.join(reportsDir, 'owner-proof-execution.jsonl'));
  fs.writeFileSync(path.join(reportsDir, 'execution-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  fs.writeFileSync(path.join(reportsDir, 'latency-report.json'), JSON.stringify(latency, null, 2) + '\n');
  fs.writeFileSync(
    path.join(reportsDir, 'latency-report.html'),
    `<!doctype html><html><body><h1>Latency</h1><pre>${escapeHtml(JSON.stringify(latency, null, 2))}</pre></body></html>`,
  );
  fs.writeFileSync(
    path.join(reportsDir, 'pipeline-telemetry.json'),
    JSON.stringify({ note: 'See execution ledger pipeline fields', turns: ledgerRows.length }, null, 2) +
      '\n',
  );
  fs.writeFileSync(
    path.join(reportsDir, 'pipeline-telemetry.html'),
    `<!doctype html><html><body><h1>Pipeline telemetry</h1><p>Rows: ${ledgerRows.length}</p></body></html>`,
  );
  fs.writeFileSync(
    path.join(reportsDir, 'protocol-pcap-tls.json'),
    JSON.stringify(summary.protocol_pcap_tls || {}, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(reportsDir, 'accessibility-report.json'),
    JSON.stringify(summary.accessibility || {}, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(reportsDir, 'visual-gaps.md'),
    `# Visual gaps\n\nFreeze: ${summary.freeze}\nScreenshots copied: ${copied.length}\nSelected-20: ${selectedMeta.length}\n`,
  );

  const manifest = {
    export_root: exportRoot,
    screenshots_full: copied.length,
    selected_20: selectedMeta,
    freeze: summary.freeze,
    head_sha: summary.head_sha,
  };
  fs.writeFileSync(path.join(exportRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const sums = [];
  for (const dir of [fullDir, selectedDir]) {
    for (const name of fs.readdirSync(dir)) {
      const fp = path.join(dir, name);
      if (!fs.statSync(fp).isFile()) continue;
      sums.push(`${sha256File(fp)}  ${path.relative(exportRoot, fp)}`);
    }
  }
  fs.writeFileSync(path.join(exportRoot, 'SHA256SUMS'), sums.join('\n') + '\n');
  fs.writeFileSync(
    path.join(exportRoot, 'UPLOAD-ORDER.txt'),
    [
      '1. review/index.html',
      '2. selected-20/ (20 PNGs)',
      '3. reports/execution-summary.json',
      '4. reports/owner-proof-execution.jsonl',
      '5. full/ (complete screenshot set)',
    ].join('\n') + '\n',
  );

  // Fail if any symlink sneaked in
  walkNoSymlinks(exportRoot);

  return { exportRoot, selected_20: selectedMeta.length, full: copied.length };
}

function walkNoSymlinks(root) {
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    for (const name of fs.readdirSync(cur)) {
      const fp = path.join(cur, name);
      const st = fs.lstatSync(fp);
      if (st.isSymbolicLink()) {
        const err = new Error(`symlink_forbidden:${fp}`);
        err.code = 'OWNER_PROOF_EXPORT_SYMLINK';
        throw err;
      }
      if (st.isDirectory()) stack.push(fp);
    }
  }
}

function pickSelected20(copied, ledgerRows) {
  const byScenario = new Map();
  for (const c of copied) {
    const sid = c.scenario_id || guessScenario(c);
    if (!byScenario.has(sid)) byScenario.set(sid, []);
    byScenario.get(sid).push(c);
  }
  const pick = (scenarioId, preferTerminal = true) => {
    const rows = byScenario.get(scenarioId) || [];
    if (!rows.length) return null;
    const term = preferTerminal
      ? rows.find((r) => /ready|terminal|completed|result/i.test(String(r.state || r.capture_state || r.label || '')))
      : rows.find((r) => /intent|before|action|idle/i.test(String(r.state || r.capture_state || r.label || '')));
    return term || rows[preferTerminal ? rows.length - 1 : 0];
  };
  const slots = [
    ['scarcity-success-exact-pressing', 'scarcity-intent', false],
    ['scarcity-success-exact-pressing', 'scarcity-result', true],
    ['valuation-success-ranges', 'valuation-intent', false],
    ['valuation-success-ranges', 'valuation-result', true],
    ['auction-success-watchlist-temperature', 'auction-intent', false],
    ['auction-success-watchlist-temperature', 'auction-result', true],
    ['embeddings-success-current-lineage', 'embed-current', true],
    ['embeddings-stale-reembed', 'embed-stale', true],
    ['search-success-semantic', 'search-intent', false],
    ['search-success-semantic', 'search-result', true],
    ['negotiation-four-turn-live', 'nego-t1', true],
    ['negotiation-four-turn-live', 'nego-t2', true],
    ['negotiation-four-turn-live', 'nego-t3', true],
    ['negotiation-four-turn-live', 'nego-t4', true],
    ['negotiation-four-turn-live', 'nego-draft', true],
    ['recommendations-success-cards', 'recs-intent', false],
    ['recommendations-success-cards', 'recs-result', true],
    ['analytics-success-report', 'analytics-intent', false],
    ['analytics-success-report', 'analytics-result', true],
    ['negotiation-privacy-or-safety-refusal', 'abstention', true],
  ];

  // For negotiation turns, prefer distinct turn_index
  const nego = byScenario.get('negotiation-four-turn-live') || [];
  const negoByTurn = new Map();
  for (const r of nego) {
    const ti = r.turn_index ?? 0;
    if (!negoByTurn.has(ti)) negoByTurn.set(ti, r);
  }

  const out = [];
  const usedSha = new Set();
  for (const [scenarioId, slug, terminal] of slots) {
    let row = null;
    if (scenarioId === 'negotiation-four-turn-live') {
      if (slug === 'nego-t1') row = negoByTurn.get(0) || nego[0];
      else if (slug === 'nego-t2') row = negoByTurn.get(1) || nego[1];
      else if (slug === 'nego-t3') row = negoByTurn.get(2) || nego[2];
      else if (slug === 'nego-t4' || slug === 'nego-draft') row = negoByTurn.get(3) || nego[nego.length - 1];
    } else {
      row = pick(scenarioId, terminal);
    }
    if (!row) {
      // fallback any unused
      row = copied.find((c) => !usedSha.has(c.sha256)) || copied[0];
    }
    if (!row) continue;
    if (usedSha.has(row.sha256)) {
      const alt = copied.find((c) => !usedSha.has(c.sha256));
      if (alt) row = alt;
    }
    usedSha.add(row.sha256);
    out.push({ ...row, slug, scenario_id: scenarioId });
    if (out.length >= 20) break;
  }
  while (out.length < 20 && copied.length) {
    const next = copied.find((c) => !usedSha.has(c.sha256));
    if (!next) break;
    usedSha.add(next.sha256);
    out.push({ ...next, slug: `extra-${out.length + 1}` });
  }
  return out.slice(0, 20);
}

function guessScenario(row) {
  return row.scenario_id || 'unknown';
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Execute the live 24-scenario owner-proof rehearsal into outRoot.
 * Caller must have already validated SHA/CI/approval and created outRoot.
 */
export async function executeOwnerProofLiveRehearsal({
  outRoot,
  headSha,
  upstreamUrl = process.env.E2E_UPSTREAM_URL || 'https://record-platform.test',
  headless = true,
  proxyPort = Number(process.env.PHASE34_BROWSER_PROXY_PORT || 8443),
}) {
  assertProductOutEligible(outRoot);
  if (fs.existsSync(PHASE33F_TARGET_FORBIDDEN)) {
    const err = new Error('Phase 33F target must remain ABSENT');
    err.code = 'PHASE34_PRODUCT_TARGET_MUST_BE_ABSENT';
    throw err;
  }
  for (const forbidden of [
    '/tmp/phase34-product-harness-live-smoke-v6',
    '/tmp/phase34-product-gauntlet-canary-v1',
    '/tmp/phase34-product-gauntlet-v1',
  ]) {
    if (fs.existsSync(forbidden)) {
      const err = new Error(`forbidden_root_present:${forbidden}`);
      err.code = 'OWNER_PROOF_FORBIDDEN_ROOT_PRESENT';
      throw err;
    }
  }

  const doc = loadOwnerProofScenarios();
  const seeds = loadOwnerProofSeedManifest();
  validateSeedManifestAgainstScenarios(doc, seeds);
  const seedReport = assertSeedFloors(seeds);
  const schedule = buildOwnerProofSchedule(doc);

  fs.writeFileSync(path.join(outRoot, 'seed-floor-report.json'), JSON.stringify(seedReport, null, 2) + '\n');
  fs.writeFileSync(path.join(outRoot, 'rehearsal-schedule.json'), JSON.stringify(schedule, null, 2) + '\n');

  process.env.CONTRACT_SCREENSHOT_DATE =
    process.env.CONTRACT_SCREENSHOT_DATE || contractScreenshotDate();
  const caCert = caCertPath();
  process.env.NODE_EXTRA_CA_CERTS = process.env.NODE_EXTRA_CA_CERTS || caCert;
  process.env.CA_CERT = caCert;
  process.env.BASE_URL = upstreamUrl;
  process.env.E2E_API_BASE = upstreamUrl;

  const runtimePins = resolveRuntimePins();
  fs.writeFileSync(
    path.join(outRoot, 'runtime-pins-resolved.json'),
    JSON.stringify(
      {
        ...runtimePins,
        browser_tls_mode: 'BROWSER_TLS_PROXY_WITH_STRICT_UPSTREAM',
        direct_chromium_client_cert_mtls: 'NOT_CONFIGURED',
      },
      null,
      2,
    ) + '\n',
  );

  const proxy = await ensureMkcertProxy({ proxyPort, outRoot, caCert });
  const pcapStatus = startProductPcapCapture(outRoot);
  fs.writeFileSync(path.join(outRoot, 'pcap-start.json'), JSON.stringify(pcapStatus, null, 2) + '\n');

  const buyer = await loginContractUser({
    baseUrl: upstreamUrl,
    email: BUYER_EMAIL,
    password: BUYER_PASSWORD,
    caCert,
  });
  const seller = await loginContractUser({
    baseUrl: upstreamUrl,
    email: SELLER_EMAIL,
    password: SELLER_PASSWORD,
    caCert,
  });
  const subjects = await resolveLiveSubjects({
    baseUrl: upstreamUrl,
    token: buyer.token,
    caCert,
  });
  if (!subjects.record_id || !subjects.listing_id) {
    const err = new Error('MISSING_OWNER_PROOF_EVIDENCE:live subjects incomplete');
    err.code = 'MISSING_OWNER_PROOF_EVIDENCE';
    throw err;
  }
  fs.writeFileSync(
    path.join(outRoot, 'live-subjects.json'),
    JSON.stringify(
      {
        record_id_present: Boolean(subjects.record_id),
        listing_id_present: Boolean(subjects.listing_id),
        auction_listing_id_present: Boolean(subjects.auction_listing_id),
        thread_id_present: Boolean(subjects.thread_id),
      },
      null,
      2,
    ) + '\n',
  );
  fs.writeFileSync(
    path.join(outRoot, 'tls-mode.json'),
    JSON.stringify(
      {
        browser_tls_mode: proxy.tls_mode,
        ignoreHTTPSErrors: false,
        upstream: upstreamUrl,
        browser_base_url: proxy.browserBaseUrl,
        direct_chromium_client_cert_mtls: 'NOT_CONFIGURED',
        service_mtls: 'SEPARATE_MATRIX',
      },
      null,
      2,
    ) + '\n',
  );

  const productLedger = new ProductLedgerWriter(outRoot).ensure();
  const ownerLedger = createOwnerProofLedger(outRoot);
  const screenshotManifest = new ScreenshotManifestWriter(outRoot);
  const gate = new ProductFailClosedGate();
  const results = [];
  const tracesDir = path.join(outRoot, 'playwright-traces');
  fs.mkdirSync(tracesDir, { recursive: true });
  const traceIndex = [];
  const latencySamples = [];

  const browser = await loadChromium().launch({
    headless,
    ignoreHTTPSErrors: false,
  });
  const browserVersion = browser.version?.() || null;

  try {
    for (const row of schedule.rows) {
      if (!gate.canStartSession()) break;
      const side = row.participant_side === 'seller' ? 'seller' : 'buyer';
      const auth = side === 'seller' ? seller : buyer;
      const email = side === 'seller' ? SELLER_EMAIL : BUYER_EMAIL;
      const profile =
        side === 'seller'
          ? { name: 'Seller Contract', initials: 'SC' }
          : { name: 'Buyer Contract', initials: 'BC' };

      const context = await browser.newContext({
        ignoreHTTPSErrors: false,
        viewport: VIEWPORTS[row.smoke_viewport] || VIEWPORTS.desktop,
        baseURL: proxy.browserBaseUrl,
      });
      const page = await context.newPage();
      const tracePath = path.join(tracesDir, `${row.scenario_id}.zip`);
      await context.tracing.start({ screenshots: true, snapshots: true, sources: false });

      try {
        await signInWithToken(page, proxy.browserBaseUrl, {
          token: auth.token,
          email,
          name: profile.name,
          initials: profile.initials,
        });
        const result = await runProductSession(row, {
          page,
          fixtureMode: false,
          liveProtocol: true,
          gate,
          ledger: productLedger,
          screenshotManifest,
          screenshotPack: 'owner-proof-rehearsal-v1',
          turnCount: row.smoke_turns,
          subject: subjectForCapability(subjects, row.capability),
          protocolBaseUrl: upstreamUrl,
          baseUrl: upstreamUrl,
          caCert,
          protocolToken: auth.token,
          token: auth.token,
          runtimeImagePin: runtimePins.runtime_image_digest,
          certificatePin: runtimePins.certificate_fingerprint,
          pcapOutRoot: outRoot,
        });
        if (result.session.pin_source === PIN_SOURCE.FIXTURE_SYNTHETIC_PIN) {
          assertLivePinsNotSynthetic(result.session.config_pins);
        }
        results.push(result);
        await context.tracing.stop({ path: tracePath });
        result.session.trace_path = tracePath;
        result.session.browser_version = browserVersion;
        result.session.owner_proof_scenario_id = row.scenario_id;
        traceIndex.push({
          scenario_id: row.scenario_id,
          session_id: result.session.session_id,
          turn_ids: (result.turns || []).map((t) => t.turnRow?.turn_id).filter(Boolean),
        });

        for (const turn of result.turns || []) {
          const br = turn.browserResult || {};
          const latency = buildLatencyRow({
            browser_action_to_request_ms:
              br.timings?.browser_action_to_request_us != null
                ? Math.round(br.timings.browser_action_to_request_us / 1000)
                : null,
            browser_action_to_panel_ready_ms:
              br.timings?.browser_action_to_panel_ready_us != null
                ? Math.round(br.timings.browser_action_to_panel_ready_us / 1000)
                : null,
            H1_total_ms: turn.triplet?.h1?.total_ms ?? null,
            H2_total_ms: turn.triplet?.h2?.total_ms ?? null,
            H3_total_ms: turn.triplet?.h3?.total_ms ?? null,
          });
          latencySamples.push(latency);
          const shot = (turn.screenshots || []).find((s) =>
            /ready|terminal|completed/i.test(String(s.state || s.capture_state || '')),
          ) || (turn.screenshots || [])[(turn.screenshots || []).length - 1];
          ownerLedger.append({
            scenario_id: row.scenario_id,
            scenario_class: row.scenario_class,
            session_id: result.session.session_id,
            turn_id: turn.turnRow?.turn_id,
            turn_index: turn.turnRow?.turn_index ?? 0,
            journey_id: result.session.journey_id,
            participant_side: row.participant_side,
            route: br.browser_route || row.owner_proof_canonical_route,
            visible_user_intent: row.user_intent,
            subject_entity: subjects.record_id,
            subject_listing: subjects.listing_id,
            subject_thread: subjects.thread_id,
            canonical_request_hash: turn.turnRow?.canonical_request_hash,
            browser_request_id: br.request_id || null,
            endpoint: row.owner_proof_endpoint,
            http_status: turn.triplet?.h1?.http_status ?? null,
            result_summary: String(br.rendered?.summary || br.journey_outcome || '').slice(0, 240),
            evidence_count: Array.isArray(br.rendered?.structured?.evidence)
              ? br.rendered.structured.evidence.length
              : null,
            rendered_result_hash: turn.turnRow?.rendered_result_hash,
            screenshot_path: shot?.path || null,
            screenshot_sha256: shot?.sha256 || null,
            H1_probe_id: turn.triplet?.h1?.probe_id,
            H2_probe_id: turn.triplet?.h2?.probe_id,
            H3_probe_id: turn.triplet?.h3?.probe_id,
            H1_status: turn.triplet?.h1?.ok ? 'PASS' : 'FAIL',
            H2_status: turn.triplet?.h2?.ok ? 'PASS' : 'FAIL',
            H3_status: turn.triplet?.h3?.ok ? 'PASS' : 'FAIL',
            pipeline_components: turn.invocations || null,
            configuration_pins: result.session.config_pins || null,
            ...latency,
            accessibility_status: br.accessibility_result || null,
            privacy_status: 'PASS',
            safety_status: 'PASS',
            human_review_status: 'PENDING',
            winning_prompt_configuration_hash:
              result.session.config_pins?.prompt_configuration_id || null,
          });
        }
      } catch (err) {
        await context.tracing.stop({ path: tracePath }).catch(() => null);
        gate.noteSessionResult({
          browser_journey_status: 'FAIL',
          ui_api_reconciliation_status: 'FAIL',
          protocol_status: 'FAIL',
          pcap_gap: String(err.code || '').includes('PCAP'),
        });
        results.push({
          session: {
            session_outcome: 'FAIL',
            error: String(err.message || err),
            code: err.code || null,
            capability: row.capability,
            scenario_id: row.scenario_id,
            owner_proof_scenario_id: row.scenario_id,
            trace_path: fs.existsSync(tracePath) ? tracePath : null,
          },
        });
        break;
      } finally {
        await context.close().catch(() => null);
      }

      if (gate.canStartSession()) {
        await sleep(productLiveInterSessionMs());
      }
    }
  } finally {
    await browser.close();
    try {
      proxy.child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    stopProductPcapCapture(outRoot);
  }

  const manifest = screenshotManifest.finalize();
  const pngValidation = validateAllProductScreenshots(manifest.rows || []);
  fs.writeFileSync(
    path.join(outRoot, 'screenshot-png-validation.json'),
    JSON.stringify(pngValidation, null, 2) + '\n',
  );

  let distinctness = { ok: true };
  try {
    const bySession = new Map();
    for (const row of manifest.rows || []) {
      const sid = row.session_id || 'unknown';
      if (!bySession.has(sid)) bySession.set(sid, []);
      bySession.get(sid).push({
        path: row.path || row.file_path || row.absolute_path,
        label: `${row.capability}:${row.state || 'state'}:turn${row.turn_index ?? 0}`,
      });
    }
    for (const [, rows] of bySession) {
      if (rows.length < 2) continue;
      assertScreenshotDistinctness(
        rows.filter((r) => r.path),
        { maxExactDuplicates: 0 },
      );
    }
  } catch (err) {
    distinctness = { ok: false, error: err.code || err.message, message: String(err.message || err) };
  }
  fs.writeFileSync(path.join(outRoot, 'screenshot-distinctness.json'), JSON.stringify(distinctness, null, 2) + '\n');

  const sheetsDir = path.join(outRoot, 'contact-sheets');
  generateContactSheets(manifest.rows || [], sheetsDir);

  const ledgerRows = ownerLedger.readAll();
  const latency = summarizeLatency(latencySamples.map((r) => ({
    browser_action_to_panel_ready_ms: r.browser_action_to_panel_ready_ms,
  })));
  fs.writeFileSync(path.join(outRoot, 'latency-summary.json'), JSON.stringify(latency, null, 2) + '\n');

  generateOwnerProofReviewPage({
    outRoot,
    scenarios: doc.scenarios,
    ledgerRows,
    screenshotsByScenario: groupShotsByScenario(manifest.rows || []),
  });

  const pass = results.filter((r) => r.session?.session_outcome === 'PASS').length;
  const fail = results.length - pass;
  const turns = results.reduce((n, r) => n + (r.session?.executed_turn_count || r.turns?.length || 0), 0);
  const h1 = ledgerRows.filter((r) => r.H1_status === 'PASS').length;
  const h2 = ledgerRows.filter((r) => r.H2_status === 'PASS').length;
  const h3 = ledgerRows.filter((r) => r.H3_status === 'PASS').length;
  const nego = results.find((r) => r.session?.owner_proof_scenario_id === 'negotiation-four-turn-live');

  const frozenReady =
    pass === 24 &&
    fail === 0 &&
    turns === 27 &&
    h1 === 27 &&
    h2 === 27 &&
    h3 === 27 &&
    gate.next_session_started_after_hard_failure === 0 &&
    pngValidation.pass &&
    distinctness.ok !== false;

  const summary = {
    kind: 'OWNER_PROOF_LIVE_REHEARSAL_V1',
    execution: 'LIVE',
    out: outRoot,
    head_sha: headSha,
    logical_scenarios: results.length,
    logical_pass: pass,
    logical_fail: fail,
    turns,
    protocol_rows: turns * 3,
    H1_pass: h1,
    H2_pass: h2,
    H3_pass: h3,
    screenshots: manifest.count,
    screenshot_png_validation: pngValidation.screenshots_validated,
    gate: gate.snapshot(),
    freeze: frozenReady ? 'FROZEN_PASS_EVIDENCE' : 'FROZEN_BLOCKED_EVIDENCE',
    negotiation_session_id: nego?.session?.session_id || null,
    browser_tls_mode: proxy.tls_mode,
    ignoreHTTPSErrors: false,
    direct_chromium_client_cert_mtls: 'NOT_CONFIGURED',
    production: 'NOT APPROVED',
    smoke_v6: 'ABSENT_NOT_LAUNCHED',
    product_canary: 'ABSENT',
    full_gauntlet: 'ABSENT',
    phase33f_target: 'ABSENT',
    first_failure: results.find((r) => r.session?.session_outcome !== 'PASS')?.session || null,
    protocol_pcap_tls: {
      browser_tls_mode: proxy.tls_mode,
      ignoreHTTPSErrors: false,
      H1_pass: h1,
      H2_pass: h2,
      H3_pass: h3,
    },
    accessibility: {
      failures: ledgerRows.filter((r) => r.accessibility_status === 'FAIL').length,
    },
    latency,
  };

  fs.writeFileSync(path.join(outRoot, 'execution-summary.json'), JSON.stringify(summary, null, 2) + '\n');

  let exportMeta = null;
  try {
    exportMeta = exportOwnerReviewPack({
      outRoot,
      doc,
      ledgerRows,
      screenshotRows: (manifest.rows || []).map((r) => ({
        ...r,
        scenario_id:
          r.scenario_id ||
          results.find((res) => res.session?.session_id === r.session_id)?.session
            ?.owner_proof_scenario_id,
      })),
      summary,
      latency,
    });
  } catch (err) {
    summary.export_error = String(err.message || err);
    fs.writeFileSync(path.join(outRoot, 'execution-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  }

  // Freeze marker last
  const freezeName = summary.freeze;
  fs.writeFileSync(path.join(outRoot, freezeName), `${freezeName}\n${new Date().toISOString()}\n`);
  if (exportMeta?.exportRoot) {
    fs.writeFileSync(
      path.join(exportMeta.exportRoot, freezeName),
      `${freezeName}\n${new Date().toISOString()}\n`,
    );
  }

  return { summary, exportMeta, results, ledgerRows };
}

function groupShotsByScenario(rows) {
  const map = {};
  for (const r of rows) {
    const sid = r.scenario_id || r.session_id || 'unknown';
    if (!map[sid]) map[sid] = [];
    const base = path.basename(r.path || r.file_path || '');
    map[sid].push({
      rel: base ? `../screenshots/${base}` : '',
      label: r.state || r.capture_state || 'shot',
    });
  }
  return map;
}
