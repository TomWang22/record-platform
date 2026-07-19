#!/usr/bin/env node
/**
 * Phase 34 — SOURCE VERIFICATION (Stage 1 local).
 *
 * Real Chromium + strict TLS + authenticated seller + identical H1/H2/H3 bodies.
 * Scratch root only — NOT owner-proof evidence, NOT product acceptance.
 *
 * Forbidden roots (must remain absent):
 *   rehearsal-v2, smoke-v6, canary, gauntlet, mini-proof
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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

const SCRATCH =
  process.env.PHASE34_SOURCE_VERIFY_OUT ||
  '/tmp/phase34-owner-proof-source-verification-v1';

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

async function main() {
  assertForbiddenAbsent();
  if (fs.existsSync(SCRATCH)) {
    fs.rmSync(SCRATCH, { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(SCRATCH, 'screenshots'), { recursive: true });
  fs.mkdirSync(path.join(SCRATCH, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(SCRATCH, 'protocol'), { recursive: true });

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
  const sellerId = seller.user?.id || seller.user?.userId || seller.user?.uid || 'seller-contract';
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

  const session_id = `src-verify-${crypto.randomUUID()}`;
  const prior = [];
  const turnRows = [];
  const hashes = [];

  // Engine-local golden (always) — proves remediation before/alongside live edge.
  for (let i = 0; i < TURNS.length; i += 1) {
    const turn_id = `turn-${i + 1}`;
    const local = analyzeNegotiation({
      requesting_principal_fixture: sellerId,
      principal_id: sellerId,
      participant_side: 'seller',
      authorized_thread_id: 'thread-src-verify',
      asking_price: 41,
      force_negotiation_market_floor: true,
      subject: { listing_id: 'listing-src-verify', title: 'Quiet Kenny' },
      thread: {
        thread_id: 'thread-src-verify',
        participant_principals: [sellerId, 'buyer-1'],
      },
      messages: [
        {
          message_id: 'm1',
          thread_id: 'thread-src-verify',
          body: 'Would you take $35?',
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
    });
  }
  if (new Set(hashes).size !== 4) {
    const err = new Error('negotiation turns did not produce distinct material hashes');
    err.code = 'CORRECTION_NO_MATERIAL_CHANGE';
    throw err;
  }

  // Live H1/H2/H3 for turn 1 canonical body (identical across protocols).
  const liveBody = {
    capability: 'negotiation_assistance',
    production_mutation_allowed: false,
    requesting_principal_fixture: sellerId,
    principal_id: sellerId,
    participant_side: 'seller',
    authorized_thread_id: 'thread-src-verify-live',
    asking_price: 41,
    subject: { listing_id: 'listing-src-verify', title: 'Quiet Kenny' },
    thread: {
      thread_id: 'thread-src-verify-live',
      participant_principals: [sellerId, 'buyer-peer'],
    },
    messages: [
      {
        message_id: 'm1',
        thread_id: 'thread-src-verify-live',
        body: 'Would you take $35?',
        deletion_state: 'ACTIVE',
      },
    ],
    session_id,
    turn_id: 'turn-1',
    turn_index: 0,
    prior_turns: [],
    user_intent: TURNS[0],
    automatic_send_allowed: false,
  };

  const triplet = executeProtocolTriplet(
    {
      method: 'POST',
      endpoint: '/api/ai/intelligence/negotiation',
      body: liveBody,
    },
    {
      live: true,
      token: seller.token,
      userId: seller.userId,
      baseUrl: upstreamUrl,
      caCert,
      probeIdPrefix: `${session_id}_t1`,
    },
  );

  fs.writeFileSync(
    path.join(SCRATCH, 'protocol', 'negotiation-turn1-triplet.json'),
    JSON.stringify(triplet, null, 2) + '\n',
  );

  const protocolOk = triplet?.ok === true;

  // Playwright via mkcert TLS proxy → strict upstream (same pattern as preflight).
  const proxyPort = Number(process.env.PHASE34_BROWSER_PROXY_PORT || 28453);
  const proxy = await ensureMkcertProxy({ proxyPort, outRoot: SCRATCH, caCert });
  const browserBaseUrl = proxy.browserBaseUrl;
  const browser = await loadChromium().launch({ headless: true });
  const screenshotPaths = [];
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

    await page.goto(
      subjects.thread_id
        ? `${browserBaseUrl}/messages?thread=${subjects.thread_id}`
        : `${browserBaseUrl}/messages`,
      { waitUntil: 'domcontentloaded', timeout: 60_000 },
    );
    // Select first conversation thread when present so the negotiation panel can run.
    const threadLink = page
      .locator('a[href*="/messages"], [data-testid*="thread"], [data-testid*="conversation"]')
      .first();
    if (await threadLink.count()) {
      await threadLink.click().catch(() => null);
      await page.waitForTimeout(800);
    }
    let panel = page.getByTestId('intelligence-negotiation-panel');
    let panelVisible = await panel.isVisible().catch(() => false);
    if (!panelVisible) {
      await page.goto(`${browserBaseUrl}/offers/inbox`, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      panel = page.getByTestId('intelligence-negotiation-panel');
      panelVisible = await panel.isVisible().catch(() => false);
    }
    if (panelVisible) {
      for (let i = 0; i < TURNS.length; i += 1) {
        await page.getByTestId(`intelligence-negotiation-turn-preset-${i + 1}`).click();
        await page.getByTestId('intelligence-negotiation-run').click();
        await page
          .getByTestId('intelligence-negotiation-ready')
          .waitFor({ state: 'visible', timeout: 90_000 })
          .catch(() => null);
        const shot = path.join(SCRATCH, 'screenshots', `nego-turn-${i + 1}.png`);
        await page.screenshot({ path: shot, fullPage: true });
        screenshotPaths.push(shot);
        const draft = await page.getByTestId('intelligence-negotiation-draft').inputValue().catch(() => '');
        turnRows[i].browser_draft_len = draft.length;
        turnRows[i].browser_ok = draft.length > 10;
      }
    } else {
      const shot = path.join(SCRATCH, 'screenshots', 'messages-shell.png');
      await page.screenshot({ path: shot, fullPage: true });
      screenshotPaths.push(shot);
    }
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

  const contextTiers = evaluateNegotiationContextTiers({
    session_id,
    thread_id: 'thread-src-verify',
    participant_side: 'seller',
  });

  const summary = {
    label: 'PHASE34_SOURCE_VERIFICATION_ONLY',
    product_acceptance: false,
    owner_proof_evidence: false,
    scratch_root: SCRATCH,
    session_id,
    canonical_request_hash: hashCanonicalRequest(liveBody),
    negotiation_turns: turnRows,
    distinct_material_hashes: new Set(hashes).size,
    protocol_triplet_ok: Boolean(protocolOk),
    protocol_detail: {
      h1: triplet?.h1?.http_status ?? null,
      h2: triplet?.h2?.http_status ?? null,
      h3: triplet?.h3?.http_status ?? null,
      parity: triplet?.parity || null,
    },
    screenshots: screenshotPaths,
    browser_four_turn_ok: turnRows.every((t) => t.browser_ok === true),
    context_tiers: contextTiers,
    forbidden_roots_absent: true,
    status:
      new Set(hashes).size === 4 && Boolean(protocolOk)
        ? turnRows.every((t) => t.browser_ok === true)
          ? 'SOURCE_VERIFICATION_PASS'
          : 'SOURCE_VERIFICATION_PASS_ENGINE_AND_PROTOCOL'
        : 'SOURCE_VERIFICATION_PARTIAL',
  };

  fs.writeFileSync(
    path.join(SCRATCH, 'reports', 'source-verification-summary.json'),
    JSON.stringify(summary, null, 2) + '\n',
  );

  console.log(JSON.stringify(summary, null, 2));
  if (
    summary.status !== 'SOURCE_VERIFICATION_PASS' &&
    summary.status !== 'SOURCE_VERIFICATION_PASS_ENGINE_AND_PROTOCOL'
  ) {
    process.exit(2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err?.stack || err);
    process.exit(1);
  });
}
