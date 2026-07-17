/**
 * Executable product session runner: browser → canonical → H1/H2/H3 → reconcile.
 * Screenshots must be captured before PASS on live journeys.
 */
import crypto from 'node:crypto';
import {
  getJourneyAdapter,
  createFixtureBrowserDriver,
} from './phase34-product-journeys/adapters.mjs';
import {
  executeProtocolTriplet,
  assertSameCanonicalPayload,
  hashCanonicalRequest,
} from './phase34-product-protocol-triplet.mjs';
import {
  emptyLatencyRow,
  validateLatencyInvariants,
  ProductFailClosedGate,
  classifyProductHardFailure,
} from './phase34-product-execution.mjs';
import { INTER_BATCH_INTERVAL_MS } from './phase33f-rate-limit.mjs';
import {
  ProductLedgerWriter,
  createSessionId,
  createTurnId,
  createJourneyId,
  createTripletId,
  buildTurnLedgerRow,
  classifyMultiTurnEvidence,
} from './phase34-product-ledgers.mjs';
import {
  pinFromCommittedRegistry,
  pinFixtureSynthetic,
  buildObservedInvocationLedger,
  assertLivePinsNotSynthetic,
  PIN_SOURCE,
} from './phase34-product-runtime-pins.mjs';
import {
  assertScreenshotsBeforePass,
  ScreenshotManifestWriter,
  PLAYWRIGHT_TRACE_POLICY,
} from './phase34-product-screenshots.mjs';

export const PRODUCT_SESSION_RUNNER_VERSION = 'phase34-product-session-runner-v2';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Live product turns share the gateway IP bucket with H1/H2/H3; pace to avoid HTTP 429. */
export function productLiveInterTurnMs() {
  const raw = Number(process.env.PHASE34_PRODUCT_INTER_TURN_MS);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return Math.max(INTER_BATCH_INTERVAL_MS, 1500);
}

const MULTI_TURN_SCENARIOS = Object.freeze([
  'budget_correction',
  'condition_correction',
  'catalog_pressing_correction',
  'preference_retraction',
  'currency_change',
  'stale_evidence_replacement',
  'watched_auction_change',
  'offer_history_change',
  'deleted_message_removal',
  'explicit_forget',
  'durable_memory_consent',
  'consent_withdrawal',
  'cross_thread_refusal',
  'cross_user_refusal',
  'listing_message_prompt_injection',
]);

/**
 * @param {object} scheduleRow
 * @param {object} opts
 */
export async function runProductSession(scheduleRow, opts = {}) {
  const gate = opts.gate || new ProductFailClosedGate();
  gate.noteSessionStart();

  const session_id = createSessionId([
    scheduleRow.coordinate,
    String(scheduleRow.schedule_index),
    scheduleRow.scenario_id,
  ]);
  const journey_id = createJourneyId(session_id);
  const adapter = getJourneyAdapter(scheduleRow.capability);
  const live = Boolean(opts.page) && opts.fixtureMode !== true;

  const retrievalMode = scheduleRow.scenario_class?.includes('semantic')
    ? 'semantic'
    : scheduleRow.scenario_class?.includes('hybrid')
      ? 'hybrid'
      : 'keyword';

  const pins = live
    ? pinFromCommittedRegistry({
        capability: scheduleRow.capability,
        prompt_slot: scheduleRow.prompt_slot,
        retrieval_mode_requested: retrievalMode,
        runtime_image_digest: opts.runtimeImagePin || null,
        certificate_fingerprint: opts.certificatePin || null,
      })
    : pinFixtureSynthetic({
        prompt_configuration_id: scheduleRow.prompt_configuration_id,
        model_tier: scheduleRow.model_tier,
      });

  if (live) assertLivePinsNotSynthetic(pins);

  const screenshotManifest =
    opts.screenshotManifest ||
    (opts.ledger ? new ScreenshotManifestWriter(opts.ledger.outRoot) : null);

  const turnCount =
    scheduleRow.multi_turn_class === 'multi_4_12'
      ? clampTurnCount(opts.turnCount ?? 4 + (scheduleRow.schedule_index % 9))
      : 1;

  const turns = [];
  let prior_state_hash = null;
  let lastResult = null;
  const allScreenshots = [];

  for (let turn_index = 0; turn_index < turnCount; turn_index += 1) {
    const turn_id = createTurnId(session_id, turn_index);
    const triplet_id = createTripletId(session_id, turn_index);
    const turnScenario =
      turnCount > 1
        ? MULTI_TURN_SCENARIOS[turn_index % MULTI_TURN_SCENARIOS.length]
        : scheduleRow.scenario_class;

    const context = {
      session_id,
      journey_id,
      turn_id,
      turn_index,
      scenario_id: scheduleRow.scenario_id,
      scenario_class: scheduleRow.scenario_class,
      participant_side: scheduleRow.participant_side,
      authorization_state: scheduleRow.authorization_state,
      evidence_strength: scheduleRow.evidence_strength,
      turn_scenario: turnScenario,
      prior_state_hash,
      screenshot_pack: opts.screenshotPack || 'gauntlet',
      subject: opts.subject || null,
    };

    const prepared = await adapter.prepare(context);
    if (turnScenario) {
      prepared.requestSeed = {
        ...prepared.requestSeed,
        turn_index,
        turn_scenario: turnScenario,
        prior_state_hash,
      };
    }

    const fixtureDriver =
      !live ? createFixtureBrowserDriver(opts.fixtureOverrides || {}) : null;

    const browserResult = await adapter.executeBrowserJourney(opts.page || null, prepared, {
      fixtureDriver,
    });

    const canonical = await adapter.captureCanonicalRequest(browserResult);
    const canonical_request_hash = hashCanonicalRequest(canonical.body);

    const triplet = executeProtocolTriplet(canonical, {
      probeIdPrefix: `${session_id}_${turn_index}`,
      live: opts.liveProtocol === true,
      acceptedStructured: browserResult.rendered?.structured,
      fixtureResponses: opts.fixtureResponses,
      pcapCorrelation: opts.pcapCorrelation || null,
      baseUrl: opts.protocolBaseUrl || opts.baseUrl || null,
      caCert: opts.caCert || null,
      token: opts.protocolToken || opts.token || null,
      userId: opts.userId || null,
      curlResolve: opts.curlResolve || null,
    });
    assertSameCanonicalPayload(triplet);

    const reconciliation = await adapter.reconcileRenderedResult(browserResult, triplet.accepted);

    const rendered_result_hash = crypto
      .createHash('sha256')
      .update(JSON.stringify(browserResult.rendered?.structured || {}))
      .digest('hex');
    const accepted_response_hash = triplet.h1.response_hash;

    // Link screenshots to protocol identities before PASS
    const shotRows = (browserResult.screenshots || []).map((s) => ({
      ...s,
      session_id,
      turn_id,
      journey_id,
      triplet_id,
      canonical_request_hash,
      accepted_response_hash,
      rendered_result_hash,
      H1_probe_id: triplet.h1.probe_id,
      H2_probe_id: triplet.h2.probe_id,
      H3_probe_id: triplet.h3.probe_id,
      accessibility_status: browserResult.accessibility_result,
      horizontal_overflow: browserResult.horizontal_overflow,
    }));

    if (live) {
      assertScreenshotsBeforePass(shotRows);
      for (const row of shotRows) screenshotManifest?.append(row);
    }
    allScreenshots.push(...shotRows);

    const invocations = buildObservedInvocationLedger({
      session_id,
      turn_id,
      pins,
      pipelineObservation: opts.pipelineObservation || {},
    });

    const latency = emptyLatencyRow({
      session_id,
      turn_id,
      measurement_status: browserResult.timings?.measurement_status || 'NOT_INSTRUMENTED',
      browser_action_to_request_us: browserResult.timings?.browser_action_to_request_us ?? null,
      browser_action_to_panel_ready_us:
        browserResult.timings?.browser_action_to_panel_ready_us ?? null,
      wall_total_us: browserResult.timings?.browser_action_to_panel_ready_us ?? null,
    });
    const latencyCheck = validateLatencyInvariants(latency);

    const turnRow = buildTurnLedgerRow(
      { session_id },
      turn_index,
      {
        browser_action: browserResult.action_sequence?.join('>'),
        input_hash: crypto.createHash('sha256').update(JSON.stringify(canonical.body)).digest('hex'),
        prior_state_hash,
        correction_present: String(turnScenario || '').includes('correction'),
        deletion_present:
          String(turnScenario || '').includes('deleted') ||
          String(turnScenario || '').includes('forget'),
        memory_consent_state: String(turnScenario || '').includes('consent') ? turnScenario : null,
        selected_memory_hash: null,
        selected_evidence_hash: null,
        canonical_request_hash,
        H1_probe_id: triplet.h1.probe_id,
        H2_probe_id: triplet.h2.probe_id,
        H3_probe_id: triplet.h3.probe_id,
        rendered_result_hash,
        turn_outcome:
          browserResult.journey_outcome === 'PASS' &&
          triplet.ok &&
          reconciliation.status === 'PASS' &&
          (!live || shotRows.length > 0)
            ? 'PASS'
            : 'FAIL',
      },
    );
    turnRow.triplet_id = triplet_id;
    turnRow.journey_id = journey_id;
    turnRow.pins_pin_set_hash = pins.pin_set_hash;
    turnRow.pin_source = pins.pin_source;
    turnRow.latency_check = latencyCheck.status;
    turnRow.screenshot_manifest_entry_ids = shotRows.map((s) => s.screenshot_id);
    turnRow.accessibility_result = browserResult.accessibility_result;
    turnRow.horizontal_overflow = browserResult.horizontal_overflow;

    turns.push({
      turnRow,
      browserResult,
      canonical,
      triplet,
      reconciliation,
      invocations,
      latency,
      screenshots: shotRows,
    });

    prior_state_hash = turnRow.rendered_result_hash;
    lastResult = {
      browser_journey_status: browserResult.journey_outcome,
      ui_api_reconciliation_status: reconciliation.status,
      protocol_status: triplet.ok ? 'PASS' : 'FAIL',
      protocol_fallback: triplet.h1.fallback || triplet.h2.fallback || triplet.h3.fallback,
      automatic_send_allowed: browserResult.automatic_send_allowed,
      production_mutation: browserResult.production_mutation,
      schema_failure: false,
      privacy_violation: false,
      safety_violation: false,
    };

    const hard = classifyProductHardFailure(lastResult);
    if (hard) {
      gate.noteSessionResult(lastResult);
      break;
    }

    if (live && turn_index + 1 < turnCount) {
      await sleep(productLiveInterTurnMs());
    }
  }

  await adapter.cleanup({ session_id, scenario_id: scheduleRow.scenario_id });

  const multiClass = classifyMultiTurnEvidence({
    session_id,
    turns: turns.map((t) => t.turnRow),
  });

  const sessionPass =
    turns.length > 0 &&
    turns.every((t) => t.turnRow.turn_outcome === 'PASS') &&
    !gate.blocked &&
    (!live || allScreenshots.length > 0);

  const sessionRecord = {
    schema_version: PRODUCT_SESSION_RUNNER_VERSION,
    session_id,
    journey_id,
    capability: scheduleRow.capability,
    scenario_id: scheduleRow.scenario_id,
    schedule_index: scheduleRow.schedule_index,
    participant_side: scheduleRow.participant_side,
    dataset_split: scheduleRow.dataset_split,
    multi_turn_class: scheduleRow.multi_turn_class,
    executed_turn_count: turns.length,
    config_pins: pins,
    pin_source: pins.pin_source,
    MULTI_TURN_EXECUTION_EVIDENCE: multiClass.MULTI_TURN_EXECUTION_EVIDENCE,
    browser_journey_status: sessionPass ? 'PASS' : lastResult?.browser_journey_status || 'FAIL',
    protocol_status: sessionPass ? 'PASS' : lastResult?.protocol_status || 'FAIL',
    ui_api_reconciliation_status: sessionPass
      ? 'PASS'
      : lastResult?.ui_api_reconciliation_status || 'FAIL',
    session_outcome: sessionPass ? 'PASS' : 'FAIL',
    screenshot_count: allScreenshots.length,
    screenshot_manifest_entry_ids: allScreenshots.map((s) => s.screenshot_id),
    accessibility_result: turns[0]?.browserResult?.accessibility_result || 'NOT_EXECUTED',
    visual_review_status: 'OWNER_VISUAL_REVIEW_REQUIRED',
    playwright_trace_policy: PLAYWRIGHT_TRACE_POLICY,
    evidence_class: live ? 'LIVE_BROWSER' : 'FIXTURE_UNIT',
    link: turns[0]
      ? {
          session_id,
          turn_id: turns[0].turnRow.turn_id,
          journey_id,
          triplet_id: turns[0].turnRow.triplet_id,
          browser_request_id: turns[0].canonical.browser_request_id,
          canonical_request_hash: turns[0].turnRow.canonical_request_hash,
          participant_id_hash: crypto
            .createHash('sha256')
            .update(`participant|${scheduleRow.participant_side}|fixture`)
            .digest('hex'),
          capability: scheduleRow.capability,
          scenario_id: scheduleRow.scenario_id,
          evidence_snapshot_hash: null,
          screenshot_manifest_entry_id: allScreenshots[0]?.screenshot_id || null,
          H1_probe_id: turns[0].turnRow.H1_probe_id,
          H2_probe_id: turns[0].turnRow.H2_probe_id,
          H3_probe_id: turns[0].turnRow.H3_probe_id,
          rendered_result_hash: turns[0].turnRow.rendered_result_hash,
        }
      : null,
  };

  gate.noteSessionResult({
    browser_journey_status: sessionRecord.browser_journey_status,
    ui_api_reconciliation_status: sessionRecord.ui_api_reconciliation_status,
    protocol_status: sessionRecord.protocol_status,
    automatic_send_allowed: false,
    production_mutation: false,
  });

  if (opts.ledger) {
    opts.ledger.append('sessions', sessionRecord);
    for (const t of turns) {
      opts.ledger.append('turns', t.turnRow);
      opts.ledger.append('latency', t.latency);
      opts.ledger.append('reconciliation', {
        session_id,
        turn_id: t.turnRow.turn_id,
        ...t.reconciliation,
      });
      for (const inv of t.invocations) opts.ledger.append('invocations', inv);
      opts.ledger.append('journeys', {
        session_id,
        turn_id: t.turnRow.turn_id,
        journey_id,
        browser_route: t.browserResult.browser_route,
        journey_outcome: t.browserResult.journey_outcome,
        journey_fail_reasons: t.browserResult.journey_fail_reasons || [],
        console_errors: t.browserResult.console_errors || [],
        failed_requests: t.browserResult.failed_requests || [],
        canonical_request_hash: t.turnRow.canonical_request_hash,
        screenshot_ids: t.turnRow.screenshot_manifest_entry_ids,
      });
    }
  }

  return {
    session: sessionRecord,
    turns,
    screenshots: allScreenshots,
    gate: gate.snapshot(),
  };
}

function clampTurnCount(n) {
  return Math.min(12, Math.max(4, n));
}

export async function runProductSessionBatch(scheduleRows, opts = {}) {
  const gate = opts.gate || new ProductFailClosedGate();
  const screenshotManifest =
    opts.screenshotManifest ||
    (opts.ledger ? new ScreenshotManifestWriter(opts.ledger.outRoot) : null);
  const results = [];
  for (const row of scheduleRows) {
    if (!gate.canStartSession()) break;
    const result = await runProductSession(row, { ...opts, gate, screenshotManifest });
    results.push(result);
    if (gate.blocked) break;
  }
  if (screenshotManifest?.rows?.length) screenshotManifest.finalize();
  return {
    results,
    gate: gate.snapshot(),
    next_session_started_after_hard_failure: gate.next_session_started_after_hard_failure,
    screenshot_manifest_count: screenshotManifest?.rows?.length || 0,
  };
}

export {
  MULTI_TURN_SCENARIOS,
  ProductFailClosedGate,
  ProductLedgerWriter,
  PIN_SOURCE,
  PLAYWRIGHT_TRACE_POLICY,
};
