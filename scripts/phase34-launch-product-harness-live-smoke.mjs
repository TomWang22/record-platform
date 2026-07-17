#!/usr/bin/env node
/**
 * Phase 34 — 32-session LIVE product-harness smoke.
 *
 * Root: /tmp/phase34-product-harness-live-smoke-v1
 *
 * Requires:
 *   - committed HEAD == origin/main
 *   - exact-SHA CI approval
 *   - PHASE34_PRODUCT_SMOKE_APPROVED_SHA=<head>
 *   - live stack (Next.js + gateway + python-ai) + Chromium
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

function parseArgs(argv) {
  const opts = {
    out: PRODUCT_LIVE_SMOKE_ROOT,
    execute: false,
    upstreamUrl: process.env.E2E_UPSTREAM_URL || 'https://record-platform.test',
    headless: true,
    proxyPort: Number(process.env.PHASE34_BROWSER_PROXY_PORT || 8443),
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
 * Build the exact 32-session smoke schedule from the interleaved canary pool.
 * 4 per capability; 1 multi-turn per capability; viewport mix 16/8/8.
 */
export function buildLiveSmokeSchedule(seed = 'phase34-product-live-smoke-v1') {
  const full = buildInterleavedProductSchedule({ scale: 'canary', seed });
  const selected = [];
  const multiTaken = new Set();
  for (const cap of PRODUCT_CAPABILITIES) {
    const rows = full.rows.filter((r) => r.capability === cap);
    const multi = rows.find((r) => r.multi_turn_class === 'multi_4_12');
    const singles = rows.filter((r) => r.multi_turn_class === 'single');
    if (multi) {
      selected.push({ ...multi, multi_turn_class: 'multi_4_12', smoke_turns: 4 });
      multiTaken.add(cap);
    }
    while (selected.filter((r) => r.capability === cap).length < 4) {
      const next = singles.shift();
      if (!next) break;
      selected.push({ ...next, multi_turn_class: 'single', smoke_turns: 1 });
    }
  }
  selected.forEach((row, i) => {
    row.smoke_viewport = i < 16 ? 'desktop' : i < 24 ? 'tablet' : 'mobile';
    row.smoke_index = i;
  });
  if (selected.length !== 32) {
    const err = new Error(`smoke schedule size ${selected.length} != 32`);
    err.code = 'PHASE34_PRODUCT_SMOKE_SCHEDULE_INVALID';
    throw err;
  }
  if (multiTaken.size !== 8) {
    const err = new Error('need one multi-turn session per capability');
    err.code = 'PHASE34_PRODUCT_SMOKE_MULTITURN_INVALID';
    throw err;
  }
  return {
    seed,
    logical_sessions: 32,
    multi_turn_sessions: 8,
    turns_expected: 24 * 1 + 8 * 4,
    protocol_rows_expected: (24 * 1 + 8 * 4) * 3,
    rows: selected,
  };
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
        canarySessions: 32,
        multiTurnSessions: 8,
        avgMultiTurns: 4,
        statesPerCanaryTurn: 3,
      }),
      null,
      2,
    ) + '\n',
  );

  if (!opts.execute) {
    console.log(
      JSON.stringify(
        {
          kind: 'PRODUCT_HARNESS_LIVE_SMOKE',
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

  const proxy = await ensureMkcertProxy({
    proxyPort: opts.proxyPort,
    outRoot: opts.out,
    caCert,
  });

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
        // hashed presence only — no raw UUIDs in this summary for privacy-safe logs
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

  const browser = await loadChromium().launch({
    headless: opts.headless,
    ignoreHTTPSErrors: false,
  });

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
      const shouldTrace =
        row.multi_turn_class === 'multi_4_12' ||
        row.smoke_index % 4 === 0 ||
        PLAYWRIGHT_TRACE_POLICY.retain_on.includes('multi_turn_boundary');
      if (shouldTrace) {
        await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
      }

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
          screenshotPack: 'smoke',
          turnCount: row.smoke_turns,
          subject: subjectForCapability(subjects, row.capability),
          protocolBaseUrl: opts.upstreamUrl,
          baseUrl: opts.upstreamUrl,
          caCert,
          protocolToken: auth.token,
          token: auth.token,
          runtimeImagePin: process.env.PHASE34_RUNTIME_IMAGE_DIGEST || null,
          certificatePin: process.env.PHASE34_CERT_FINGERPRINT || null,
        });
        if (result.session.pin_source === PIN_SOURCE.FIXTURE_SYNTHETIC_PIN) {
          assertLivePinsNotSynthetic(result.session.config_pins);
        }
        results.push(result);
        if (shouldTrace) {
          await context.tracing.stop({ path: tracePath });
          result.session.trace_path = tracePath;
        }
      } catch (err) {
        if (shouldTrace) {
          await context.tracing.stop({ path: tracePath }).catch(() => null);
        }
        gate.noteSessionResult({
          browser_journey_status: 'FAIL',
          ui_api_reconciliation_status: 'FAIL',
          protocol_status: 'FAIL',
        });
        results.push({
          session: {
            session_outcome: 'FAIL',
            error: String(err.message || err),
            code: err.code || null,
            capability: row.capability,
            smoke_index: row.smoke_index,
          },
        });
        break;
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    try {
      proxy.child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }

  const manifest = screenshotManifest.finalize();
  const sheetsDir = path.join(opts.out, 'contact-sheets');
  generateContactSheets(manifest.rows || [], sheetsDir);

  const pass = results.filter((r) => r.session?.session_outcome === 'PASS').length;
  const fail = results.length - pass;
  const frozen =
    pass === 32 && fail === 0 && gate.next_session_started_after_hard_failure === 0
      ? 'FROZEN_PASS_EVIDENCE'
      : 'FROZEN_BLOCKED_EVIDENCE';
  fs.writeFileSync(path.join(opts.out, frozen), `${new Date().toISOString()}\n`);

  const summary = {
    kind: 'PRODUCT_HARNESS_LIVE_SMOKE',
    execution: 'LIVE',
    out: opts.out,
    head_sha: headSha,
    logical_sessions: results.length,
    logical_pass: pass,
    logical_fail: fail,
    turns: results.reduce((n, r) => n + (r.session?.executed_turn_count || 0), 0),
    screenshots: manifest.count,
    gate: gate.snapshot(),
    freeze: frozen,
    contact_sheets: sheetsDir,
    CONTRACT_SCREENSHOT_DATE: process.env.CONTRACT_SCREENSHOT_DATE,
    browser_tls_mode: proxy.tls_mode,
    ignoreHTTPSErrors: false,
    production: 'NOT APPROVED',
    phase33f_target: 'ABSENT',
    product_canary_root: 'ABSENT',
    product_gauntlet_root: 'ABSENT',
    first_failure: results.find((r) => r.session?.session_outcome !== 'PASS')?.session || null,
  };
  fs.writeFileSync(path.join(opts.out, 'smoke-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
  if (frozen !== 'FROZEN_PASS_EVIDENCE') process.exit(1);
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message, code: err.code }, null, 2));
  process.exit(1);
});
