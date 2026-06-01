import {
  AUTH_GRPC_TARGET,
  AUTH_HTTP_TARGET,
  RECORDS_GRPC_TARGET,
  RECORDS_HTTP_TARGET,
  LISTINGS_GRPC_TARGET,
  LISTINGS_HTTP_TARGET,
  SHOPPING_GRPC_TARGET,
  SHOPPING_HTTP_TARGET,
  MESSAGING_HTTP_TARGET,
  MESSAGING_GRPC_TARGET,
  MEDIA_HTTP_TARGET,
  MEDIA_GRPC_TARGET,
  TRUST_HTTP_TARGET,
  TRUST_GRPC_TARGET,
  NOTIFICATION_HTTP_TARGET,
  NOTIFICATION_GRPC_TARGET,
  ANALYTICS_HTTP_TARGET,
  ANALYTICS_GRPC_TARGET,
  PYTHON_AI_HTTP_TARGET,
  PYTHON_AI_GRPC_TARGET,
  AUCTION_MONITOR_HTTP_TARGET,
  AUCTION_MONITOR_GRPC_TARGET,
} from "./service-targets.js";

export type GatewayRouteGroup = {
  id: string;
  httpTarget: string;
  grpcTarget?: string;
  routePrefixes: string[];
  publicHealthPaths?: string[];
};

/** Canonical RP gateway route groups for audits, /readyz, and tests. */
export const GATEWAY_ROUTE_MANIFEST: GatewayRouteGroup[] = [
  {
    id: "auth",
    httpTarget: AUTH_HTTP_TARGET,
    grpcTarget: AUTH_GRPC_TARGET,
    routePrefixes: ["/auth", "/api/auth"],
    publicHealthPaths: ["/auth/healthz", "/auth/metrics"],
  },
  {
    id: "records",
    httpTarget: RECORDS_HTTP_TARGET,
    grpcTarget: RECORDS_GRPC_TARGET,
    routePrefixes: ["/records"],
    publicHealthPaths: ["/records/healthz", "/records/metrics"],
  },
  {
    id: "listings",
    httpTarget: LISTINGS_HTTP_TARGET,
    grpcTarget: LISTINGS_GRPC_TARGET,
    routePrefixes: ["/listings", "/api/listings"],
    publicHealthPaths: ["/listings/healthz", "/listings/cache/stats"],
  },
  {
    id: "shopping",
    httpTarget: SHOPPING_HTTP_TARGET,
    grpcTarget: SHOPPING_GRPC_TARGET,
    routePrefixes: [
      "/cart",
      "/orders",
      "/history",
      "/resell",
      "/returns",
      "/shopping",
      "/api/resell",
    ],
    publicHealthPaths: ["/shopping/cache/stats"],
  },
  {
    id: "messaging",
    httpTarget: MESSAGING_HTTP_TARGET,
    grpcTarget: MESSAGING_GRPC_TARGET,
    routePrefixes: [
      "/messaging",
      "/api/messaging",
      "/community",
      "/api/community",
      "/threads",
      "/conversations",
      "/messages",
      "/api/messages",
      "/api/forum",
    ],
  },
  {
    id: "media",
    httpTarget: MEDIA_HTTP_TARGET,
    grpcTarget: MEDIA_GRPC_TARGET,
    routePrefixes: ["/media", "/api/media", "/uploads", "/assets"],
  },
  {
    id: "trust",
    httpTarget: TRUST_HTTP_TARGET,
    grpcTarget: TRUST_GRPC_TARGET,
    routePrefixes: [
      "/trust",
      "/api/trust",
      "/reputation",
      "/verification",
      "/moderation",
    ],
  },
  {
    id: "notification",
    httpTarget: NOTIFICATION_HTTP_TARGET,
    grpcTarget: NOTIFICATION_GRPC_TARGET,
    routePrefixes: [
      "/notifications",
      "/notification",
      "/api/notification",
      "/preferences/notifications",
    ],
  },
  {
    id: "analytics",
    httpTarget: ANALYTICS_HTTP_TARGET,
    grpcTarget: ANALYTICS_GRPC_TARGET,
    routePrefixes: ["/analytics", "/api/analytics"],
    publicHealthPaths: ["/analytics/healthz"],
  },
  {
    id: "python-ai",
    httpTarget: PYTHON_AI_HTTP_TARGET,
    grpcTarget: PYTHON_AI_GRPC_TARGET,
    routePrefixes: ["/ai", "/api/ai"],
    publicHealthPaths: ["/ai/healthz"],
  },
  {
    id: "auction-monitor",
    httpTarget: AUCTION_MONITOR_HTTP_TARGET,
    grpcTarget: AUCTION_MONITOR_GRPC_TARGET,
    routePrefixes: ["/auctions", "/auction-monitor"],
    publicHealthPaths: ["/auctions/healthz"],
  },
];

export const ACTIVE_GATEWAY_SERVICE_IDS = GATEWAY_ROUTE_MANIFEST.map((g) => g.id);
