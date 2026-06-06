# Bundle classification summary (controlled conversion sweep)

**Generated:** 2026-04-19 00:54 UTC

Deterministic sweep: explicit `~/` tarballs → Protocol v1 → `och_to_rp_rewrite_scan.py`.
No repo or staging content was auto-rewritten.

| Archive stem | Category | OCH scan hits (text) | Notes |
|--------------|----------|----------------------:|-------|
| `kafka-kraft-3broker-chaos-suite-bundle-20260418-022748` | OCH-configured (substantial rewrites likely) | 280 |  |
| `och-preflight-cluster-stability-jaeger-transport-bundle-20260418-011502` | OCH-configured (substantial rewrites likely) | 285 |  |
| `preflight-cluster-quic-scripts-20260418-165316` | OCH-configured (substantial rewrites likely) | 966 | Superseded for QUIC closure comparison by `preflight-cluster-quic-scripts-20260418-165415`. |
| `preflight-cluster-quic-scripts-20260418-165326` | OCH-configured (substantial rewrites likely) | 965 | Superseded for QUIC closure comparison by `preflight-cluster-quic-scripts-20260418-165415`. |
| `preflight-cluster-quic-scripts-20260418-165415` | OCH-configured (substantial rewrites likely) | 972 |  |
| `record-platform-final-vitest-kafka-event-layer-chaos-golden-20260410` | Golden snapshot | 1665 |  |
| `record-platform-kafka-kraft-3broker-kafka-certs-20260410` | Mostly RP-native (few OCH remnants) | 6 |  |
| `record-platform-kafka-metallb-tls-reference-20260409` | OCH-configured (substantial rewrites likely) | 352 |  |
| `record-platform-kafka-observability-proto-reference-20260410` | OCH-configured (substantial rewrites likely) | 489 |  |
| `record-platform-kafka-ops-certs-alignment-cron-preflight-20260410` | OCH-configured (substantial rewrites likely) | 700 |  |
| `record-platform-makefile-golden-snapshot-kafka-chaos-20260410` | Packaging-heavy / golden Makefile tree | 734 |  |
| `record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410` | OCH-configured (substantial rewrites likely) | 32 |  |
| `record-platform-och-full-scripts-infra-reference-20260410-1245` | OCH-configured (substantial rewrites likely) | 1791 |  |
| `record-platform-och-preflight-cert-kafka-bundle-20260418-025117` | OCH-configured (substantial rewrites likely) | 876 |  |
| `record-platform-och-preflight-kafka-kraft-certs-caddy-reference-20260409` | OCH-configured (substantial rewrites likely) | 2295 |  |
| `record-platform-och-preflight-scale-transport-v7b-20260418-011819` | OCH-configured (substantial rewrites likely) | 139 |  |
| `record-platform-och-transport-watchdog-preflight-kafka-mesh-full-scripts-reference-20260410` | OCH-configured (substantial rewrites likely) | 2333 |  |
| `record-platform-och-vitest-playwright-event-layer-analytics-reference-20260409` | OCH-configured (substantial rewrites likely) | 316 |  |
| `record-platform-quic-transport-porting-bundle-20260416-192801` | OCH-configured (substantial rewrites likely) | 13 |  |
| `record.test-och-housing-20260418-161510` | OCH-configured (substantial rewrites likely) | 292 |  |

## Category meanings

| Category | Meaning |
|----------|---------|
| RP-native (no OCH strings in scanned text) | Scanned text files show no OCH namespace/SNI/och-* tokens in this pass. |
| Mostly RP-native | Few hits; likely cosmetic or isolated docs. |
| OCH-configured | Many hits; expect namespace/SNI/secret rewrites using the conversion matrix. |
| Golden snapshot | Large combined reference tree — not a wholesale import target. |
| Packaging-heavy / golden Makefile tree | Makefile / chaos / golden packaging — usually ignore except targeted scripts. |

## Related outputs

- `OCH_TO_RP_REWRITE_<stem>.md` — per-bundle hit mapping
- `OCH_TO_RP_PATCH_<stem>.patch` — unified diff from matrix (review; never auto-applied)
- `BUNDLE_ANALYSIS_<stem>.md` — parity + buckets
- `INTEGRITY_<stem>.json` / `CHECKSUM_RECORD_<stem>.txt` — protocol artifacts
- `OCH_TO_RP_CONVERSION_MATRIX.md` — canonical string replacements

