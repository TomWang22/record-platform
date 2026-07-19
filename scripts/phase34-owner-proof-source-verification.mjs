#!/usr/bin/env node
/**
 * Phase 34 — OWNER-PROOF SOURCE VERIFICATION (committed, reproducible).
 *
 * Real Chromium + strict TLS + authenticated buyer/seller + authorized thread +
 * four-turn negotiation UI + synchronized H1/H2/H3 per turn.
 *
 * Diagnostic screenshots only — NOT owner-proof evidence, NOT product acceptance.
 * Does not launch live 24-scenario owner-proof recapture.
 *
 * Default output: .cache/phase34-owner-proof-source-verification (repo-local).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { loginContractUser, resolveLiveSubjects } from './lib/phase34-product-live-subjects.mjs';
import {
  executeProtocolTriplet,
  hashCanonicalRequest,
} from './lib/phase34-product-protocol-triplet.mjs';
import {
  loadChromium,
  caCertPath,
  ensureMkcertProxy,
  signInWithToken,
} from './lib/phase34-owner-proof-live-runner.mjs';
import { analyzeNegotiation } from './lib/phase33d-negotiation.mjs';
import { evaluateNegotiationContextTiers } from './lib/phase34-negotiation-context.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const OUT_ROOT =
  process.env.PHASE34_SOURCE_VERIFY_OUT ||
  path.join(REPO, '.cache/phase34-owner-proof-source-verification');

const FORBIDDEN = [
  '/tmp/phase34-owner-proof-live-rehearsal-v2',
  '/tmp/phase34-product-harness-live-smoke-v6',
  '/tmp/phase34-product-gauntlet-canary-v1',
  '/tmp/phase34-product-gauntlet-v1',
  '/tmp/phase33f-capability-gauntlet-target-v1',
  '/tmp/phase34-owner-proof-mini-proof-v1',
];

const TURNS = [
  'They offered $35 for my $41 listing. What should I do?',
  'The sleeve has a seam split, and shipping will cost me $6.',
  'I would accept $37, but I do not want to sound desperate.',
  'Draft the reply.',
];

const SELLER_EMAIL =
  process.env.E2E_SELLER_EMAIL || 'seller-contract@record-platform.local';
const SELLER_PASSWORD = process.env.E2E_SELLER_PASSWORD || 'ContractPass123!';
const BUYER_EMAIL =
  process.env.E2E_BUYER_EMAIL || 'buyer-contract@record-platform.local';
const BUYER_PASSWORD = process.env.E2E_BUYER_PASSWORD || 'ContractPass123!';

function assertForbiddenAbsent() {
  for (const p of FORBIDDEN) {
    if (fs.existsSync(p)) {
      const err = new Error(`FORBIDDEN_ROOT_PRESENT:${p}`);
      err.code = 'SOURCE_VERIFY_FORBIDDEN_ROOT';
      throw err;
    }
  }
}

function materialHash(result) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        strategy: result?.strategy,
        draft: result?.draft_reply || result?.reply_draft,
        facts: result?.structured_facts,
        summary: result?.summary,
      }),
    )
    .digest('hex');
}

function httpsJson({ baseUrl, token, method = 'GET', urlPath, body, caCert }) {
  const u = new URL(urlPath, baseUrl.replace(/\/$/, '') + '/');
  const ca = fs.readFileSync(caCert);
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'X-RP-E2E-Contract': '1',
          Accept: 'application/json',
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
        },
        ca,
        servername: u.hostname,
        rejectUnauthorized: true,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try {
            parsed = JSON.parse(raw || '{}');
          } catch {
            parsed = { _raw: raw.slice(0, 400) };
          }
          resolve({ status: res.statusCode || 0, body: parsed, raw });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function userIdFromLogin(login) {
  return (
    login.userId ||
    login.user?.id ||
    login.user?.userId ||
    login.user?.uid ||
    null
  );
}

/**
 * Ensure a real authorized listing thread exists: buyer → seller listing with an offer.
 */
async function ensureAuthorizedNegotiationThread({
  baseUrl,
  caCert,
  buyer,
  seller,
  listingId,
}) {
  const sellerId = userIdFromLogin(seller);
  const offerBody = `Would you take $35 for this Quiet Kenny listing? (source-verify ${Date.now()})`;
  const start = await httpsJson({
    baseUrl,
    token: buyer.token,
    caCert,
    method: 'POST',
    urlPath: '/api/messages/start',
    body: listingId
      ? { listing_id: listingId, initial_message: offerBody }
      : { recipient_id: sellerId, initial_message: offerBody },
  });
  if (start.status >= 400) {
    const err = new Error(
      `AUTHORIZED_THREAD_CREATE_FAILED:${start.status}:${JSON.stringify(start.body).slice(0, 300)}`,
    );
    err.code = 'AUTHORIZED_THREAD_MISSING';
    throw err;
  }
  const threadId =
    start.body.thread_id ||
    start.body.threadId ||
    start.body.conversation_id ||
    start.body.conversationId ||
    null;
  if (!threadId) {
    const err = new Error('AUTHORIZED_THREAD_ID_MISSING');
    err.code = 'AUTHORIZED_THREAD_MISSING';
    throw err;
  }
  return {
    thread_id: String(threadId),
    listing_id: listingId || start.body.listing_id || start.body.listingId || null,
    offer_body: offerBody,
  };
}

function emptyLatency() {
  return {
    dns_us: null,
    tcp_us: null,
    tls_us: null,
    quic_us: null,
    ttfb_us: null,
    gateway_queue_us: null,
    service_queue_us: null,
    authorization_us: null,
    evidence_load_us: null,
    evidence_assembly_us: null,
    analytics_us: null,
    embedding_us: null,
    retrieval_us: null,
    reranker_us: null,
    tool_us: null,
    model_queue_us: null,
    model_ttft_us: null,
    model_generation_us: null,
    schema_validation_us: null,
    safety_validation_us: null,
    privacy_validation_us: null,
    response_transfer_us: null,
    browser_render_us: null,
    terminal_ready_us: null,
    total_wall_us: null,
    known_component_sum_us: null,
    unattributed_us: null,
    measurement_status: 'PARTIAL_INSTRUMENTED',
  };
}

async function main() {
  assertForbiddenAbsent();
  if (fs.existsSync(OUT_ROOT)) {
    fs.rmSync(OUT_ROOT, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(OUT_ROOT, 'screenshots'), { recursive: true });
  fs.mkdirSync(path.join(OUT_ROOT, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(OUT_ROOT, 'protocol'), { recursive: true });
  fs.mkdirSync(path.join(OUT_ROOT, 'transcript'), { recursive: true });

  const upstreamUrl = process.env.E2E_UPSTREAM_URL || 'https://record-platform.test';
  const caCert = caCertPath();
  process.env.NODE_EXTRA_CA_CERTS = process.env.NODE_EXTRA_CA_CERTS || caCert;
  process.env.CA_CERT = caCert;
  process.env.BASE_URL = upstreamUrl;

  const seller = await loginContractUser({
    baseUrl: upstreamUrl,
    email: SELLER_EMAIL,
    password: SELLER_PASSWORD,
    caCert,
  });
  const buyer = await loginContractUser({
    baseUrl: upstreamUrl,
    email: BUYER_EMAIL,
    password: BUYER_PASSWORD,
    caCert,
  });
  const sellerId = userIdFromLogin(seller) || 'seller-contract';
  const buyerId = userIdFromLogin(buyer) || 'buyer-contract';

  let subjects = {};
  try {
    subjects = await resolveLiveSubjects({
      baseUrl: upstreamUrl,
      token: seller.token,
      caCert,
    });
  } catch {
    subjects = {};
  }

  const authorized = await ensureAuthorizedNegotiationThread({
    baseUrl: upstreamUrl,
    caCert,
    buyer,
    seller,
    listingId: subjects.listing_id || null,
  });

  const session_id = `src-verify-${crypto.randomUUID()}`;
  const prior = [];
  const turnRows = [];
  const hashes = [];
  const transcript = {
    session_id,
    thread_id: authorized.thread_id,
    participant_side: 'seller',
    turns: [],
  };

  // Engine-local golden (always) — proves remediation before/alongside live edge.
  for (let i = 0; i < TURNS.length; i += 1) {
    const turn_id = `turn-${i + 1}`;
    const local = analyzeNegotiation({
      requesting_principal_fixture: sellerId,
      principal_id: sellerId,
      participant_side: 'seller',
      authorized_thread_id: authorized.thread_id,
      asking_price: 41,
      force_negotiation_market_floor: true,
      subject: {
        listing_id: authorized.listing_id || 'listing-src-verify',
        title: 'Quiet Kenny',
      },
      thread: {
        thread_id: authorized.thread_id,
        participant_principals: [sellerId, buyerId],
      },
      messages: [
        {
          message_id: 'm1',
          thread_id: authorized.thread_id,
          body: authorized.offer_body,
          deletion_state: 'ACTIVE',
        },
      ],
      session_id,
      turn_id,
      turn_index: i,
      prior_turns: prior,
      user_intent: TURNS[i],
      automatic_send_allowed: false,
    });
    const draft = String(local.result.draft_reply || '');
    if (draft.length < 20) {
      const err = new Error(`EMPTY_DRAFT_TURN_${i + 1}`);
      err.code = 'NEGOTIATION_DRAFT_EMPTY';
      throw err;
    }
    hashes.push(materialHash(local.result));
    prior.push({
      turn_index: i,
      turn_id,
      intent: TURNS[i],
      summary: local.result.summary,
    });
    turnRows.push({
      turn_index: i,
      turn_id,
      intent: TURNS[i],
      strategy: local.result.strategy,
      draft_len: draft.length,
      facts: local.result.structured_facts,
      local_ok: true,
      engine_result_hash: materialHash(local.result),
    });
  }
  if (new Set(hashes).size !== 4) {
    const err = new Error('negotiation turns did not produce distinct material hashes');
    err.code = 'CORRECTION_NO_MATERIAL_CHANGE';
    throw err;
  }

  // Playwright via mkcert TLS proxy → strict upstream.
  const proxyPort = Number(process.env.PHASE34_BROWSER_PROXY_PORT || 28453);
  const proxy = await ensureMkcertProxy({ proxyPort, outRoot: OUT_ROOT, caCert });
  const browserBaseUrl = proxy.browserBaseUrl;
  const browser = await loadChromium().launch({ headless: true });
  const screenshotPaths = [];
  let browserFourTurnOk = false;
  const protocolTurns = [];

  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: false,
      baseURL: browserBaseUrl,
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await signInWithToken(page, browserBaseUrl, {
      token: seller.token,
      email: SELLER_EMAIL,
      name: 'Seller Contract',
      initials: 'SC',
    });

    const capturedBodies = [];
    // Inject authorized sold comps for golden four-turn source verification.
    // market_candidates is a declared IntelligenceBody field (unlike some turn flags).
    await page.route('**/api/ai/intelligence/negotiation', async (route) => {
      const req = route.request();
      if (req.method() !== 'POST') {
        await route.continue();
        return;
      }
      let body = {};
      try {
        body = JSON.parse(req.postData() || '{}');
      } catch {
        body = {};
      }
      body.force_negotiation_market_floor = true;
      body.participant_side = 'seller';
      const asking = typeof body.asking_price === 'number' && body.asking_price > 0 ? body.asking_price : 41;
      if (!Array.isArray(body.market_candidates) || body.market_candidates.length === 0) {
        body.market_candidates = [0.92, 0.98, 1.05].map((mul, i) => ({
          evidence_id: `nego-sold-comp-${i + 1}`,
          source_type: 'sale',
          sale_kind: 'sold',
          price: Math.round(asking * mul * 100) / 100,
          currency: 'USD',
          freshness_status: 'fresh',
          observed_at: '2026-06-01T12:00:00.000Z',
          reason_codes: ['EXACT_PRESSING_MATCH', 'AUTHORIZED_MARKET'],
          authorization_scope: 'authenticated_market',
        }));
      }
      // Mirror intent into declared nested objects so it survives older IntelligenceBody filters.
      if (body.user_intent) {
        body.thread = { ...(body.thread || {}), latest_user_intent: body.user_intent };
        body.subject = { ...(body.subject || {}), user_intent: body.user_intent };
      }
      if (Array.isArray(body.prior_turns) && body.prior_turns.length) {
        body.thread = { ...(body.thread || {}), prior_turns: body.prior_turns };
      }
      const postData = JSON.stringify(body);
      capturedBodies.push(body);
      await route.continue({
        method: 'POST',
        headers: {
          ...req.headers(),
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(postData)),
        },
        postData,
      });
    });

    page.on('request', (req) => {
      void req;
    });

    await page.goto(`${browserBaseUrl}/messages?thread=${encodeURIComponent(authorized.thread_id)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 90_000,
    });

    // Wait for thread detail + negotiation panel (requires authorized thread).
    await page
      .getByTestId('intelligence-negotiation-panel')
      .waitFor({ state: 'visible', timeout: 90_000 })
      .catch(() => null);

    let panel = page.getByTestId('intelligence-negotiation-panel');
    let panelVisible = await panel.isVisible().catch(() => false);
    if (!panelVisible) {
      // Fallback: open inbox and click first thread row.
      await page.goto(`${browserBaseUrl}/messages`, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      const row = page.getByTestId('messages-inbox-item').first();
      if (await row.count()) {
        await row.click();
        await page.waitForTimeout(1200);
      }
      panel = page.getByTestId('intelligence-negotiation-panel');
      panelVisible = await panel.isVisible().catch(() => false);
    }

    if (!panelVisible) {
      const shot = path.join(OUT_ROOT, 'screenshots', 'messages-shell-no-panel.png');
      await page.screenshot({ path: shot, fullPage: true });
      screenshotPaths.push(shot);
      const err = new Error(
        `NEGOTIATION_PANEL_NOT_VISIBLE thread=${authorized.thread_id}`,
      );
      err.code = 'BROWSER_FOUR_TURN_INCOMPLETE';
      throw err;
    }

    for (let i = 0; i < TURNS.length; i += 1) {
      const turnStarted = Date.now();
      const beforeBodies = capturedBodies.length;

      await page.getByTestId(`intelligence-negotiation-turn-preset-${i + 1}`).click();
      await page.getByTestId('intelligence-negotiation-run').click();

      await page
        .getByTestId('intelligence-negotiation-ready')
        .waitFor({ state: 'visible', timeout: 120_000 });

      const draft = await page
        .getByTestId('intelligence-negotiation-draft')
        .inputValue()
        .catch(() => '');
      const summaryText = await page
        .getByTestId('intelligence-negotiation-summary')
        .innerText()
        .catch(() => '');
      const strategyText = await page
        .getByTestId('intelligence-negotiation-strategy')
        .innerText()
        .catch(() => '');
      const rangeText = await page
        .getByTestId('intelligence-negotiation-range')
        .innerText()
        .catch(() => '');

      if (draft.length < 10) {
        const err = new Error(`EMPTY_BROWSER_DRAFT_TURN_${i + 1}`);
        err.code = 'NEGOTIATION_DRAFT_EMPTY';
        throw err;
      }

      // Wait briefly for request capture.
      const deadline = Date.now() + 5000;
      while (capturedBodies.length <= beforeBodies && Date.now() < deadline) {
        await page.waitForTimeout(100);
      }
      const body = capturedBodies[capturedBodies.length - 1];
      if (!body) {
        const err = new Error(`CANONICAL_REQUEST_BODY_MISSING_TURN_${i + 1}`);
        err.code = 'H123_REQUEST_BODY_MISSING';
        throw err;
      }

      const canonical_request_hash = hashCanonicalRequest(body);
      const triplet = executeProtocolTriplet(
        {
          method: 'POST',
          endpoint: '/api/ai/intelligence/negotiation',
          body,
        },
        {
          live: true,
          token: seller.token,
          userId: seller.userId || sellerId,
          baseUrl: upstreamUrl,
          caCert,
          probeIdPrefix: `${session_id}_t${i + 1}`,
        },
      );

      fs.writeFileSync(
        path.join(OUT_ROOT, 'protocol', `negotiation-turn${i + 1}-triplet.json`),
        JSON.stringify(triplet, null, 2) + '\n',
      );

      if (triplet?.ok !== true) {
        const err = new Error(`PROTOCOL_TRIPLET_FAIL_TURN_${i + 1}`);
        err.code = 'H123_MATERIAL_MISMATCH';
        throw err;
      }

      const shot = path.join(OUT_ROOT, 'screenshots', `nego-turn-${i + 1}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      screenshotPaths.push(shot);

      const wall_us = (Date.now() - turnStarted) * 1000;
      const latency = { ...emptyLatency(), total_wall_us: wall_us };

      const turnRecord = {
        session_id,
        thread_id: authorized.thread_id,
        turn_id: body.turn_id || `turn-${i + 1}`,
        turn_index: i,
        executed_turn_count: i + 1,
        participant_side: body.participant_side || 'seller',
        visible_user_message: TURNS[i],
        canonical_request_hash,
        protocol: {
          h1: triplet?.h1?.http_status ?? null,
          h2: triplet?.h2?.http_status ?? null,
          h3: triplet?.h3?.http_status ?? null,
          parity: triplet?.parity || null,
          ok: true,
        },
        browser: {
          draft_len: draft.length,
          summary: summaryText,
          strategy: strategyText,
          range: rangeText,
          screenshot: path.relative(OUT_ROOT, shot),
          ready: true,
        },
        facts_added: body.user_intent || TURNS[i],
        prior_turns_count: Array.isArray(body.prior_turns) ? body.prior_turns.length : 0,
        input_token_estimate: null,
        output_token_count: null,
        context_budget: null,
        context_used: null,
        latency,
        measurement_status: 'PARTIAL_INSTRUMENTED',
      };

      protocolTurns.push(turnRecord);
      transcript.turns.push(turnRecord);
      turnRows[i].browser_draft_len = draft.length;
      turnRows[i].browser_ok = true;
      turnRows[i].canonical_request_hash = canonical_request_hash;
      turnRows[i].protocol_ok = true;
      turnRows[i].participant_side = body.participant_side;
    }

    browserFourTurnOk = turnRows.every((t) => t.browser_ok === true);
    await context.close();
  } finally {
    await browser.close();
    if (proxy?.child) {
      try {
        proxy.child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
  }

  if (!browserFourTurnOk || protocolTurns.length !== 4) {
    const err = new Error('BROWSER_FOUR_TURN_INCOMPLETE');
    err.code = 'BROWSER_FOUR_TURN_INCOMPLETE';
    throw err;
  }

  const contextTiers = evaluateNegotiationContextTiers({
    session_id,
    thread_id: authorized.thread_id,
    participant_side: 'seller',
  });

  fs.writeFileSync(
    path.join(OUT_ROOT, 'transcript', 'four-turn-browser-h123-transcript.json'),
    JSON.stringify(transcript, null, 2) + '\n',
  );

  const summary = {
    label: 'PHASE34_SOURCE_VERIFICATION_COMMITTED',
    product_acceptance: false,
    owner_proof_evidence: false,
    live_24_scenario_launched: false,
    out_root: OUT_ROOT,
    session_id,
    authorized_thread_id: authorized.thread_id,
    canonical_request_hashes: protocolTurns.map((t) => t.canonical_request_hash),
    negotiation_turns: turnRows,
    distinct_material_hashes: new Set(hashes).size,
    protocol_triplet_ok: protocolTurns.every((t) => t.protocol.ok === true),
    protocol_turns: protocolTurns.map((t) => ({
      turn_index: t.turn_index,
      h1: t.protocol.h1,
      h2: t.protocol.h2,
      h3: t.protocol.h3,
      parity: t.protocol.parity,
      canonical_request_hash: t.canonical_request_hash,
    })),
    screenshots: screenshotPaths,
    browser_four_turn_ok: true,
    context_tiers: contextTiers,
    forbidden_roots_absent: true,
    transcript_path: 'transcript/four-turn-browser-h123-transcript.json',
    status: 'SOURCE_VERIFICATION_PASS',
  };

  fs.writeFileSync(
    path.join(OUT_ROOT, 'reports', 'source-verification-summary.json'),
    JSON.stringify(summary, null, 2) + '\n',
  );

  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err?.stack || err);
    process.exit(1);
  });
}

export { ensureAuthorizedNegotiationThread, TURNS };
