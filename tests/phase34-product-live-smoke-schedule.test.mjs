/**
 * Live smoke schedule builder tests (offline).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveSmokeSchedule } from '../scripts/phase34-launch-product-harness-live-smoke.mjs';
import { PRODUCT_CAPABILITIES } from '../scripts/lib/phase34-product-schedule.mjs';

test('live smoke schedule is 32 sessions with 8 multi-turn and viewport mix', () => {
  const s = buildLiveSmokeSchedule();
  assert.equal(s.logical_sessions, 32);
  assert.equal(s.rows.length, 32);
  assert.equal(s.multi_turn_sessions, 8);
  assert.equal(s.turns_expected, 56);
  assert.equal(s.protocol_rows_expected, 168);
  for (const cap of PRODUCT_CAPABILITIES) {
    assert.equal(s.rows.filter((r) => r.capability === cap).length, 4);
    assert.equal(
      s.rows.filter((r) => r.capability === cap && r.multi_turn_class === 'multi_4_12').length,
      1,
    );
  }
  assert.equal(s.rows.filter((r) => r.smoke_viewport === 'desktop').length, 16);
  assert.equal(s.rows.filter((r) => r.smoke_viewport === 'tablet').length, 8);
  assert.equal(s.rows.filter((r) => r.smoke_viewport === 'mobile').length, 8);
});
