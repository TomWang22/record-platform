/**
 * Match scripts/lib/rp-kafka-event-topics-from-proto.sh + rpKafkaTopicIsolationSuffix().
 */
export declare function topicSuffixFromEnv(raw: string | undefined): string;
/**
 * - messaging → messaging.events.v1 (no prefix/suffix)
 * - others → `${prefix}.${stem}.events${suf}`
 * - plus booking.events.v1 and messaging.dlq
 */
export declare function buildExpectedTopics(protoNames: string[], envPrefix: string, suf: string): string[];
