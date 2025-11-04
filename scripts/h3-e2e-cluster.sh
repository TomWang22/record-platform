# file: scripts/h3-e2e-cluster.sh  (cluster-side: Caddy VIP & ingress direct)
#!/usr/bin/env bash
set -euo pipefail
NS=ingress-nginx
VIP=$(kubectl -n "$NS" get svc caddy-h3 -o jsonpath='{.spec.clusterIP}')
echo "Caddy VIP=$VIP"
kubectl -n "$NS" delete pod h3test --ignore-not-found --now >/dev/null 2>&1 || true

# 1) Through Caddy VIP with Host override
kubectl -n "$NS" run h3test --restart=Never --image=curlimages/curl -- \
  sh -lc "
    set -e
    echo '== In-cluster via Caddy VIP (H2) ==';
    curl -sSkI --http2      --resolve record.local:443:$VIP https://record.local/api/healthz | head -n1;
    echo '== In-cluster via Caddy VIP (H3) ==';
    curl -sSkI --http3-only --resolve record.local:443:$VIP https://record.local/api/healthz | head -n1;
  "
kubectl -n "$NS" logs h3test || true
kubectl -n "$NS" delete pod h3test --now >/dev/null 2>&1 || true

# 2) Direct to ingress service:443 with SNI=record.local (bypasses Caddy)
kubectl -n "$NS" run tlscheck --restart=Never --image=alpine/openssl -- \
  sh -lc "
    apk add -q --no-cache openssl >/dev/null 2>&1 || true;
    echo | openssl s_client -connect ingress-ingress-nginx-controller.ingress-nginx.svc.cluster.local:443 -servername record.local 2>/dev/null \
      | openssl x509 -noout -subject -issuer -dates;
  "
kubectl -n "$NS" logs tlscheck || true
kubectl -n "$NS" delete pod tlscheck --now >/dev/null 2>&1 || true
