/**
 * Repo root when this package is at tools/kafka-contract/{src,dist} (three levels below root).
 */
export declare function resolveOchRepoRoot(moduleUrl: string): string;
/**
 * Proto events dir: KAFKA_CONTRACT_PROTO_ROOT (absolute) wins; else PROTO_ROOT relative to repo (default proto/events).
 */
export declare function resolveProtoEventsDir(repoRoot: string): string;
/**
 * Basenames of proto/events/*.proto (excluding envelope.proto), sorted.
 */
export declare function scanProtoEvents(protoRoot: string): string[];
