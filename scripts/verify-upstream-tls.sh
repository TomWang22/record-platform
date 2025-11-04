# file: scripts/verify-upstream-tls.sh  (auto-uses detected FQDN)
#!/usr/bin/env bash
set -euo pipefail
NS=ingress-nginx
FQDN=$(cat /tmp/ingress-controller-fqdn.txt 2>/dev/null || true)
[[ -z "$FQDN" ]] && { echo "ERROR: missing /tmp/ingress-controller-fqdn.txt; run scripts/find-ingress-svc.sh first"; exit 1; }

kubectl -n "$NS" delete pod tlscheck --ignore-not-found --now >/dev/null 2>&1 || true
kubectl -n "$NS" run tlscheck --restart=Never --image=alpine/openssl -- \
  sh -lc "echo | openssl s_client -connect ${FQDN}:443 -servername record.local 2>/dev/null \
          | openssl x509 -noout -subject -issuer -dates"
kubectl -n "$NS" wait --for=condition=Ready pod/tlscheck --timeout=15s || true
kubectl -n "$NS" logs tlscheck || true
kubectl -n "$NS" delete pod tlscheck --now >/dev/null 2>&1 || true