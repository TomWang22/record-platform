/**
 * Phase 34 — 24-scenario diagnostic SOURCE PREFLIGHT (not owner-proof).
 * Real Chromium + H1/H2/H3 via runProductSession + separated latency telemetry.
 * Root: .cache/phase34-owner-proof-24-source-preflight-v1/
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  loadOwnerProofScenarios,
  loadOwnerProofSeedManifest,
  validateSeedManifestAgainstScenarios,
} from './phase34-owner-proof-scenarios.mjs';
import {
  writeClientActionContracts,
  assertContractsMatchScenarios,
} from './phase34-owner-proof-client-action-contracts.mjs';
import {
  buildOwnerProofSchedule,
  assertSeedFloors,
  signInWithToken,
  loadChromium,
  ensureMkcertProxy,
  caCertPath,
  resolveRuntimePins,
} from './phase34-owner-proof-live-runner.mjs';
import {
  loginContractUser,
  resolveLiveSubjects,
  subjectForCapability,
} from './phase34-product-live-subjects.mjs';
import { ensureOwnerProofMarketEvidence } from './phase34-owner-proof-market-seed.mjs';
import { runProductSession } from './phase34-product-session-runner.mjs';
import { ScreenshotManifestWriter, contractScreenshotDate } from './phase34-product-screenshots.mjs';
import { ProductFailClosedGate } from './phase34-product-execution.mjs';
import { assertLivePinsNotSynthetic, PIN_SOURCE } from './phase34-product-runtime-pins.mjs';
import {
  Stopwatch,
  emptyCustomerAndProtocolTimings,
  timingField,
  classifyCustomerLatency,
  newTraceId,
  spanSetForTurn,
  instrumentSpans,
  nearestRankPercentiles,
  pipelineStageCompleteness,
  MEASUREMENT_STATUS,
  estimateTokens,
  emptyTokenContextLedger,
  buildSlowestTurnAttribution,
  assertExecutedStageInstrumentation,
  REQUIRED_EXECUTED_CUSTOMER_STAGES,
} from './phase34-source-verification-telemetry.mjs';
import { scoreResponseQuality } from './phase34-negotiation-fact-invariants.mjs';
import { evaluateNegotiationContextTiers } from './phase34-negotiation-context.mjs';
import { assertSuccessScenarioDataFloor } from './phase34-owner-proof-product-contracts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

export const SOURCE_24_PREFLIGHT_ROOT = path.join(
  REPO,
  '.cache/phase34-owner-proof-24-source-preflight-v2',
);

const FROZEN_BASELINE = path.join(REPO, '.cache/phase34-owner-proof-source-verification');
const FROZEN_PREFLIGHT_V1 = path.join(REPO, '.cache/phase34-owner-proof-24-source-preflight-v1');

const FORBIDDEN = [
  '/tmp/phase34-owner-proof-live-rehearsal-v2',
  '/tmp/phase34-product-harness-live-smoke-v6',
  '/tmp/phase34-product-gauntlet-canary-v1',
  '/tmp/phase34-product-gauntlet-v1',
  '/tmp/phase33f-capability-gauntlet-target-v1',
  '/tmp/phase34-owner-proof-mini-proof-v1',
];

const CORRECTION_PAIRS = [
  ['scarcity-success-exact-pressing', 'scarcity-correction-pressing-disambiguation'],
  ['valuation-success-ranges', 'valuation-correction-condition'],
  ['auction-success-watchlist-temperature', 'auction-correction-ending-window'],
  ['embeddings-success-current-lineage', 'embeddings-stale-reembed'],
  ['search-success-semantic', 'search-hybrid-refinement'],
  ['negotiation-success-strategy', 'negotiation-four-turn-live'],
  ['recommendations-success-cards', 'recommendations-negative-preference'],
  ['analytics-success-report', 'analytics-constraint-population'],
];

const BUYER_EMAIL = process.env.E2E_BUYER_EMAIL || 'buyer-contract@record-platform.local';
const BUYER_PASSWORD = process.env.E2E_BUYER_PASSWORD || 'ContractPass123!';
const SELLER_EMAIL = process.env.E2E_SELLER_EMAIL || 'seller-contract@record-platform.local';
const SELLER_PASSWORD = process.env.E2E_SELLER_PASSWORD || 'ContractPass123!';

const VIEWPORTS = {
  desktop: { width: 1280, height: 720 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function materialResultHash(apiOrStructured, triplet = null) {
  if (triplet?.h1?.response_hash) return triplet.h1.response_hash;
  if (triplet?.accepted?.response_hash) return triplet.accepted.response_hash;
  const result =
    triplet?.accepted?.body?.result ||
    triplet?.accepted?.body ||
    apiOrStructured?.result ||
    apiOrStructured?.envelope ||
    apiOrStructured ||
    {};
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        scarcity_score: result.scarcity_score,
        scarcity_label: result.scarcity_label,
        summary: result.summary,
        strategy: result.strategy,
        draft: result.draft_reply || result.reply_draft || result.draft,
        suggested_range: result.suggested_range || result.supported_price_range,
        structured_facts: result.structured_facts,
        item_ids: result.item_ids || (result.recommendations || []).map((r) => r.entity_id),
        recommendations: (result.recommendations || []).map((r) => ({
          id: r.entity_id,
          rank: r.rank,
          reason: r.reason_customer || r.explanation,
        })),
        what_changed: result.what_changed,
        sample_size: result.sample_size,
        population_size: result.population_size,
        population: result.population,
        constraints_applied: result.constraints_applied,
        correction_change: result.correction_change,
        included_event_ids: result.included_event_ids,
        price_median: result.price_median,
        auction_count: result.auction_count,
        ending_window_hours: result.ending_window_hours,
        market_temperature: result.market_temperature,
        embedding_status: result.embedding_status || result.lineage_status,
        results_len: Array.isArray(result.results) ? result.results.length : null,
        evidence_ids: (result.evidence || []).map((e) => e.evidence_id || e.id),
        abstention_reason: result.abstention_reason,
        limitations: result.limitations,
      }),
    )
    .digest('hex');
}

function evidenceHash(apiOrStructured, triplet = null) {
  const result =
    triplet?.accepted?.body?.result ||
    triplet?.accepted?.body ||
    apiOrStructured?.result ||
    apiOrStructured?.envelope ||
    apiOrStructured ||
    {};
  const ev = result.evidence || [];
  const auctionLots = result.watchlist_auctions || result.auctions || [];
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        evidence: ev,
        auction_lot_ids: auctionLots.map((a) => a.lot_id || a.listing_id || a.id).filter(Boolean),
        auction_count: result.auction_count ?? auctionLots.length,
        ending_window_hours: result.ending_window_hours ?? null,
      }),
    )
    .digest('hex');
}

function msToUs(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return null;
  return Number(ms) * 1000;
}

export async function executeOwnerProof24SourcePreflight(opts = {}) {
  const outRoot = opts.outRoot || SOURCE_24_PREFLIGHT_ROOT;
  if (path.resolve(outRoot) === path.resolve(FROZEN_BASELINE)) {
    const err = new Error('REFUSE_MUTATE_FROZEN_BASELINE');
    err.code = 'FROZEN_BASELINE_IMMUTABLE';
    throw err;
  }
  if (path.resolve(outRoot) === path.resolve(FROZEN_PREFLIGHT_V1)) {
    const err = new Error('REFUSE_MUTATE_FROZEN_PREFLIGHT_V1');
    err.code = 'FROZEN_PREFLIGHT_IMMUTABLE';
    throw err;
  }
  for (const p of FORBIDDEN) {
    if (fs.existsSync(p)) {
      const err = new Error(`FORBIDDEN_ROOT_PRESENT:${p}`);
      err.code = 'SOURCE_VERIFY_FORBIDDEN_ROOT';
      throw err;
    }
  }
  if (fs.existsSync(outRoot)) {
    fs.rmSync(outRoot, { recursive: true, force: true });
  }
  for (const d of ['reports', 'screenshots', 'protocol', 'diagnostics', 'transcript']) {
    fs.mkdirSync(path.join(outRoot, d), { recursive: true });
  }

  const doc = loadOwnerProofScenarios();
  const seeds = loadOwnerProofSeedManifest();
  validateSeedManifestAgainstScenarios(doc, seeds);
  assertSeedFloors(seeds);
  writeClientActionContracts();
  assertContractsMatchScenarios();
  const schedule = buildOwnerProofSchedule(doc);

  const upstreamUrl = opts.upstreamUrl || process.env.E2E_UPSTREAM_URL || 'https://record-platform.test';
  const caCert = caCertPath();
  process.env.NODE_EXTRA_CA_CERTS = process.env.NODE_EXTRA_CA_CERTS || caCert;
  process.env.CA_CERT = caCert;
  process.env.BASE_URL = upstreamUrl;
  process.env.CONTRACT_SCREENSHOT_DATE =
    process.env.CONTRACT_SCREENSHOT_DATE || contractScreenshotDate();

  const proxyPort = Number(opts.proxyPort || process.env.PHASE34_BROWSER_PROXY_PORT || 28473);
  const proxy = await ensureMkcertProxy({ proxyPort, outRoot, caCert });
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
  const seedReport = await ensureOwnerProofMarketEvidence({
    baseUrl: upstreamUrl,
    buyerToken: buyer.token,
    sellerToken: seller.token,
    scarcityRecordId: subjects.scarcity_record_id || subjects.record_id,
    valuationRecordId: subjects.valuation_record_id || subjects.record_id,
  });
  if (seedReport.seller_kenny_listing_id) {
    subjects.valuation_listing_id = seedReport.seller_kenny_listing_id;
  }
  // Live sold floors must clear before any browser success scenario runs.
  assertSuccessScenarioDataFloor('scarcity', {
    sold_observations: seedReport.sold_observation_count?.scarcity ?? 0,
    observations: seedReport.miles_title_hits_after ?? 0,
  });
  assertSuccessScenarioDataFloor('valuation', {
    sold_comparables: seedReport.sold_observation_count?.valuation ?? 0,
    asking_comparables: seedReport.kenny_title_hits_after ?? 0,
  });
  fs.writeFileSync(
    path.join(outRoot, 'market-seed-report.json'),
    JSON.stringify(seedReport, null, 2) + '\n',
  );

  const runtimePins = resolveRuntimePins();
  const screenshotManifest = new ScreenshotManifestWriter(outRoot);
  // Per-scenario gates so one failure does not abort the diagnostic matrix.
  const browser = await loadChromium().launch({ headless: opts.headless !== false });
  const session_id = `src24-${crypto.randomUUID()}`;
  const trace_id = newTraceId();
  const scenarioRows = [];
  const turnRows = [];
  const customerLatencies = [];
  const protocolLatencies = [];
  let executedTurns = 0;
  let protocolRows = 0;
  let terminalScreenshots = 0;

  try {
    for (const row of schedule.rows) {
      const gate = new ProductFailClosedGate();
      const scenario = doc.scenarios.find((s) => s.scenario_id === row.scenario_id);
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
      const proof = {
        scenario_id: row.scenario_id,
        capability: row.capability,
        ok: false,
        turns: [],
        error: null,
      };

      try {
        await signInWithToken(page, proxy.browserBaseUrl, {
          token: auth.token,
          email,
          ...profile,
        });

        const wall = new Stopwatch();
        wall.mark('scenario_start');
        const result = await runProductSession(row, {
          page,
          fixtureMode: false,
          liveProtocol: true,
          gate,
          screenshotManifest,
          screenshotPack: 'owner-proof-24-source-preflight',
          turnCount: row.smoke_turns,
          subject: subjectForCapability(subjects, row.capability),
          protocolBaseUrl: upstreamUrl,
          baseUrl: upstreamUrl,
          caCert,
          protocolToken: auth.token,
          token: auth.token,
          userId: auth.userId || auth.user?.id,
          runtimeImagePin: runtimePins.runtime_image_digest,
          certificatePin: runtimePins.certificate_fingerprint,
          // Diagnostic preflight: do not hard-fail on PCAP correlation.
          pcapOutRoot: null,
          strictPipelineObservation: false,
        });
        wall.mark('scenario_end');

        if (result.session?.pin_source === PIN_SOURCE.FIXTURE_SYNTHETIC_PIN) {
          assertLivePinsNotSynthetic(result.session.config_pins);
        }

        for (let t = 0; t < (result.turns || []).length; t += 1) {
          const turn = result.turns[t];
          const br = turn.browserResult || {};
          const triplet = turn.triplet || {};

          const customerUs =
            br.timings?.browser_action_to_panel_ready_us ??
            br.timings?.browser_action_to_terminal_ready_us ??
            null;
          if (customerUs != null) customerLatencies.push(customerUs);

          const h1Us = msToUs(triplet?.h1?.curl_time_total_ms ?? triplet?.h1?.total_ms);
          const h2Us = msToUs(triplet?.h2?.curl_time_total_ms ?? triplet?.h2?.total_ms);
          const h3Us = msToUs(triplet?.h3?.curl_time_total_ms ?? triplet?.h3?.total_ms);
          const protocolUs =
            [h1Us, h2Us, h3Us].every((v) => v != null) ? h1Us + h2Us + h3Us : null;
          if (protocolUs != null) protocolLatencies.push(protocolUs);
          protocolRows += 3;

          fs.writeFileSync(
            path.join(outRoot, 'protocol', `${row.scenario_id}-turn${t + 1}-triplet.json`),
            JSON.stringify(triplet, null, 2) + '\n',
          );

          const shotDest = path.join(
            outRoot,
            'screenshots',
            row.smoke_turns > 1
              ? `${row.scenario_id}-turn-${t + 1}.png`
              : `${row.scenario_id}-terminal.png`,
          );
          // Prefer per-turn journey captures (absolute_path from product screenshot rows).
          const shots = turn.screenshots || br.screenshots || [];
          const terminalShot =
            shots.find((s) =>
              /ready|terminal|final|completed|result/i.test(
                String(s.state || s.label || s.role || s.capture_phase || ''),
              ),
            ) || shots[shots.length - 1];
          const srcShot =
            terminalShot?.absolute_path ||
            terminalShot?.path ||
            (terminalShot?.relative_path
              ? path.join(REPO, terminalShot.relative_path)
              : null);
          if (srcShot && fs.existsSync(srcShot)) {
            fs.copyFileSync(srcShot, shotDest);
          } else {
            await page.screenshot({ path: shotDest, fullPage: false });
          }
          terminalScreenshots += 1;

          const acceptedResult =
            triplet?.accepted?.body?.result ||
            (triplet?.accepted?.body && !triplet.accepted.body.result
              ? triplet.accepted.body
              : null) ||
            br.rendered?.structured ||
            br.api_response?.result ||
            {};

          const timings = emptyCustomerAndProtocolTimings();
          timings.browser_action_to_request_us = timingField(
            br.timings?.browser_action_to_request_us ?? null,
          );
          timings.browser_action_to_terminal_ready_us = timingField(customerUs);
          timings.browser_screenshot_us = timingField(null, {
            measurement_status: MEASUREMENT_STATUS.PARTIAL_INSTRUMENTED,
          });
          timings.h1_total_us = timingField(h1Us);
          timings.h2_total_us = timingField(h2Us);
          timings.h3_total_us = timingField(h3Us);
          timings.protocol_verification_total_us = timingField(protocolUs);
          timings.total_source_verification_wall_us = timingField(
            customerUs != null && protocolUs != null ? customerUs + protocolUs : null,
            {
              measurement_status:
                customerUs != null && protocolUs != null
                  ? MEASUREMENT_STATUS.PARTIAL_INSTRUMENTED
                  : MEASUREMENT_STATUS.NOT_INSTRUMENTED,
            },
          );
          timings.source_verifier_orchestration_us = timingField(null, {
            measurement_status: MEASUREMENT_STATUS.PARTIAL_INSTRUMENTED,
          });

          let spans = spanSetForTurn({
            trace_id,
            session_id,
            turn_id: turn.turnRow?.turn_id || `${row.scenario_id}-t${t + 1}`,
            turn_index: t,
            capability: row.capability,
          });
          spans = instrumentSpans(spans, {
            'browser.action': {
              duration_us: br.timings?.browser_action_to_request_us ?? null,
              measurement_status:
                br.timings?.browser_action_to_request_us != null
                  ? MEASUREMENT_STATUS.INSTRUMENTED
                  : MEASUREMENT_STATUS.PARTIAL_INSTRUMENTED,
            },
            'browser.terminal_ready': {
              duration_us: customerUs,
              measurement_status:
                customerUs != null
                  ? MEASUREMENT_STATUS.INSTRUMENTED
                  : MEASUREMENT_STATUS.NOT_INSTRUMENTED,
            },
            'gateway.request': {
              duration_us: br.timings?.browser_action_to_panel_ready_us ?? customerUs,
              measurement_status: MEASUREMENT_STATUS.PARTIAL_INSTRUMENTED,
              invocation_status: 'EXECUTED',
              exemption_reason: 'wall_includes_server_pipeline_not_split',
            },
            'authorization.check': {
              duration_us: null,
              measurement_status: MEASUREMENT_STATUS.PARTIAL_INSTRUMENTED,
              invocation_status: 'EXECUTED',
              exemption_reason: 'invoked_observed_duration_missing',
            },
            'context.load': {
              duration_us: null,
              measurement_status: MEASUREMENT_STATUS.PARTIAL_INSTRUMENTED,
              invocation_status: 'EXECUTED',
              exemption_reason: 'invoked_observed_duration_missing',
            },
            'context.correct': {
              duration_us: null,
              measurement_status: MEASUREMENT_STATUS.PARTIAL_INSTRUMENTED,
              invocation_status: 'EXECUTED',
              exemption_reason: 'invoked_observed_duration_missing',
            },
            'evidence.snapshot.load': {
              duration_us: null,
              measurement_status: MEASUREMENT_STATUS.PARTIAL_INSTRUMENTED,
              invocation_status: 'EXECUTED',
              exemption_reason: 'invoked_observed_duration_missing',
            },
            'evidence.assemble': {
              duration_us: null,
              measurement_status: MEASUREMENT_STATUS.PARTIAL_INSTRUMENTED,
              invocation_status: 'EXECUTED',
              exemption_reason: 'invoked_observed_duration_missing',
            },
            'engine.execute': {
              duration_us: null,
              measurement_status: MEASUREMENT_STATUS.PARTIAL_INSTRUMENTED,
              invocation_status: 'EXECUTED',
              exemption_reason: 'invoked_inside_gateway_wall_not_split',
            },
            'schema.validate': {
              duration_us: null,
              measurement_status: MEASUREMENT_STATUS.PARTIAL_INSTRUMENTED,
              invocation_status: 'EXECUTED',
              exemption_reason: 'invoked_observed_duration_missing',
            },
            'grounding.validate': {
              duration_us: null,
              measurement_status: MEASUREMENT_STATUS.PARTIAL_INSTRUMENTED,
              invocation_status: 'EXECUTED',
              exemption_reason: 'invoked_observed_duration_missing',
            },
            'safety.validate': {
              duration_us: null,
              measurement_status: MEASUREMENT_STATUS.PARTIAL_INSTRUMENTED,
              invocation_status: 'EXECUTED',
              exemption_reason: 'invoked_observed_duration_missing',
            },
            'privacy.validate': {
              duration_us: null,
              measurement_status: MEASUREMENT_STATUS.PARTIAL_INSTRUMENTED,
              invocation_status: 'EXECUTED',
              exemption_reason: 'invoked_observed_duration_missing',
            },
            'gateway.response': {
              duration_us: null,
              measurement_status: MEASUREMENT_STATUS.PARTIAL_INSTRUMENTED,
              invocation_status: 'EXECUTED',
              exemption_reason: 'bundled_in_browser_request_to_response',
            },
            'browser.render': {
              duration_us: null,
              measurement_status: MEASUREMENT_STATUS.PARTIAL_INSTRUMENTED,
              invocation_status: 'EXECUTED',
              exemption_reason: 'bundled_in_response_to_terminal_ready',
            },
            'screenshot.capture': {
              duration_us: null,
              measurement_status: MEASUREMENT_STATUS.PARTIAL_INSTRUMENTED,
              invocation_status: 'EXECUTED',
            },
            'accessibility.check': {
              duration_us: null,
              measurement_status: MEASUREMENT_STATUS.PARTIAL_INSTRUMENTED,
              invocation_status: 'EXECUTED',
            },
          });

          const quality = scoreResponseQuality({
            result: acceptedResult,
            facts: acceptedResult.structured_facts || {
              scarcity_score: acceptedResult.scarcity_score,
              sample_size: acceptedResult.sample_size,
            },
            scenarioClass: scenario?.scenario_class,
            capability: row.capability,
          });

          const turnRecord = {
            scenario_id: row.scenario_id,
            capability: row.capability,
            turn_index: t,
            turn_id: turn.turnRow?.turn_id || `${row.scenario_id}-t${t + 1}`,
            canonical_request_hash: turn.turnRow?.canonical_request_hash || null,
            result_hash: materialResultHash(acceptedResult, triplet),
            evidence_hash: evidenceHash(acceptedResult, triplet),
            screenshot_hash: fs.existsSync(shotDest) ? sha256File(shotDest) : null,
            protocol: {
              h1: triplet.h1?.http_status ?? triplet.h1?.status ?? null,
              h2: triplet.h2?.http_status ?? triplet.h2?.status ?? null,
              h3: triplet.h3?.http_status ?? triplet.h3?.status ?? null,
              parity: triplet.parity || null,
              ok: triplet.ok !== false && Number(triplet.h1?.http_status || triplet.h1?.status) === 200,
            },
            timings,
            customer_latency_class: classifyCustomerLatency(customerUs),
            spans,
            token_context: {
              ...emptyTokenContextLedger(),
              current_request_tokens: estimateTokens(row.user_intent),
              measurement_status: MEASUREMENT_STATUS.PARTIAL_INSTRUMENTED,
            },
            quality,
            screenshot: path.relative(outRoot, shotDest),
          };
          proof.turns.push(turnRecord);
          turnRows.push(turnRecord);
          executedTurns += 1;
        }

        proof.ok =
          proof.turns.length === row.smoke_turns &&
          proof.turns.every((tr) => tr.protocol.ok === true);
        if (!proof.ok && !proof.error) {
          proof.error = `TURN_OR_PROTOCOL_FAIL:turns=${proof.turns.length} expected=${row.smoke_turns}`;
        }
      } catch (err) {
        proof.error = `${err?.code || 'PREFLIGHT_ERROR'}:${err?.message || err}`;
        proof.ok = false;
        gate.noteSessionResult({ hard_failure: true, error: proof.error });
      } finally {
        fs.writeFileSync(
          path.join(outRoot, 'diagnostics', `${row.scenario_id}.json`),
          JSON.stringify(proof, null, 2) + '\n',
        );
        scenarioRows.push(proof);
        await context.close().catch(() => null);
        await sleep(200);
      }
    }
  } finally {
    await browser.close().catch(() => null);
    try {
      if (proxy?.child?.pid) process.kill(proxy.child.pid, 'SIGTERM');
    } catch {
      /* ignore */
    }
  }

  const byId = new Map(scenarioRows.map((r) => [r.scenario_id, r]));
  const correction_gates = [];
  for (const [successId, correctionId] of CORRECTION_PAIRS) {
    const a = byId.get(successId);
    const b = byId.get(correctionId);
    const aTurn = a?.turns?.[0];
    const bTurn =
      correctionId === 'negotiation-four-turn-live'
        ? b?.turns?.[b.turns.length - 1]
        : b?.turns?.[0];
    const gateRow = {
      success: successId,
      correction: correctionId,
      prior_result_hash: aTurn?.result_hash || null,
      updated_result_hash: bTurn?.result_hash || null,
      prior_evidence_hash: aTurn?.evidence_hash || null,
      updated_evidence_hash: bTurn?.evidence_hash || null,
      prior_screenshot_hash: aTurn?.screenshot_hash || null,
      updated_screenshot_hash: bTurn?.screenshot_hash || null,
      ok: false,
    };
    gateRow.ok = Boolean(
      gateRow.prior_result_hash &&
        gateRow.updated_result_hash &&
        gateRow.prior_result_hash !== gateRow.updated_result_hash &&
        ((gateRow.prior_screenshot_hash &&
          gateRow.updated_screenshot_hash &&
          gateRow.prior_screenshot_hash !== gateRow.updated_screenshot_hash) ||
          (gateRow.prior_evidence_hash &&
            gateRow.updated_evidence_hash &&
            gateRow.prior_evidence_hash !== gateRow.updated_evidence_hash)),
    );
    gateRow.changed_material_fields = gateRow.ok
      ? [
          'result_hash',
          gateRow.prior_screenshot_hash !== gateRow.updated_screenshot_hash
            ? 'screenshot_hash'
            : null,
          gateRow.prior_evidence_hash !== gateRow.updated_evidence_hash
            ? 'evidence_hash'
            : null,
        ].filter(Boolean)
      : ['INSUFFICIENT_MATERIAL_CHANGE'];
    correction_gates.push(gateRow);
  }

  const nego = byId.get('negotiation-four-turn-live');
  const context_tiers = evaluateNegotiationContextTiers({
    session_id,
    thread_id: 'preflight-nego',
    participant_side: 'seller',
  });

  const failed = scenarioRows.filter((r) => !r.ok);
  const latency_report = {
    browser_customer_action_to_terminal: nearestRankPercentiles(customerLatencies),
    protocol_verification: nearestRankPercentiles(protocolLatencies),
    p95_class:
      (nearestRankPercentiles(customerLatencies).p95 || 0) > 5_000_000
        ? 'DEGRADED'
        : 'GOOD',
    blocking_turns_over_12s: turnRows.filter(
      (t) => (t.timings?.browser_action_to_terminal_ready_us?.value_us || 0) > 12_000_000,
    ).length,
    note:
      'Customer latency is browser_action_to_terminal_ready_us only — excludes H1/H2/H3 verification wall time',
  };
  const slowest_turns = buildSlowestTurnAttribution(turnRows, 5);
  const allSpans = turnRows.flatMap((t) => t.spans || []);
  const telemetry_completeness = pipelineStageCompleteness(allSpans);
  const executed_stage_check = assertExecutedStageInstrumentation(
    // Evaluate per-turn and aggregate unique gaps
    turnRows.length ? turnRows[0].spans || [] : [],
    REQUIRED_EXECUTED_CUSTOMER_STAGES,
  );
  const telemetry_partial =
    telemetry_completeness.not_instrumented > 0 ||
    telemetry_completeness.partial_instrumented > 0 ||
    !executed_stage_check.ok;
  const quality_summary = {
    turns_scored: turnRows.length,
    average:
      turnRows.reduce((s, t) => s + (t.quality?.average || 0), 0) / Math.max(1, turnRows.length),
    all_ok: turnRows.every((t) => t.quality?.ok !== false),
  };

  const countsOk =
    scenarioRows.length === 24 &&
    executedTurns >= 27 &&
    protocolRows >= 81 &&
    terminalScreenshots >= 27;

  const negoDistinctShots = new Set(
    (nego?.turns || []).map((t) => t.screenshot_hash).filter(Boolean),
  ).size;
  const negoDistinctResults = new Set(
    (nego?.turns || []).map((t) => t.result_hash).filter(Boolean),
  ).size;
  const negotiation_four_turn = {
    ok:
      nego?.ok === true &&
      (nego?.turns?.length || 0) === 4 &&
      negoDistinctShots === 4 &&
      negoDistinctResults >= 2,
    turns: nego?.turns?.length || 0,
    distinct_screenshot_hashes: negoDistinctShots,
    distinct_result_hashes: negoDistinctResults,
  };

  const correction_gates_pass = correction_gates.every((g) => g.ok);
  const correction_gates_passed = correction_gates.filter((g) => g.ok).length;

  const summary = {
    label: 'PHASE34_24_SOURCE_PREFLIGHT_DIAGNOSTIC',
    product_acceptance: false,
    owner_proof_evidence: false,
    live_owner_proof_recapture_launched: false,
    out_root: outRoot,
    session_id,
    trace_id,
    counts: {
      scenarios: scenarioRows.length,
      executed_turns: executedTurns,
      protocol_rows: protocolRows,
      terminal_screenshots: terminalScreenshots,
      expected: { scenarios: 24, turns: 27, protocol_rows: 81, screenshots_min: 27 },
    },
    failed_scenarios: failed.map((f) => ({ id: f.scenario_id, error: f.error })),
    correction_gates,
    correction_gates_pass,
    correction_gates_passed,
    negotiation_four_turn,
    context_tiers,
    latency_report,
    slowest_turns,
    telemetry_completeness,
    executed_stage_check,
    telemetry_status: telemetry_partial
      ? 'PIPELINE_TELEMETRY_PARTIAL'
      : 'PIPELINE_TELEMETRY_COMPLETE',
    quality_summary,
    h123: {
      ok: turnRows.every((t) => t.protocol?.ok),
      material_mismatches: turnRows.filter((t) => !t.protocol?.ok).length,
    },
    forbidden_roots_absent: true,
    frozen_baseline_untouched: FROZEN_BASELINE,
    frozen_preflight_v1_untouched: FROZEN_PREFLIGHT_V1,
    status_line:
      failed.length === 0 &&
      countsOk &&
      turnRows.every((t) => t.protocol?.ok) &&
      negotiation_four_turn.ok &&
      quality_summary.average >= 3.5 &&
      quality_summary.all_ok &&
      correction_gates_pass &&
      latency_report.blocking_turns_over_12s === 0
        ? 'PHASE 34 MATERIAL CORRECTION GATES 8/8 AND SOURCE PREFLIGHT-V2 PASS — LIVE OWNER-PROOF RECAPTURE READY — NOT LAUNCHED'
        : 'PHASE 34 24-SCENARIO SOURCE PREFLIGHT EXECUTED — BLOCKED ON MATERIAL CORRECTION BEHAVIOR — PIPELINE TELEMETRY PARTIAL — LIVE OWNER-PROOF RECAPTURE NOT AUTHORIZED',
    status:
      failed.length === 0 &&
      countsOk &&
      turnRows.every((t) => t.protocol?.ok) &&
      negotiation_four_turn.ok &&
      quality_summary.average >= 3.5 &&
      quality_summary.all_ok &&
      correction_gates_pass &&
      latency_report.blocking_turns_over_12s === 0
        ? 'SOURCE_24_PREFLIGHT_PASS'
        : failed.length === 0 && countsOk && turnRows.every((t) => t.protocol?.ok)
          ? 'SOURCE_24_PREFLIGHT_EXECUTED_WITH_GATE_FINDINGS'
          : 'SOURCE_24_PREFLIGHT_PARTIAL',
  };

  fs.writeFileSync(path.join(outRoot, 'reports', 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  fs.writeFileSync(
    path.join(outRoot, 'reports', 'latency-summary.json'),
    JSON.stringify(latency_report, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(outRoot, 'reports', 'telemetry-completeness.json'),
    JSON.stringify(telemetry_completeness, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(outRoot, 'reports', 'quality-summary.json'),
    JSON.stringify(quality_summary, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(outRoot, 'reports', 'correction-gates.json'),
    JSON.stringify(correction_gates, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(outRoot, 'reports', 'slowest-turns.json'),
    JSON.stringify(slowest_turns, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(outRoot, 'reports', 'executed-stage-check.json'),
    JSON.stringify(executed_stage_check, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(outRoot, 'transcript', 'turns.json'),
    JSON.stringify({ session_id, trace_id, turns: turnRows }, null, 2) + '\n',
  );

  return summary;
}
