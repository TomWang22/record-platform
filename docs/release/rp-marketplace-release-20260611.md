# Record Platform marketplace release 20260611

Generated: 2026-06-11T21:04:59Z

## Release identity

| Field | Value |
|-------|-------|
| Main SHA | `2fd3029a814547dc3d541af068468874153bab42` |
| Short SHA | `2fd3029a8145` |
| Edge hostname | `record-platform.test` |
| Caddy LB IP | `192.168.64.244` |
| Tag | `rp-marketplace-release-20260611` |

## Image IDs (running pods)

| Service | Pod image ID |
|---------|--------------|
| webapp | `docker-pullable://webapp@sha256:5a5c74c8073c5e27dfc33ff8a6428806c0d361d98b13b190d33cb811783abffe` |
| api-gateway | `docker-pullable://api-gateway@sha256:65a8b7ab8825b4d6c283a041df2d31bb12b79aaa3b87be0fc0882180e474e45f` |
| listings-service | `docker-pullable://listings-service@sha256:2466fe35e6219a408562e125558bb74b196188cae249bd870c6a24e81562233c` |
| shopping-service | `docker-pullable://shopping-service@sha256:9dfc12bcde082b6fdabb6967c4dca13e305a091d982d87a1c08395c77c08cf02` |
| messaging-service | `docker-pullable://messaging-service@sha256:d6568619ea6b6e93f6cb4f9592b899c6bc6752ee8d455fdeab9b94b8979da465` |
| notification-service | `docker-pullable://notification-service@sha256:fa380cd3f2668436658224e16e086560b188ad72cc1d69f6f470fe2a7c55a841` |
| records-service | `docker-pullable://records-service@sha256:6a65cc652d0a67a1c0378f70085776d5858f40af8a22905f7853387f0d53fa31` |
| trust-service | `docker-pullable://trust-service@sha256:b8fa61f3dd951a12c5ee788637c16c05fabd7c42cc88559816b52d3d874d60de` |
| analytics-service | `docker-pullable://analytics-service@sha256:3ab78e30024ce2bb80d0e5884b8baf86dec917b95462f02740e15c5167992d5c` |
| media-service | `docker-pullable://media-service@sha256:0ae5b68aea3fc6c2c0d84a75b80e1a755a5e8309f38510f4b2c78123f8105894` |
| auth-service | `docker-pullable://auth-service@sha256:2b014539a9fc8434c19c481a2afe95aa5fc30ac9800874ef3924c0bf332cce8c` |
| auction-monitor | `docker-pullable://auction-monitor@sha256:6a07227c17e44179edf78e25c0bcd094b3c892921bab8f44260c40ef9021944c` |
| python-ai-service | `docker-pullable://python-ai-service@sha256:3f3156f62df76b529b604f537355ee4292266e34eaf700cf4954d0cbe482082d` |

## Infrastructure status

| Component | Status |
|-----------|--------|
| Cert chain | PASS (dev-chain + kafka broker keystore) |
| Kafka brokers | PASS (brokers ready, :9093 open) |
| Redis Lua runtime | PASS (Lua runtime contract) |
| 11 DB backup | `/Users/tom/record-platform/backups/rp-all-11-20260610-112429` |

## Quality gates (Phase 13 baseline / T14.4)

| Gate | Result |
|------|--------|
| Playwright | 247 passed, 0 failed, 1 skipped, 0 retries |
| Screenshot strict | 176 PNGs PASS |
| Cluster doctor | 100/100 |

## Rollback

```bash
# Git revert release commit
git revert 2fd3029a814547dc3d541af068468874153bab42

# Kubernetes image rollback (per deployment)
kubectl -n record-platform rollout undo deployment/api-gateway
kubectl -n record-platform rollout undo deployment/auth-service
kubectl -n record-platform rollout undo deployment/records-service
kubectl -n record-platform rollout undo deployment/listings-service
kubectl -n record-platform rollout undo deployment/shopping-service
kubectl -n record-platform rollout undo deployment/messaging-service
kubectl -n record-platform rollout undo deployment/media-service
kubectl -n record-platform rollout undo deployment/trust-service
kubectl -n record-platform rollout undo deployment/notification-service
kubectl -n record-platform rollout undo deployment/analytics-service
kubectl -n record-platform rollout undo deployment/python-ai-service
kubectl -n record-platform rollout undo deployment/auction-monitor
kubectl -n record-platform rollout undo deployment/transport-watchdog
kubectl -n record-platform rollout undo deployment/webapp
```
