/**
 * Kafka → market_event identity conflict decisions (testable pure core).
 */
export function classifyKafkaSourceIdentity({
  existing = null,
  incomingPayloadHash,
  topic,
  partition,
  offset,
  existingOffsetKey = null,
} = {}) {
  const offsetKey = `${topic}:${partition}:${offset}`;
  if (existingOffsetKey && existingOffsetKey === offsetKey) {
    return { result: 'DUPLICATE', reason: 'duplicate_offset_delivery', quarantine: false };
  }
  if (!existing) {
    return { result: 'ACCEPTED', reason: null, quarantine: false };
  }
  if (String(existing.payload_hash) === String(incomingPayloadHash)) {
    return { result: 'DUPLICATE', reason: 'same_source_same_hash', quarantine: false };
  }
  return {
    result: 'IDENTITY_PAYLOAD_CONFLICT',
    reason: 'same_source_different_hash',
    quarantine: true,
  };
}
