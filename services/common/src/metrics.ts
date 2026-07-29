import client, { type OpenMetricsContentType } from "prom-client";

/** OpenMetrics so Histograms may attach trace_id exemplars (Prometheus 2.26+ scrape + exemplar storage). */
export const register = new client.Registry<OpenMetricsContentType>();
register.setContentType(client.Registry.OPENMETRICS_CONTENT_TYPE);
client.collectDefaultMetrics({ register });
export const httpCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'HTTP requests',
  labelNames: ['service','route','method','code','proto']
})
register.registerMetric(httpCounter)

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['service', 'route', 'method', 'code', 'proto'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
})
register.registerMetric(httpRequestDurationSeconds)

/** Bounded build provenance (no pod UID in labels). */
export const rpBuildInfo = new client.Gauge({
  name: "rp_build_info",
  help: "Record Platform build provenance (value always 1)",
  labelNames: ["service", "source_sha", "image_tag", "image_digest"],
});
register.registerMetric(rpBuildInfo);

export function setRpBuildInfoMetric(service: string): void {
  rpBuildInfo
    .labels(
      service,
      (process.env.RP_SOURCE_SHA || "unknown").slice(0, 40),
      (process.env.RP_IMAGE_TAG || process.env.IMAGE_TAG || "unknown").slice(0, 64),
      (process.env.RP_IMAGE_DIGEST || "unknown").slice(0, 72),
    )
    .set(1);
}

/**
 * Bounded peer-authorization decisions (no caller identity / fingerprint / request-id labels).
 * reason is a low-cardinality enum from grpc-peer-auth.
 */
export const rpGrpcPeerAuthorizationTotal = new client.Counter({
  name: "rp_grpc_peer_authorization_total",
  help: "gRPC peer authorization decisions (mTLS service-call graph)",
  labelNames: ["target_service", "rpc_service", "rpc_method", "decision", "reason"],
});
register.registerMetric(rpGrpcPeerAuthorizationTotal);
