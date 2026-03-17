# Blue/Green Caddy for Zero-Downtime QUIC Rotation

Two deployments (caddy-a, caddy-b) and one Service (`caddy-h3`) whose selector switches between them. No in-place reload; no QUIC session invalidation.

## Layout

| Resource       | Purpose |
|----------------|---------|
| `caddy-a-deploy.yaml` | Active or standby; uses secret `record-local-tls` (or `record-local-tls-a`). |
| `caddy-b-deploy.yaml` | Standby or active; uses secret `record-local-tls-b`. |
| `caddy-service-bluegreen.yaml` | Service `caddy-h3` with selector `app: caddy-h3, version: a`. Change to `version: b` to switch. |

Both deployments use the same ConfigMap `caddy-h3` (Caddyfile) and image. Only the **secret** (leaf cert) and the **version** label differ.

## Prerequisites

- Namespace `ingress-nginx` exists.
- ConfigMap `caddy-h3` (Caddyfile) and secret `dev-root-ca` exist.
- Secret `record-local-tls` exists (current leaf). For B you will create `record-local-tls-b` with the new leaf.

## Apply (first time)

1. Ensure current leaf secret exists: `record-local-tls` in `ingress-nginx`.
2. Create secret for B (copy of current, or new leaf):  
   `kubectl -n ingress-nginx create secret tls record-local-tls-b --cert=path/to/tls.crt --key=path/to/tls.key`  
   (Or copy from existing: `kubectl -n ingress-nginx get secret record-local-tls -o yaml | sed 's/record-local-tls/record-local-tls-b/' | sed 's/name: record-local-tls/name: record-local-tls-b/' | kubectl apply -f -`.)
3. Apply deployments and service:  
   `kubectl apply -f infra/k8s/caddy-bluegreen/caddy-a-deploy.yaml`  
   `kubectl apply -f infra/k8s/caddy-bluegreen/caddy-b-deploy.yaml`  
   `kubectl apply -f infra/k8s/caddy-bluegreen/caddy-service-bluegreen.yaml`
4. Service selector is `version: a`. So only caddy-a receives traffic. Wait for caddy-a to be Ready.

## Zero-drop rotation (switch to new leaf)

1. **Issue new leaf** (e.g. with your CA; same SANs as current).
2. **Create or replace secret for B:**  
   `kubectl -n ingress-nginx create secret tls record-local-tls-b --cert=new-leaf.crt --key=new-leaf.key --dry-run=client -o yaml | kubectl apply -f -`
3. **Rollout caddy-b** (pods pick up new secret):  
   `kubectl -n ingress-nginx rollout restart deployment/caddy-b`  
   `kubectl -n ingress-nginx rollout status deployment/caddy-b --timeout=120s`
4. **Readiness gate:** Wait until B has endpoints:  
   `kubectl -n ingress-nginx get endpoints caddy-h3 -o jsonpath='{.subsets[*].addresses[*].ip}'`  
   (Should show B’s pod IPs after selector switch.)
5. **Switch Service to B:**  
   `kubectl -n ingress-nginx patch svc caddy-h3 -p '{"spec":{"selector":{"app":"caddy-h3","version":"b"}}}'`
6. **Drain A (optional):** Wait `grace_period + shutdown_delay` (e.g. 25s) so existing QUIC connections to A drain. Then scale A to 0:  
   `kubectl -n ingress-nginx scale deployment/caddy-a --replicas=0`
7. **Next rotation:** Put next leaf in `record-local-tls-a`, rollout caddy-a, switch selector to `version: a`, scale caddy-b to 0. Alternate.

## Timings (zero-drop QUIC)

| Step              | Recommended | Notes |
|-------------------|------------|-------|
| After patch secret for B | — | B rollout starts. |
| Wait rollout status      | 60–120s    | B pods Ready. |
| Wait endpoints           | 5–10s      | Service endpoints updated after selector switch. |
| Switch selector to B     | —          | Traffic moves to B. |
| Drain A                  | 25s+       | grace_period 15s + shutdown_delay 10s in Caddyfile. |
| Scale A to 0             | —          | Optional; or leave A for next rotation. |

See **docs/ZERO_DROP_QUIC_ROTATION.md** for the exact sequence and timings.

## Revert to single deployment

To go back to the single `caddy-h3` deployment:

1. Apply the original Caddy deploy and service (e.g. `infra/k8s/caddy-h3-deploy.yaml` and your existing caddy-h3 Service).
2. Delete blue/green deployments:  
   `kubectl -n ingress-nginx delete deploy caddy-a caddy-b`
