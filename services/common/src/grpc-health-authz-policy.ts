/**
 * Health/Check authorization policy (Gate 3).
 *
 * Status: NOT_APPLICABLE_WITH_RATIONALE as proof of a permitted *business* edge.
 *
 * Policy: when `healthAndReflectionBypass !== false` (platform default),
 * `/grpc.health.v1.Health/Check|Watch` and reflection methods bypass *service
 * authorization* only.
 *
 * Trust boundary:
 * - Transport mTLS remains required (`ServerCredentials.createSsl(..., true)`).
 * - Exemption does not admit plaintext or unauthenticated TLS peers.
 * - Permitted network origin: cluster-internal service mesh / pod network only.
 *
 * Why safe:
 * - Health returns SERVING/NOT_SERVING only; no business mutation or data read.
 * - Attack surface is readiness signalling, not product RPCs.
 *
 * Positive business proof must use a real permitted RPC (e.g. ValidateToken).
 */
export const RP_GRPC_HEALTH_AUTHZ_POLICY = {
  status: "NOT_APPLICABLE_WITH_RATIONALE",
  authorization_exempt: true,
  transport_mtls_still_required: true,
  business_edge_proof: "use permitted business RPC, never Health/Check",
} as const;
