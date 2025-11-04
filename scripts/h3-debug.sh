# file: scripts/h3-debug.sh  (only if any check != 200)
#!/usr/bin/env bash
set -euo pipefail
echo "== Ingress describe (record-platform/record-platform) =="
kubectl -n record-platform describe ingress record-platform | sed -n '/Rules:/,$p' || true

echo; echo "== ingress-nginx controller logs (last 200) =="
kubectl -n ingress-nginx logs deploy/ingress-ingress-nginx-controller --tail=200 || true

echo; echo "== Backend svc/pods/endpoints =="
kubectl -n record-platform get svc,pod,endpoints -o wide | egrep 'NAME|nginx|gateway|api' || true

echo; echo "== Curl backend Service directly (cluster-internal) =="
kubectl -n record-platform run curlx --restart=Never --image=curlimages/curl -- \
  sh -lc "
    set -e;
    SVC_IP=\$(getent hosts nginx.record-platform.svc.cluster.local | awk '{print \$1; exit}');
    echo nginx SVC_IP=\$SVC_IP;
    curl -sS -I http://nginx.record-platform.svc.cluster.local:8080/api/healthz | head -n1;
  "
kubectl -n record-platform logs curlx || true
kubectl -n record-platform delete pod curlx --now >/dev/null 2>&1 || true