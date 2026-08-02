# Gate 5 v7 — migration rollout RCA (four services)

**Blind restarts = 0. Authorizer was absent (not an ACL failure).**

| Service | Classification | Recovered | Leaf match |
|---|---|---|---|
| analytics-service | ROLLOUT_CONVERGENCE_DELAY (+ API timeout) | yes | yes |
| listings-service | ROLLOUT_CONVERGENCE_DELAY (+ API timeout) | yes | yes |
| python-ai-service | ROLLOUT_CONVERGENCE_DELAY (+ API timeout) | yes | yes |
| shopping-service | ROLLOUT_CONVERGENCE_DELAY (+ API timeout) | yes | yes |

All four now Ready 1/1 with dedicated `kafka-client-tls-*` mounts, clientAuth-only leaves, SPIFFE SAN, key/leaf match.
