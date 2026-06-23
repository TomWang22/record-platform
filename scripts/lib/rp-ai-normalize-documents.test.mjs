import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRecord,
  normalizePublicListing,
  normalizeOwnerListing,
  normalizeListingRevision,
  normalizeOboOfferSummary,
  normalizeAuctionBidSummary,
  normalizeNotification,
  normalizeMessage,
  extractNotificationEntityMetadata,
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

  const listingUuid = '11111111-1111-4111-8111-111111111111';
  const recordUuid = '22222222-2222-4222-8222-222222222222';
  const offerUuid = '33333333-3333-4333-8333-333333333333';
  const auctionUuid = '44444444-4444-4444-8444-444444444444';
  const bidUuid = '55555555-5555-4555-8555-555555555555';

  it('notification entity metadata — listing_id snake_case', () => {
    const meta = extractNotificationEntityMetadata({ listing_id: listingUuid });
    assert.equal(meta.listing_id, listingUuid);
    assert.equal(meta.record_id, undefined);
  });

  it('notification entity metadata — listingId camelCase', () => {
    const meta = extractNotificationEntityMetadata({ listingId: listingUuid });
    assert.equal(meta.listing_id, listingUuid);
  });

  it('notification entity metadata — record_id', () => {
    const meta = extractNotificationEntityMetadata({ record_id: recordUuid });
    assert.equal(meta.record_id, recordUuid);
  });

  it('notification entity metadata — offer id variants', () => {
    assert.equal(extractNotificationEntityMetadata({ offer_id: offerUuid }).offer_id, offerUuid);
    assert.equal(extractNotificationEntityMetadata({ offerId: offerUuid }).offer_id, offerUuid);
    assert.equal(extractNotificationEntityMetadata({ obo_offer_id: offerUuid }).offer_id, offerUuid);
  });

  it('notification entity metadata — auction and bid ids', () => {
    const meta = extractNotificationEntityMetadata({
      context_type: 'auction',
      listing_id: auctionUuid,
      bid_id: bidUuid,
    });
    assert.equal(meta.listing_id, auctionUuid);
    assert.equal(meta.auction_id, auctionUuid);
    assert.equal(meta.bid_id, bidUuid);
  });

  it('notification entity metadata — no entity ids', () => {
    assert.deepEqual(extractNotificationEntityMetadata({ source: 'kafka.test' }), {});
  });

  it('notification normalize preserves existing metadata and excludes body text', () => {
    const doc = normalizeNotification({
      id: 'n1',
      user_id: 'u1',
      event_type: 'OfferReceived',
      channel: 'push',
      status: 'sent',
      payload: {
        listing_id: listingUuid,
        offer_id: offerUuid,
        body: 'SECRET BODY TEXT',
        message: 'SECRET MESSAGE',
        title: 'Offer title',
      },
      created_at: now,
    });
    assert.equal(doc.metadata.event_type, 'OfferReceived');
    assert.equal(doc.metadata.channel, 'push');
    assert.equal(doc.metadata.status, 'sent');
    assert.equal(doc.metadata.listing_id, listingUuid);
    assert.equal(doc.metadata.offer_id, offerUuid);
    assert.ok(!JSON.stringify(doc.metadata).includes('SECRET'));
    assert.ok(doc.normalized_text.includes(listingUuid));
  });
});
