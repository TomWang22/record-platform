import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRecord,
  normalizePublicListing,
  normalizeOwnerListing,
  normalizeListingRevision,
  normalizeOboOfferSummary,
  normalizeAuctionBidSummary,
  normalizeMessage,
  documentChecksum,
  maskBidderId,
  sanitizeListingTitle,
} from './rp-ai-normalize-documents.mjs';

const now = '2026-06-05T12:00:00.000Z';

describe('rp-ai-normalize-documents', () => {
  it('record document generation', () => {
    const doc = normalizeRecord({
      id: 'r1',
      user_id: 'u1',
      artist: 'Miles Davis',
      name: 'Kind of Blue',
      format: 'LP',
      record_grade: 'NM',
      updated_at: now,
      created_at: now,
    });
    assert.equal(doc.source_type, 'record');
    assert.equal(doc.owner_user_id, 'u1');
    assert.equal(doc.visibility, 'owner');
    assert.ok(doc.normalized_text.includes('Miles Davis'));
    assert.ok(doc.checksum);
  });

  it('public active listing document', () => {
    const doc = normalizePublicListing({
      id: 'l1',
      user_id: 'seller1',
      title: 'Rare LP',
      listing_type: 'fixed_price',
      price: 25,
      currency: 'USD',
      is_active: true,
      updated_at: now,
      created_at: now,
    });
    assert.equal(doc.visibility, 'public');
    assert.equal(doc.owner_user_id, null);
    assert.ok(!doc.normalized_text.includes('seller1'));
  });

  it('seller-only draft listing document', () => {
    const doc = normalizeOwnerListing({
      id: 'l2',
      user_id: 'seller1',
      title: 'Draft LP',
      listing_type: 'fixed_price',
      price: 10,
      currency: 'USD',
      is_active: false,
      updated_at: now,
      created_at: now,
    });
    assert.equal(doc.visibility, 'owner');
    assert.equal(doc.owner_user_id, 'seller1');
    assert.ok(doc.normalized_text.includes('inactive'));
  });

  it('listing revision document is owner-scoped', () => {
    const doc = normalizeListingRevision(
      {
        id: 'rev1',
        listing_id: 'l1',
        editor_user_id: 'seller1',
        snapshot: { title: 'Updated', price: 30 },
        created_at: now,
      },
      { title: 'Rare LP', user_id: 'seller1' },
    );
    assert.equal(doc.source_type, 'listing_revision');
    assert.equal(doc.visibility, 'owner');
  });

  it('OBO summary without raw negotiation leak', () => {
    const docs = normalizeOboOfferSummary(
      {
        id: 'o1',
        listing_id: 'l1',
        buyer_user_id: 'b1',
        seller_user_id: 's1',
        amount_cents: 1200,
        currency: 'USD',
        status: 'pending',
        attempt_number: 1,
        message: 'SECRET NEGOTIATION TEXT',
        updated_at: now,
        created_at: now,
      },
      'Rare LP',
    );
    assert.equal(docs.length, 2);
    for (const doc of docs) {
      assert.ok(!doc.normalized_text.includes('SECRET'));
      assert.ok(!doc.normalized_text.includes('message'));
    }
  });

  it('auction summary without proxy max leak', () => {
    const doc = normalizeAuctionBidSummary(
      { id: 'a1', title: 'Auction LP', updated_at: now, created_at: now },
      { status: 'active', current_bid_cents: 5000, bid_count: 2, updated_at: now },
      [{ bidder_user_id: 'bidder-uuid-1', amount_cents: 5000, created_at: now }],
    );
    assert.ok(!doc.normalized_text.includes('max_bid'));
    assert.ok(!doc.normalized_text.includes('proxy'));
    assert.ok(doc.normalized_text.includes(maskBidderId('bidder-uuid-1')));
  });

  it('message source skipped by default', () => {
    assert.equal(normalizeMessage({ id: 'm1', conversation_id: 'c1', sender_id: 'u1', body: 'hello', created_at: now }, false), null);
    const doc = normalizeMessage({ id: 'm1', conversation_id: 'c1', sender_id: 'u1', body: 'hello', created_at: now }, true);
    assert.ok(doc);
    assert.equal(doc.source_type, 'message');
  });

  it('sanitizes OCH seed listing titles', () => {
    const doc = normalizePublicListing({
      id: 'l-och',
      user_id: 'seller1',
      title: 'och-page-4-1778201292009 batch-93',
      listing_type: 'fixed_price',
      price: 25,
      currency: 'USD',
      is_active: true,
      updated_at: now,
      created_at: now,
    });
    assert.ok(!doc.normalized_text.match(/\boch\b/i));
    assert.ok(doc.title.startsWith('Listing '));
  });

  it('checksum is stable', () => {
    const a = documentChecksum({ source_type: 'record', source_id: '1', visibility: 'owner', title: 't', summary: 's', normalized_text: 'n', source_updated_at: now });
    const b = documentChecksum({ source_type: 'record', source_id: '1', visibility: 'owner', title: 't', summary: 's', normalized_text: 'n', source_updated_at: now });
    assert.equal(a, b);
  });
});
