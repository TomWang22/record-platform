# Service memory budget (Colima / dev cluster)

Defaults target a **minimal bootstrap** without blowing Colima RAM.

## Env knobs (Makefile / `.env`)

| Variable | Default | Meaning |
|----------|---------|---------|
| `RP_ENABLE_OLLAMA` | `0` | Ollama gateway/worker off |
| `RP_ENABLE_ANALYTICS_AI` | `0` | Analytics AI features off |
| `RP_ENABLE_HEAVY_OBS` | `0` | Heavy observability sidecars off |
| `RP_MINIMAL_BOOTSTRAP` | `1` | Skip optional heavy services |

## Per-deployment requests / limits

| Deployment | Request | Limit |
|------------|---------|-------|
| messaging-service | 64Mi / 50m | 256Mi / 500m |
| media-service | 64Mi / 50m | 256Mi / 500m |
| trust-service | 64Mi / 50m | 256Mi / 500m |
| notification-service | 64Mi / 50m | 256Mi / 500m |
| analytics-service | 128Mi / 100m | 512Mi / 750m |
| ollama-gateway / worker | disabled unless `RP_ENABLE_OLLAMA=1` | conservative if enabled |
| transport-watchdog | tiny (32Mi / 25m) | 64Mi / 100m |

Apply in `infra/k8s/base/*/deployment.yaml` for each ported service.

## Bootstrap order

1. Hybrid backup validate
2. Core: auth, records, listings, shopping
3. Platform: media, messaging, trust, notification
4. Optional: analytics, ollama (explicit enable)

## Not deployed

- reservation-mesh
- housing-specific cron/jobs
