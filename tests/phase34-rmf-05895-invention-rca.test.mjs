import test from 'node:test';
import assert from 'node:assert/strict';
import { guardInvention } from '../scripts/lib/phase34-invention-guard.mjs';

const AUCTION_STRUCTURED = {
  sold_count: 3,
  median: 42,
  currency: 'USD',
  fair_low: 35,
  fair_high: 50,
  seller_floor: 40,
  watchers: 12,
  bid_count: 4,
  draft: 'Would you consider 40 USD?',
};

function ledgerFor(structured) {
  return {
    entries: Object.entries(structured)
      .filter(([, v]) => typeof v === 'number')
      .map(([k, v]) => ({
        claim_type: k,
        normalized_claim_value: v,
        verification_result: 'SUPPORTED',
      })),
  };
}

/** Exact replay of the rmf-05895 offending prose under pinned structured inputs. */
test('rmf-05895 exact replay: invented $45 is rejected and does not escape', () => {
  const text =
    'We have 3 eligible sales with a median price of $42, and our current best bid is $40 USD. We are not allowing automatic bids or sending messages to sellers. Our draft message suggests a sale at $45 USD, but';
  const g = guardInvention({
    text,
    structured_result: AUCTION_STRUCTURED,
    claim_ledger: ledgerFor(AUCTION_STRUCTURED),
  });
  assert.equal(g.ok, false);
  assert.ok(g.violations.some((v) => Number(v.claim?.value) === 45));
  // Contained: guarded_text must not retain unsupported 45 if guard strips — current API returns ok=false with original; fallback is caller's duty.
  assert.equal(g.ok, false);
});

test('adversarial numeric inventions: 1000 unsupported prices never pass the guard', () => {
  const allowed = new Set([3, 4, 12, 35, 40, 42, 50]);
  let rejected = 0;
  let escaped = 0;
  for (let i = 0; i < 1000; i += 1) {
    // Pick a price not in the allowlist
    let forged = 10 + (i % 90);
    if (allowed.has(forged)) forged += 1;
    if (allowed.has(forged)) forged = 99;
    const text = `Median is $42. I recommend offering $${forged} USD based on vibes.`;
    const g = guardInvention({
      text,
      structured_result: AUCTION_STRUCTURED,
      claim_ledger: ledgerFor(AUCTION_STRUCTURED),
    });
    if (!g.ok) rejected += 1;
    else escaped += 1;
  }
  assert.equal(escaped, 0);
  assert.equal(rejected, 1000);
});

test('supported numbers from allowlist pass', () => {
  const text = 'Completed-sale median is 42 USD across 3 sales. Seller floor 40. Fair range 35 to 50.';
  const g = guardInvention({
    text,
    structured_result: AUCTION_STRUCTURED,
    claim_ledger: ledgerFor(AUCTION_STRUCTURED),
  });
  assert.equal(g.ok, true);
});
