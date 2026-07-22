/**
 * Kafka → market_event identity vs delivery lineage decisions (testable pure core).
 *
 * Identity is (source_event_id, normalization_version).
 * Delivery is (topic, partition, offset).
 */
export function classifyKafkaDelivery({
  existingIdentity = null,
  incomingPayloadHash,
  topic,
  partition,
  offset,
  existingDeliveryCoordinate = null,
} = {}) {
  const offsetKey = `${topic}:${partition}:${offset}`;
  if (existingDeliveryCoordinate && existingDeliveryCoordinate === offsetKey) {
    return {
      result: 'DUPLICATE_DELIVERY',
      reason: 'duplicate_offset_delivery',
      quarantine: false,
      create_identity: false,
      create_market_event: false,
    };
  }
  if (!existingIdentity) {
    return {
      result: 'ACCEPTED',
      reason: null,
      quarantine: false,
      create_identity: true,
      create_market_event: true,
    };
  }
  if (String(existingIdentity.canonical_payload_hash) === String(incomingPayloadHash)) {
    return {
      result: 'DUPLICATE_DELIVERY',
      reason: 'same_source_same_hash',
      quarantine: false,
      create_identity: false,
      create_market_event: false,
      market_event_id: existingIdentity.accepted_market_event_id || null,
    };
  }
  return {
    result: 'IDENTITY_PAYLOAD_CONFLICT',
    reason: 'same_source_different_hash',
    quarantine: true,
    create_identity: false,
    create_market_event: false,
    market_event_id: existingIdentity.accepted_market_event_id || null,
  };
}

/** @deprecated Prefer classifyKafkaDelivery — kept for older unit call sites. */
export function classifyKafkaSourceIdentity(args = {}) {
  const r = classifyKafkaDelivery({
    existingIdentity: args.existing
      ? {
          canonical_payload_hash: args.existing.payload_hash,
          accepted_market_event_id: args.existing.market_event_id || null,
        }
      : null,
    incomingPayloadHash: args.incomingPayloadHash,
    topic: args.topic,
    partition: args.partition,
    offset: args.offset,
    existingDeliveryCoordinate: args.existingOffsetKey || null,
  });
  return {
    result: r.result === 'DUPLICATE_DELIVERY' ? 'DUPLICATE' : r.result,
    reason: r.reason,
    quarantine: r.quarantine,
  };
}
