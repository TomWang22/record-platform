# file: scripts/fix-now.sh
#!/usr/bin/env bash
set -euo pipefail

NS=ingress-nginx
CADDY_CF=./Caddyfile

echo "== 1) Check for an ingress-nginx controller Service exposing 443 =="
kubectl get svc -n "$NS" >/dev/null 2>&1 || { echo "Namespace $NS missing"; exit 1; }

SVC_NAME=$(
  kubectl -n "$NS" get svc -o jsonpath='{range .items[*]}{.metadata.name}{"|"}{range .spec.ports[*]}{.port}{" "}{end}{"\n"}{end}' \
  | awk -F'|' '{
      name=$1; ports=$2; found=0;
      n=split(ports,a," ");
      for(i=1;i<=n;i++) if (a[i]=="443") found=1;
      if (found && name ~ /ingress.*nginx.*controller/) { print name; exit }
    }'
)

if [[ -z "${SVC_NAME:-}" ]]; then
  echo "No controller Service with :443 found in $NS. Installing ingress-nginx via Helm…"
  helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx >/dev/null
  helm repo update >/dev/null
  helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
    --namespace "$NS" --create-namespace \
    --set controller.allowSnippetAnnotations=true \
    --set controller.service.type=ClusterIP >/dev/null

  echo "Waiting for controller Deployment…"
  kubectl -n "$NS" rollout status deploy/ingress-nginx-controller

  echo "Finding Service again…"
  SVC_NAME=$(
    kubectl -n "$NS" get svc -o jsonpath='{range .items[*]}{.metadata.name}{"|"}{range .spec.ports[*]}{.port}{" "}{end}{"\n"}{end}' \
    | awk -F'|' '{
        name=$1; ports=$2; found=0;
        n=split(ports,a," ");
        for(i=1;i<=n;i++) if (a[i]=="443") found=1;
        if (found && name ~ /ingress.*nginx.*controller/) { print name; exit }
      }'
  )
fi

if [[ -z "${SVC_NAME:-}" ]]; then
  echo "ERROR: still no controller Service with :443 in $NS. Check: kubectl get svc -A | egrep -i \"ingress|nginx\""
  exit 1
fi

FQDN="${SVC_NAME}.${NS}.svc.cluster.local"
echo "Using controller Service: ${FQDN}:443"

echo "== 2) Patch Caddyfile reverse_proxy upstream =="
[[ -f "$CADDY_CF" ]] || { echo "ERROR: $CADDY_CF not found"; exit 1; }
tmp=$(mktemp)
awk -v host="$FQDN" '
  BEGIN{re="^\\s*reverse_proxy\\s+https://[^[:space:]]+:443\\s*\\{"}
  { if ($0 ~ re) { sub(re, "  reverse_proxy https://" host ":443 {") } print }
' "$CADDY_CF" > "$tmp" && mv "$tmp" "$CADDY_CF"

echo "== 3) Apply ConfigMap and restart Caddy =="
kubectl -n "$NS" create configmap caddy-h3 \
  --from-file=Caddyfile="$CADDY_CF" -o yaml --dry-run=client | kubectl apply -f -
kubectl -n "$NS" rollout restart deploy/caddy-h3
kubectl -n "$NS" rollout status  deploy/caddy-h3

echo "== 4) Quick upstream TLS sanity from inside cluster =="
kubectl -n "$NS" delete pod tlscheck --ignore-not-found --now >/dev/null 2>&1 || true
kubectl -n "$NS" run tlscheck --restart=Never --image=alpine/openssl -- \
  sh -lc "echo | openssl s_client -connect ${FQDN}:443 -servername record.local 2>/dev/null \
          | openssl x509 -noout -subject -issuer -dates"
sleep 2
kubectl -n "$NS" logs tlscheck || true
kubectl -n "$NS" delete pod tlscheck --now >/dev/null 2>&1 || true

echo "== 5) End-to-end H2/H3 matrix =="
CURL=/opt/homebrew/opt/curl/bin/curl
CA=certs/dev-root.pem
echo '127.0.0.1 record.local' | sudo tee -a /etc/hosts >/dev/null
$CURL --cacert "$CA" -sS -o /dev/null -w "H2 -> /_caddy/healthz => HTTP %{http_code}\n" --http2      -H 'Host: record.local' https://record.local/_caddy/healthz
$CURL --cacert "$CA" -sS -o /dev/null -w "H3 -> /_caddy/healthz => HTTP %{http_code}\n" --http3-only -H 'Host: record.local' https://record.local/_caddy/healthz
$CURL --cacert "$CA" -sS -o /dev/null -w "H2 -> /api/healthz => HTTP %{http_code}\n" --http2      -H 'Host: record.local' https://record.local/api/healthz
$CURL --cacert "$CA" -sS -o /dev/null -w "H3 -> /api/healthz => HTTP %{http_code}\n" --http3-only -H 'Host: record.local' https://record.local/api/healthz

echo "Done."