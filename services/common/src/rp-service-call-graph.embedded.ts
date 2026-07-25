// Auto-synced from infra/contracts/rp-service-call-graph.json — do not edit by hand.
export const EMBEDDED_SERVICE_CALL_GRAPH = {
  "version": 1,
  "servers": {
    "auth-service": {
      "allowedCallers": ["api-gateway", "listings-service", "shopping-service", "messaging-service", "trust-service", "notification-service", "media-service", "records-service", "analytics-service", "auction-monitor", "python-ai-service", "envoy-client"]
    },
    "records-service": {
      "allowedCallers": ["api-gateway", "listings-service", "shopping-service", "analytics-service", "media-service", "python-ai-service", "envoy-client"]
    },
    "listings-service": {
      "allowedCallers": ["api-gateway", "shopping-service", "auction-monitor", "analytics-service", "messaging-service", "media-service", "python-ai-service", "envoy-client"]
    },
    "shopping-service": {
      "allowedCallers": ["api-gateway", "listings-service", "auction-monitor", "notification-service", "analytics-service", "envoy-client"]
    },
    "auction-monitor": {
      "allowedCallers": ["api-gateway", "listings-service", "shopping-service", "analytics-service", "envoy-client"]
    },
    "messaging-service": {
      "allowedCallers": ["api-gateway", "notification-service", "listings-service", "trust-service", "envoy-client"]
    },
    "notification-service": {
      "allowedCallers": ["api-gateway", "messaging-service", "shopping-service", "trust-service", "auction-monitor", "envoy-client"]
    },
    "media-service": {
      "allowedCallers": ["api-gateway", "listings-service", "records-service", "python-ai-service", "envoy-client"]
    },
    "trust-service": {
      "allowedCallers": ["api-gateway", "messaging-service", "notification-service", "listings-service", "shopping-service", "envoy-client"]
    },
    "analytics-service": {
      "allowedCallers": ["api-gateway", "listings-service", "shopping-service", "auction-monitor", "python-ai-service", "envoy-client"]
    },
    "python-ai-service": {
      "allowedCallers": ["api-gateway", "analytics-service", "listings-service", "media-service", "envoy-client"]
    }
  },
  "healthAndReflectionBypass": true
} as const;
