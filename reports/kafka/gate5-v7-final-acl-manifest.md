# Gate 5 v7 — final ACL manifest (apply deferred)

**apply_authorized = false** — authorizer not enabled.

Principals use exact Kafka DN form `User:O=Record Platform,CN=<service>`.

| Service | Principal | Produce | Consume | Groups |
|---|---|---|---|---|
| analytics-service | `User:O=Record Platform,CN=analytics-service` | dev.analytics.events | — | — |
| auction-monitor | `User:O=Record Platform,CN=auction-monitor` | auctions.events, dev.auction_monitor.events | — | — |
| auth-service | `User:O=Record Platform,CN=auth-service` | dev.auth.events, dev.user.lifecycle.v1 | — | — |
| listings-service | `User:O=Record Platform,CN=listings-service` | dev.listing.events | — | — |
| media-service | `User:O=Record Platform,CN=media-service` | — | dev.user.lifecycle.v1 | media-service-user-lifecycle |
| messaging-service | `User:O=Record Platform,CN=messaging-service` | dev.messaging.dlq, messaging.events.v1 | dev.user.lifecycle.v1 | messaging-service-user-lifecycle |
| notification-service | `User:O=Record Platform,CN=notification-service` | — | dev.notification.events, dev.user.lifecycle.v1 | notification-service-group, notification-service-user-lifecycle |
| python-ai-service | `User:O=Record Platform,CN=python-ai-service` | dev.ai.events | analytics-predictions, analytics-searches | python-ai-service |
| shopping-service | `User:O=Record Platform,CN=shopping-service` | dev.shopping.events | — | — |
| trust-service | `User:O=Record Platform,CN=trust-service` | — | dev.user.lifecycle.v1 | trust-service-user-lifecycle |
| ollama-gateway | `User:O=Record Platform,CN=ollama-gateway` | ollama-jobs | — | — |
| ollama-worker | `User:O=Record Platform,CN=ollama-worker` | — | ollama-jobs | ollama-worker-group |
