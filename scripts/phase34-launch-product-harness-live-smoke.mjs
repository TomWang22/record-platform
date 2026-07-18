#!/usr/bin/env node
/**
 * Phase 34 — 64-session LIVE product-harness smoke.
 *
 * Default (smoke-v6): /tmp/phase34-product-harness-live-smoke-v6
 * Override with PHASE34_PRODUCT_SMOKE_OUT / PHASE34_PRODUCT_SMOKE_PACK.
 * Preserves frozen smoke-v1/v2/v3/v4 roots (do not mutate).
 * smoke-v5 readiness on e28f90aa is superseded — do not launch v5.
 * smoke-v6 readiness on 2d64c943 is superseded before launch — require the
 * 24-scenario owner-proof live rehearsal FROZEN_PASS_EVIDENCE first.
 *
 * Requires:
 *   - committed HEAD == origin/main
 *   - exact-SHA CI approval
 *   - PHASE34_PRODUCT_SMOKE_APPROVED_SHA=<head>
 *   - live stack + Chromium + PCAP (ChmodBPF dumpcap)
 *   - mkcert (browser front) + certs/dev-chain.pem (strict upstream)
 *
 * Does NOT create canary/full product roots.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  buildInterleavedProductSchedule,
  PRODUCT_CAPABILITIES,
} from './lib/phase34-product-schedule.mjs';
import {
  assertProductOutEligible,
  PHASE33F_TARGET_FORBIDDEN,
  ProductLedgerWriter,
  PRODUCT_LIVE_SMOKE_ROOT,
  PRODUCT_LIVE_SMOKE_ROOT_V4,
} from './lib/phase34-product-ledgers.mjs';
import {
  runProductSession,
  ProductFailClosedGate,
} from './lib/phase34-product-session-runner.mjs';
import {
  ScreenshotManifestWriter,
  generateContactSheets,
  projectScreenshotDiskUsage,
  contractScreenshotDate,
  PLAYWRIGHT_TRACE_POLICY,
} from './lib/phase34-product-screenshots.mjs';
import { assertLivePinsNotSynthetic, PIN_SOURCE } from './lib/phase34-product-runtime-pins.mjs';
import { assertSourceReconciliation, assertCiApproval } from './lib/phase32h-ci-approval.mjs';
import {
  loginContractUser,
  resolveLiveSubjects,
  subjectForCapability,
} from './lib/phase34-product-live-subjects.mjs';
import { INTER_BATCH_INTERVAL_MS } from './lib/phase33f-rate-limit.mjs';
import {
  startProductPcapCapture,
  stopProductPcapCapture,
} from './lib/phase34-product-pcap.mjs';
import { validateAllProductScreenshots } from './lib/phase34-product-png-validation.mjs';
import { assertScreenshotDistinctness } from './lib/phase34-product-screenshot-distinctness.mjs';
import { loadOwnerProofScenarios } from './lib/phase34-owner-proof-scenarios.mjs';
import { CAPABILITY_SURFACE_REGISTRY } from './lib/phase34-product-journeys/adapters.mjs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function productLiveInterSessionMs() {
  const raw = Number(process.env.PHASE34_PRODUCT_INTER_SESSION_MS);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return Math.max(INTER_BATCH_INTERVAL_MS * 2, 2500);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

export { PRODUCT_LIVE_SMOKE_ROOT };

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

function loadChromium() {
  const requireFromWebapp = createRequire(path.join(REPO_ROOT, 'webapp/package.json'));
  try {
    return requireFromWebapp('playwright').chromium;
  } catch {
    const testPkg = requireFromWebapp('@playwright/test');
    if (testPkg?.chromium) return testPkg.chromium;
    const err = new Error('playwright chromium unavailable — run pnpm install in webapp');
    err.code = 'PHASE34_PRODUCT_SMOKE_PLAYWRIGHT_MISSING';
    throw err;
  }
}

const VIEWPORTS = {
  desktop: { width: 1280, height: 720 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};

const SMOKE_PACK = process.env.PHASE34_PRODUCT_SMOKE_PACK || 'smoke-v6';
const SMOKE_KIND =
  process.env.PHASE34_PRODUCT_SMOKE_KIND ||
  (SMOKE_PACK === 'smoke-v6'
    ? 'PRODUCT_HARNESS_LIVE_SMOKE_V6'
    : SMOKE_PACK === 'smoke-v5'
      ? 'PRODUCT_HARNESS_LIVE_SMOKE_V5'
      : SMOKE_PACK === 'smoke-v4'
        ? 'PRODUCT_HARNESS_LIVE_SMOKE_V4'
        : SMOKE_PACK === 'smoke-v3'
          ? 'PRODUCT_HARNESS_LIVE_SMOKE_V3'
          : 'PRODUCT_HARNESS_LIVE_SMOKE_V2');
const DEFAULT_SMOKE_OUT =
  process.env.PHASE34_PRODUCT_SMOKE_OUT ||
  (SMOKE_PACK === 'smoke-v6'
    ? '/tmp/phase34-product-harness-live-smoke-v6'
    : SMOKE_PACK === 'smoke-v5'
      ? '/tmp/phase34-product-harness-live-smoke-v5'
      : SMOKE_PACK === 'smoke-v4'
        ? '/tmp/phase34-product-harness-live-smoke-v4'
        : SMOKE_PACK === 'smoke-v3'
          ? '/tmp/phase34-product-harness-live-smoke-v3'
          : PRODUCT_LIVE_SMOKE_ROOT);

function parseArgs(argv) {
  const opts = {
    out: DEFAULT_SMOKE_OUT,
    execute: false,
    upstreamUrl: process.env.E2E_UPSTREAM_URL || 'https://record-platform.test',
    headless: true,
    proxyPort: Number(process.env.PHASE34_BROWSER_PROXY_PORT || 8443),
    screenshotPack: SMOKE_PACK,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--execute') opts.execute = true;
    else if (a === '--base-url') opts.upstreamUrl = argv[++i];
    else if (a === '--upstream-url') opts.upstreamUrl = argv[++i];
    else if (a === '--headed') opts.headless = false;
    else if (a === '--proxy-port') opts.proxyPort = Number(argv[++i]);
  }
  return opts;
}

/**
 * Build the exact 64-session smoke schedule.
 * 8 per capability; 2 multi-turn per capability; viewport mix 32/16/16.
 */
export function buildLiveSmokeSchedule(seed = `phase34-product-live-${SMOKE_PACK}`) {
  const full = buildInterleavedProductSchedule({ scale: 'canary', seed });
  const selected = [];
  for (const cap of PRODUCT_CAPABILITIES) {
    const rows = full.rows.filter((r) => r.capability === cap);
    const multis = rows.filter((r) => r.multi_turn_class === 'multi_4_12');
    const singles = rows.filter((r) => r.multi_turn_class === 'single');
    for (let m = 0; m < 2; m += 1) {
      const multi = multis[m] || multis[0];
      if (multi) {
        selected.push({
          ...multi,
          multi_turn_class: 'multi_4_12',
          smoke_turns: 4,
          surface_route_index: selected.filter((r) => r.capability === cap).length,
        });
      }
    }
    while (selected.filter((r) => r.capability === cap).length < 8) {
      const next = singles.shift();
      if (!next) break;
      selected.push({
        ...next,
        multi_turn_class: 'single',
        smoke_turns: 1,
        surface_route_index: selected.filter((r) => r.capability === cap).length,
      });
    }
  }
  selected.forEach((row, i) => {
    row.smoke_viewport = i < 32 ? 'desktop' : i < 48 ? 'tablet' : 'mobile';
    row.smoke_index = i;
  });
  if (selected.length !== 64) {
    const err = new Error(`smoke schedule size ${selected.length} != 64`);
    err.code = 'PHASE34_PRODUCT_SMOKE_SCHEDULE_INVALID';
    throw err;
  }
  const multiCount = selected.filter((r) => r.multi_turn_class === 'multi_4_12').length;
  if (multiCount !== 16) {
    const err = new Error(`need 16 multi-turn sessions, got ${multiCount}`);
    err.code = 'PHASE34_PRODUCT_SMOKE_MULTITURN_INVALID';
    throw err;
  }
  return {
    seed,
    logical_sessions: 64,
    multi_turn_sessions: 16,
    turns_expected: 48 * 1 + 16 * 4,
    protocol_rows_expected: (48 * 1 + 16 * 4) * 3,
    rows: selected,
  };
}

function resolveRuntimePins() {
  let runtime_image_digest = process.env.PHASE34_RUNTIME_IMAGE_DIGEST || null;
  if (!runtime_image_digest) {
    const img = spawnSync(
      'kubectl',
      [
        '-n',
        'record-platform',
        'get',
        'deploy',
        'webapp',
        '-o',
        'jsonpath={.spec.template.spec.containers[0].image}',
      ],
      { encoding: 'utf8' },
    );
    if (img.status === 0 && img.stdout?.trim()) {
      runtime_image_digest = `image:${img.stdout.trim()}`;
    }
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

function writeRouteCapabilityMatrix(outRoot, results) {
  const matrix = [];
  for (const [capability, reg] of Object.entries(CAPABILITY_SURFACE_REGISTRY)) {
    const sessions = results.filter((r) => r.session?.capability === capability);
    const routes = [
      ...new Set(
        sessions.flatMap((s) =>
          (s.turns || [])
            .map((t) => t.browserResult?.browser_route)
            .filter(Boolean)
            .concat(s.session?.link ? [] : []),
        ),
      ),
    ];
    // Also from journey ledger if present later — use session screenshots routes
    matrix.push({
      capability,
      required_product_surfaces: (reg.mounted_surfaces || []).map((s) => ({
        route: s.route,
        panel: s.panel,
        status: s.status,
      })),
      actual_routes_visited: routes,
      session_count: sessions.length,
      status: sessions.length > 0 ? 'EXERCISED' : 'MISSING',
    });
  }
  fs.writeFileSync(
    path.join(outRoot, 'route-capability-matrix.json'),
    JSON.stringify({ matrix }, null, 2) + '\n',
  );
  return matrix;
}

function hashTraceFile(tracePath) {
  if (!tracePath || !fs.existsSync(tracePath)) return null;
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(tracePath));
  return hash.digest('hex');
}

function assertSmokeApproval(headSha) {
  const approved = process.env.PHASE34_PRODUCT_SMOKE_APPROVED_SHA?.trim();
  if (!approved || approved !== headSha) {
    const err = new Error(
      'live smoke requires PHASE34_PRODUCT_SMOKE_APPROVED_SHA equal to committed HEAD',
    );
    err.code = 'PHASE34_PRODUCT_SMOKE_NOT_APPROVED';
    throw err;
  }
}

function caCertPath() {
  const chain = path.join(REPO_ROOT, 'certs/dev-chain.pem');
  return fs.existsSync(chain) ? chain : path.join(REPO_ROOT, 'certs/dev-root.pem');
}

async function ensureMkcertProxy({ proxyPort, outRoot, caCert }) {
  const proxyRoot = path.join(outRoot, 'browser-tls-proxy');
  const certDir = path.join(proxyRoot, 'certs');
  fs.mkdirSync(certDir, { recursive: true });
  const certPath = path.join(certDir, 'local.pem');
  const keyPath = path.join(certDir, 'local-key.pem');
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    const mk = spawn(
      'mkcert',
      ['-cert-file', 'local.pem', '-key-file', 'local-key.pem', 'record-platform.test', 'localhost', '127.0.0.1'],
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
  await new Promise((r) => setTimeout(r, 800));
  if (child.exitCode != null) {
    const err = new Error(`browser TLS proxy exited early: ${fs.readFileSync(logPath, 'utf8').slice(0, 500)}`);
    err.code = 'PHASE34_PRODUCT_SMOKE_PROXY_FAILED';
    throw err;
  }
  return {
    child,
    browserBaseUrl: `https://127.0.0.1:${proxyPort}`,
    tls_mode: 'BROWSER_TLS_PROXY_WITH_STRICT_UPSTREAM',
    proxyRoot,
  };
}

async function signInWithToken(page, browserBaseUrl, { token, email, name, initials }) {
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

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  assertProductOutEligible(opts.out);
  if (fs.existsSync(PHASE33F_TARGET_FORBIDDEN)) {
    const err = new Error('Phase 33F target must remain ABSENT');
    err.code = 'PHASE34_PRODUCT_TARGET_MUST_BE_ABSENT';
    throw err;
  }

  const schedule = buildLiveSmokeSchedule();
  fs.mkdirSync(opts.out, { recursive: true });
  fs.writeFileSync(
    path.join(opts.out, 'smoke-schedule.json'),
    JSON.stringify(
      {
        ...schedule,
        rows: schedule.rows.map((r) => ({
          capability: r.capability,
          scenario_id: r.scenario_id,
          multi_turn_class: r.multi_turn_class,
          smoke_viewport: r.smoke_viewport,
          smoke_turns: r.smoke_turns,
          participant_side: r.participant_side,
          surface_route_index: r.surface_route_index,
          smoke_index: r.smoke_index,
        })),
      },
      null,
      2,
    ) + '\n',
  );
  fs.writeFileSync(
    path.join(opts.out, 'screenshot-disk-projection.json'),
    JSON.stringify(
      projectScreenshotDiskUsage({
        canarySessions: 64,
        multiTurnSessions: 16,
        avgMultiTurns: 4,
        statesPerCanaryTurn: 4,
      }),
      null,
      2,
    ) + '\n',
  );

  if (!opts.execute) {
    console.log(
      JSON.stringify(
        {
          kind: SMOKE_KIND,
          execution: 'NOT_EXECUTED',
          out: opts.out,
          schedule: {
            logical_sessions: schedule.logical_sessions,
            turns_expected: schedule.turns_expected,
            protocol_rows_expected: schedule.protocol_rows_expected,
          },
          next: 'Set PHASE34_PRODUCT_SMOKE_APPROVED_SHA and pass --execute after exact-SHA CI',
        },
        null,
        2,
      ),
    );
    return;
  }

  const { headSha, originMainSha } = assertSourceReconciliation(REPO_ROOT);
  if (headSha !== originMainSha) {
    const err = new Error(`HEAD ${headSha} != origin/main ${originMainSha}`);
    err.code = 'PHASE34_PRODUCT_SMOKE_SOURCE_DRIFT';
    throw err;
  }
  assertCiApproval({ headSha, originMainSha });
  assertSmokeApproval(headSha);

  process.env.CONTRACT_SCREENSHOT_DATE =
    process.env.CONTRACT_SCREENSHOT_DATE || contractScreenshotDate();

  const caCert = caCertPath();
  process.env.NODE_EXTRA_CA_CERTS = process.env.NODE_EXTRA_CA_CERTS || caCert;
  process.env.CA_CERT = caCert;
  process.env.BASE_URL = opts.upstreamUrl;
  process.env.E2E_API_BASE = opts.upstreamUrl;

  const runtimePins = resolveRuntimePins();
  fs.writeFileSync(
    path.join(opts.out, 'runtime-pins-resolved.json'),
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

  const proxy = await ensureMkcertProxy({
    proxyPort: opts.proxyPort,
    outRoot: opts.out,
    caCert,
  });

  const pcapStatus = startProductPcapCapture(opts.out);
  fs.writeFileSync(path.join(opts.out, 'pcap-start.json'), JSON.stringify(pcapStatus, null, 2) + '\n');

  const buyer = await loginContractUser({
    baseUrl: opts.upstreamUrl,
    email: BUYER_EMAIL,
    password: BUYER_PASSWORD,
    caCert,
  });
  const seller = await loginContractUser({
    baseUrl: opts.upstreamUrl,
    email: SELLER_EMAIL,
    password: SELLER_PASSWORD,
    caCert,
  });
  const subjects = await resolveLiveSubjects({
    baseUrl: opts.upstreamUrl,
    token: buyer.token,
    caCert,
  });
  fs.writeFileSync(
    path.join(opts.out, 'live-subjects.json'),
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
    path.join(opts.out, 'tls-mode.json'),
    JSON.stringify(
      {
        browser_tls_mode: proxy.tls_mode,
        ignoreHTTPSErrors: false,
        upstream: opts.upstreamUrl,
        browser_base_url: proxy.browserBaseUrl,
        insecure_curl_flags: 0,
        service_mtls: 'SEPARATE_MATRIX — see PKI gate',
        direct_chromium_client_cert_mtls: 'NOT_CONFIGURED',
      },
      null,
      2,
    ) + '\n',
  );

  const ledger = new ProductLedgerWriter(opts.out).ensure();
  const screenshotManifest = new ScreenshotManifestWriter(opts.out);
  const gate = new ProductFailClosedGate();
  const results = [];
  const tracesDir = path.join(opts.out, 'playwright-traces');
  fs.mkdirSync(tracesDir, { recursive: true });
  const traceIndex = [];

  const browser = await loadChromium().launch({
    headless: opts.headless,
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
        viewport: VIEWPORTS[row.smoke_viewport],
        baseURL: proxy.browserBaseUrl,
      });
      const page = await context.newPage();
      const tracePath = path.join(tracesDir, `${row.capability}-${row.smoke_index}.zip`);
      // Every smoke-v2 session retains a trace (policy: all sessions for evidence completeness).
      const shouldTrace = true;
      const tracePolicyReason =
        row.multi_turn_class === 'multi_4_12'
          ? 'multi_turn_boundary'
          : row.smoke_index % 8 === 0
            ? 'capability_sample'
            : 'smoke_v2_all_sessions';
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
          ledger,
          screenshotManifest,
          screenshotPack: opts.screenshotPack || SMOKE_PACK,
          turnCount: row.smoke_turns,
          subject: subjectForCapability(subjects, row.capability),
          protocolBaseUrl: opts.upstreamUrl,
          baseUrl: opts.upstreamUrl,
          caCert,
          protocolToken: auth.token,
          token: auth.token,
          runtimeImagePin: runtimePins.runtime_image_digest,
          certificatePin: runtimePins.certificate_fingerprint,
          pcapOutRoot: opts.out,
        });
        if (result.session.pin_source === PIN_SOURCE.FIXTURE_SYNTHETIC_PIN) {
          assertLivePinsNotSynthetic(result.session.config_pins);
        }
        results.push(result);
        await context.tracing.stop({ path: tracePath });
        const trace_sha256 = hashTraceFile(tracePath);
        result.session.trace_path = tracePath;
        result.session.trace_sha256 = trace_sha256;
        result.session.trace_policy_reason = tracePolicyReason;
        result.session.browser_version = browserVersion;
        traceIndex.push({
          trace_path: tracePath,
          trace_sha256,
          trace_session_id: result.session.session_id,
          trace_turn_ids: (result.turns || []).map((t) => t.turnRow?.turn_id).filter(Boolean),
          trace_policy_reason: tracePolicyReason,
          capability: row.capability,
          smoke_index: row.smoke_index,
        });
      } catch (err) {
        await context.tracing.stop({ path: tracePath }).catch(() => null);
        const trace_sha256 = hashTraceFile(tracePath);
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
            smoke_index: row.smoke_index,
            trace_path: fs.existsSync(tracePath) ? tracePath : null,
            trace_sha256,
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
    stopProductPcapCapture(opts.out);
  }

  fs.writeFileSync(
    path.join(tracesDir, 'trace-index.json'),
    JSON.stringify({ count: traceIndex.length, traces: traceIndex }, null, 2) + '\n',
  );

  const manifest = screenshotManifest.finalize();
  const pngValidation = validateAllProductScreenshots(manifest.rows || []);
  fs.writeFileSync(
    path.join(opts.out, 'screenshot-png-validation.json'),
    JSON.stringify(pngValidation, null, 2) + '\n',
  );

  let distinctness = { ok: true, unique_sha256: 0, rows: 0 };
  try {
    // Multi-turn sessions: screenshots within a session must not be byte-identical.
    const bySession = new Map();
    for (const row of manifest.rows || []) {
      const sid = row.session_id || row.session || 'unknown';
      if (!bySession.has(sid)) bySession.set(sid, []);
      bySession.get(sid).push({
        path: row.path || row.file_path || row.absolute_path,
        label: `${row.capability || 'cap'}:${row.state || row.capture_state || 'state'}:turn${row.turn_index ?? 0}`,
        turn_index: row.turn_index,
      });
    }
    for (const [, rows] of bySession) {
      if (rows.length < 2) continue;
      assertScreenshotDistinctness(rows.filter((r) => r.path), { maxExactDuplicates: 0 });
    }
    distinctness = assertScreenshotDistinctness(
      (manifest.rows || [])
        .filter((r) => r.path || r.file_path || r.absolute_path)
        .map((r) => ({
          path: r.path || r.file_path || r.absolute_path,
          label: r.filename || r.path,
          allow_duplicate: false,
        })),
      { maxExactDuplicates: 1 },
    );
  } catch (err) {
    distinctness = {
      ok: false,
      error: err.code || err.message,
      message: String(err.message || err),
    };
  }
  fs.writeFileSync(
    path.join(opts.out, 'screenshot-distinctness.json'),
    JSON.stringify(distinctness, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(opts.out, 'owner-proof-scenarios.json'),
    JSON.stringify(loadOwnerProofScenarios(), null, 2) + '\n',
  );

  const sheetsDir = path.join(opts.out, 'contact-sheets');
  generateContactSheets(manifest.rows || [], sheetsDir);
  writeRouteCapabilityMatrix(opts.out, results);

  const pass = results.filter((r) => r.session?.session_outcome === 'PASS').length;
  const fail = results.length - pass;
  const turns = results.reduce((n, r) => n + (r.session?.executed_turn_count || 0), 0);
  const frozenReady =
    pass === 64 &&
    fail === 0 &&
    turns === 112 &&
    gate.next_session_started_after_hard_failure === 0 &&
    pngValidation.pass &&
    distinctness.ok !== false &&
    traceIndex.length === 64;

  const summary = {
    kind: SMOKE_KIND,
    execution: 'LIVE',
    out: opts.out,
    head_sha: headSha,
    logical_sessions: results.length,
    logical_pass: pass,
    logical_fail: fail,
    turns,
    protocol_rows_expected: 336,
    screenshots: manifest.count,
    screenshot_png_validation: pngValidation.screenshots_validated,
    traces: traceIndex.length,
    gate: gate.snapshot(),
    freeze: frozenReady ? 'FROZEN_PASS_EVIDENCE' : 'FROZEN_BLOCKED_EVIDENCE',
    contact_sheets: sheetsDir,
    CONTRACT_SCREENSHOT_DATE: process.env.CONTRACT_SCREENSHOT_DATE,
    browser_tls_mode: proxy.tls_mode,
    ignoreHTTPSErrors: false,
    direct_chromium_client_cert_mtls: 'NOT_CONFIGURED',
    production: 'NOT APPROVED',
    phase33f_target: 'ABSENT',
    product_canary_root: 'ABSENT',
    product_gauntlet_root: 'ABSENT',
    smoke_v1_frozen_root: '/tmp/phase34-product-harness-live-smoke-v1',
    first_failure: results.find((r) => r.session?.session_outcome !== 'PASS')?.session || null,
  };
  // Write summary BEFORE freeze marker so FROZEN_* is last.
  fs.writeFileSync(path.join(opts.out, 'smoke-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  const frozen = summary.freeze;
  fs.writeFileSync(path.join(opts.out, frozen), `${new Date().toISOString()}\n`);
  console.log(JSON.stringify(summary, null, 2));
  if (frozen !== 'FROZEN_PASS_EVIDENCE') process.exit(1);
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message, code: err.code }, null, 2));
  process.exit(1);
});
