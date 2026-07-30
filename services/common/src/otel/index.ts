export {
  assertNoForbiddenLocalhostOtlpEnv,
  assertNoForbiddenLocalhostOtlpUrl,
  DEFAULT_K8S_JAEGER_OTLP_HTTP_BASE,
  initTracing,
  startNodeTelemetry,
  startTracing,
  type StartNodeTelemetryOptions,
} from "./start-telemetry.js";
export {
  createHttpTracingMiddleware,
  traceIncomingHttpRequest,
  tracingMiddleware,
} from "./http-tracing-middleware.js";
export {
  buildOutgoingHttpHeadersForIncomingMessage,
  buildOutgoingHttpHeadersFromContext,
  buildOutgoingHttpHeadersWithTrace,
  getIncomingHttpOtelContext,
  injectTraceContextIntoClientRequest,
  tracedFetch,
  type TracedFetchInit,
} from "./outgoing-http-propagation.js";
export { buildDebugTraceHeadersPayload, mountDebugTraceHeaders, writeDebugTraceHeadersJson } from "./debug-trace-headers-handler.js";
export {
  createGrpcClientTracingInterceptor,
  tracingInterceptor,
} from "./grpc-client-interceptor.js";
export { createGrpcServerTracingInterceptor } from "./grpc-server-interceptor.js";
export { isRpTraceDebugLogEnabled, logTraceDebug } from "./trace-debug-log.js";
export {
  canonicalNetProtoFromEdgeHeader,
  decorateHttpSpanWithTransport,
  decorateIncomingMessageSpanWithTransport,
  edgeProtoFromIncomingMessage,
  edgeProtoFromRequestHeaders,
  inferNetProtoForSpan,
  inferNetProtoFromIncomingMessage,
  networkProtocolVersionFromEdge,
  normalizeEdgeProto,
  upstreamProtoFromExpressHop,
} from "./net-protocol.js";
export {
  buildKafkaMessageHeaders,
  extractKafkaMessageContext,
  extractTrace,
  injectTraceHeaders,
  startKafkaSpan,
  withKafkaConsumerSpan,
  withKafkaProduceSpan,
  type KafkaMessageHeaders,
} from "./kafka-propagation.js";
export {
  assertAllowedNamespaceKey,
  containsForbiddenNamespaceLiteral,
  FORBIDDEN_NAMESPACE_SHA256,
  requireAllowedNamespaceKey,
  type NamespaceDecision,
  type NamespaceKind,
} from "./namespace-integrity.js";
