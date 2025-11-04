# file: scripts/probe-ingress-direct.sh  (robust: waits, prints result)
#!/usr/bin/env bash
set -euo pipefail
NS=ingress-nginx
SVC=${SVC:-ingress-nginx-controller}

kubectl -n "$NS" get svc "$SVC" -o wide
IP=$(kubectl -n "$NS" get svc "$SVC" -o jsonpath='{.spec.clusterIP}')
echo "Controller SVC IP=$IP"

kubectl -n "$NS" delete pod h3probe --ignore-not-found --now >/dev/null 2>&1 || true
kubectl -n "$NS" run h3probe --restart=Never --image=curlimages/curl -- \
  sh -lc "
    set -e;
    echo '== Ingress direct H2 ==';
    curl -sSkI --connect-timeout 5 --max-time 10 \
      --http2 --resolve record.local:443:$IP https://record.local/api/healthz | head -n1;
    echo '== Ingress direct H3 ==';
    curl -sSkI --connect-timeout 5 --max-time 10 \
      --http3-only --resolve record.local:443:$IP https://record.local/api/healthz | head -n1;
  " >/dev/null 2>&1 || true
# Wait up to 20s for the short-lived pod to run at least once, then get logs
for i in {1..20}; do
  if kubectl -n "$NS" logs h3probe >/dev/null 2>&1; then break; fi
  sleep 1
done
kubectl -n "$NS" logs h3probe || true
kubectl -n "$NS" delete pod h3probe --now >/dev/null 2>&1 || true

kubectl -n "$NS" delete pod tlscheck --ignore-not-found --now >/dev/null 2>&1 || true
kubectl -n "$NS" run tlscheck --restart=Never --image=alpine:3 -- \
  sh -lc "apk add -q --no-cache openssl >/dev/null 2>&1; \
          echo | openssl s_client -connect ${IP}:443 -servername record.local 2>/dev/null \
          | openssl x509 -noout -subject -issuer -dates" >/dev/null 2>&1 || true
for i in {1..20}; do
  if kubectl -n "$NS" logs tlscheck >/dev/null 2>&1; then break; fi
  sleep 1
done
kubectl -n "$NS" logs tlscheck || true
kubectl -n "$NS" delete pod tlscheck --now >/dev/null 2>&1 || true