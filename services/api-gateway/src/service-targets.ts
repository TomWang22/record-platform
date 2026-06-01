/**
 * RP runtime HTTP/gRPC upstream targets (infra/contracts/rp-service-runtime-contract.json).
 */
const NS = "record-platform.svc.cluster.local";

export const AUTH_HTTP_TARGET =
  process.env.AUTH_HTTP_TARGET ||
  `http://auth-service.${NS}:${process.env.AUTH_PORT || "4001"}`;

export const RECORDS_HTTP_TARGET =
  process.env.RECORDS_HTTP_TARGET || `http://records-service.${NS}:4002`;

export const LISTINGS_HTTP_TARGET =
  process.env.LISTINGS_HTTP_TARGET || `http://listings-service.${NS}:4012`;

export const SHOPPING_HTTP_TARGET =
  process.env.SHOPPING_HTTP_TARGET || `http://shopping-service.${NS}:4007`;

export const MEDIA_HTTP_TARGET =
  process.env.MEDIA_HTTP_TARGET || `http://media-service.${NS}:4018`;

export const MESSAGING_HTTP_TARGET =
  process.env.MESSAGING_HTTP_TARGET || `http://messaging-service.${NS}:4014`;

export const TRUST_HTTP_TARGET =
  process.env.TRUST_HTTP_TARGET || `http://trust-service.${NS}:4016`;

export const NOTIFICATION_HTTP_TARGET =
  process.env.NOTIFICATION_HTTP_TARGET || `http://notification-service.${NS}:4015`;

export const ANALYTICS_HTTP_TARGET =
  process.env.ANALYTICS_HTTP_TARGET || `http://analytics-service.${NS}:4017`;

export const PYTHON_AI_HTTP_TARGET =
  process.env.PYTHON_AI_HTTP_TARGET || `http://python-ai-service.${NS}:5005`;

export const AUCTION_MONITOR_HTTP_TARGET =
  process.env.AUCTION_MONITOR_HTTP_TARGET || `http://auction-monitor.${NS}:4008`;

export const AUTH_GRPC_TARGET =
  process.env.AUTH_GRPC_TARGET || `auth-service.${NS}:50061`;

export const RECORDS_GRPC_TARGET =
  process.env.RECORDS_GRPC_TARGET || `records-service.${NS}:50051`;

export const LISTINGS_GRPC_TARGET =
  process.env.LISTINGS_GRPC_TARGET || `listings-service.${NS}:50062`;

export const SHOPPING_GRPC_TARGET =
  process.env.SHOPPING_GRPC_TARGET || `shopping-service.${NS}:50058`;

export const AUCTION_MONITOR_GRPC_TARGET =
  process.env.AUCTION_MONITOR_GRPC_TARGET || `auction-monitor.${NS}:50059`;

export const PYTHON_AI_GRPC_TARGET =
  process.env.PYTHON_AI_GRPC_TARGET || `python-ai-service.${NS}:50060`;

export const MESSAGING_GRPC_TARGET =
  process.env.MESSAGING_GRPC_TARGET || `messaging-service.${NS}:50064`;

export const MEDIA_GRPC_TARGET =
  process.env.MEDIA_GRPC_TARGET || `media-service.${NS}:50068`;

export const TRUST_GRPC_TARGET =
  process.env.TRUST_GRPC_TARGET || `trust-service.${NS}:50066`;

export const NOTIFICATION_GRPC_TARGET =
  process.env.NOTIFICATION_GRPC_TARGET || `notification-service.${NS}:50065`;

export const ANALYTICS_GRPC_TARGET =
  process.env.ANALYTICS_GRPC_TARGET || `analytics-service.${NS}:50067`;
