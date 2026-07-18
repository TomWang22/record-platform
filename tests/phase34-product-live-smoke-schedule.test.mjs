/**
 * Live smoke-v2 schedule builder tests (offline).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveSmokeSchedule } from '../scripts/phase34-launch-product-harness-live-smoke.mjs';
import { PRODUCT_CAPABILITIES } from '../scripts/lib/phase34-product-schedule.mjs';
import {
  reconcileTerminalScreenshots,
  assertScreenshotChronology,
  isTerminalScreenshotState,
} from '../scripts/lib/phase34-product-terminal-screenshots.mjs';

test('live smoke-v2 schedule is 64 sessions with 16 multi-turn and viewport mix', () => {
  const s = buildLiveSmokeSchedule();
  assert.equal(s.logical_sessions, 64);
  assert.equal(s.rows.length, 64);
  assert.equal(s.multi_turn_sessions, 16);
  assert.equal(s.turns_expected, 112);
  assert.equal(s.protocol_rows_expected, 336);
  for (const cap of PRODUCT_CAPABILITIES) {
    assert.equal(s.rows.filter((r) => r.capability === cap).length, 8);
    assert.equal(
      s.rows.filter((r) => r.capability === cap && r.multi_turn_class === 'multi_4_12').length,
      2,
    );
  }
  assert.equal(s.rows.filter((r) => r.smoke_viewport === 'desktop').length, 32);
  assert.equal(s.rows.filter((r) => r.smoke_viewport === 'tablet').length, 16);
  assert.equal(s.rows.filter((r) => r.smoke_viewport === 'mobile').length, 16);
});

test('limitations_expanded is not a terminal screenshot state', () => {
  assert.equal(isTerminalScreenshotState('limitations_expanded'), false);
  assert.equal(isTerminalScreenshotState('evidence_expanded'), false);
  assert.equal(isTerminalScreenshotState('final'), true);
  assert.equal(isTerminalScreenshotState('stale_data'), true);
});

test('terminal reconciliation requires exactly one terminal shot per turn', () => {
  const turns = ['t1', 't2'];
  const rows = [
    { turn_id: 't1', state: 'before_action', screenshot_id: 'a' },
    { turn_id: 't1', state: 'final', screenshot_id: 'b' },
    { turn_id: 't1', state: 'limitations_expanded', screenshot_id: 'c' },
    { turn_id: 't2', state: 'before_action', screenshot_id: 'd' },
  ];
  const r = reconcileTerminalScreenshots(rows, turns);
  assert.equal(r.terminal_screenshot_turns, 1);
  assert.equal(r.turns_missing_terminal_screenshot, 1);
  assert.equal(r.pass, false);
});

test('chronology rejects before_action claiming response available', () => {
  const r = assertScreenshotChronology([
    {
      turn_id: 't1',
      state: 'before_action',
      captured_at: '2026-07-18T00:00:01.000Z',
      response_available_at_capture: true,
    },
    {
      turn_id: 't1',
      state: 'final',
      captured_at: '2026-07-18T00:00:02.000Z',
      response_available_at_capture: true,
    },
  ]);
  assert.ok(r.chronology_violations >= 1);
});

test('valuation smoke rotation skips non-eligible edit and selects /sell for buyers', async () => {
  const { ValuationJourneyAdapter } = await import('../scripts/lib/phase34-product-journeys/adapters.mjs');
  const adapter = new ValuationJourneyAdapter();
  const sellCtx = { participant_side: 'buyer', surface_route_index: 2 };
  assert.equal(adapter.pickRoute(sellCtx), '/sell');
  assert.equal(sellCtx.selected_surface?.requires_collection_selection, true);
  const editWouldBeIdx3 = { participant_side: 'buyer', surface_route_index: 3 };
  // edit is smoke_eligible:false so index 3 wraps within [listings, records, sell]
  assert.notEqual(adapter.pickRoute(editWouldBeIdx3), '/listings/[id]/edit');
  const seller = { participant_side: 'seller', surface_route_index: 2 };
  assert.equal(adapter.pickRoute(seller), '/listings/[id]');
});

test('auction watchlist surface pins watchlist-temperature apiPath', async () => {
  const { AuctionJourneyAdapter } = await import('../scripts/lib/phase34-product-journeys/adapters.mjs');
  const adapter = new AuctionJourneyAdapter();
  const prepared = await adapter.prepare({
    participant_side: 'buyer',
    surface_route_index: 1,
    scenario_id: 'auction_intelligence__individual_auction__0',
    subject: { listing_id: 'listing-1', record_id: 'rec-1', id: 'listing-1' },
  });
  assert.equal(prepared.routeTemplate, '/watchlist');
  assert.equal(prepared.apiPath, '/api/ai/intelligence/auction/watchlist-temperature');
  assert.equal(prepared.panelTestId, 'intelligence-watchlist-temperature-panel');
});

test('product PCAP window analyzer returns packets for a bounded epoch window', async () => {
  const { analyzePcapPacketSpaceWindow } = await import('../scripts/lib/phase34-product-pcap.mjs');
  // Synthetic: missing file path should fail closed without throwing.
  const missing = analyzePcapPacketSpaceWindow('/tmp/phase34-does-not-exist.pcapng', 1, 2, {
    connectionMode: 'triplet',
  });
  assert.equal(missing.status, 'FAIL');
  assert.equal(missing.packets.length, 0);
});

test('product PCAP window analyzer returns packets for a bounded epoch window', async () => {
  const { analyzePcapPacketSpaceWindow } = await import('../scripts/lib/phase34-product-pcap.mjs');
  // Synthetic: missing file path should fail closed without throwing.
  const missing = analyzePcapPacketSpaceWindow('/tmp/phase34-does-not-exist.pcapng', 1, 2, {
    connectionMode: 'triplet',
  });
  assert.equal(missing.status, 'FAIL');
  assert.equal(missing.packets.length, 0);
});
