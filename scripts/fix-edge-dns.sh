#!/usr/bin/env bash
set -euo pipefail

OVERLAY=infra/k8s/overlays/dev
BASE_NGINX=infra/k8s/base/nginx
BASE_HAPROXY=infra/k8s/base/haproxy
SRC_NGINX=infra/nginx/nginx.conf
SRC_HAPROXY=infra/haproxy/haproxy.cfg
NS=record-platform

echo "▶ Finding cluster DNS (kube-dns) IP…"
RESOLVER_IP=$(kubectl -n kube-system get svc kube-dns -o jsonpath='{.spec.clusterIP}')
: "${RESOLVER_IP:?no kube-dns IP found}"
echo "   kube-dns = ${RESOLVER_IP}"

echo "▶ Ensuring base/nginx kustomization uses the source file and stable CM name…"
mkdir -p "$BASE_NGINX"
cat > "$BASE_NGINX/kustomization.yaml" <<'YAML'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - deploy.yaml
  - service.yaml

generatorOptions:
  disableNameSuffixHash: true

configMapGenerator:
  - name: nginx-cm
    files:
      - nginx.conf=../../../nginx/nginx.conf
YAML

echo "▶ Ensuring base/haproxy kustomization uses the source file and stable CM name…"
mkdir -p "$BASE_HAPROXY"
cat > "$BASE_HAPROXY/kustomization.yaml" <<'YAML'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

resources:
  - deploy.yaml
  - service.yaml

generatorOptions:
  disableNameSuffixHash: true

configMapGenerator:
  - name: haproxy-cm
    files:
      - haproxy.cfg=../../../haproxy/haproxy.cfg
YAML

echo "▶ Updating NGINX resolver to kube-dns in $SRC_NGINX …"
# replace any existing 'resolver ...;' line with kube-dns (macOS/BSD sed)
sed -i '' -E "s#^[[:space:]]*resolver[[:space:]][^;]+;#  resolver ${RESOLVER_IP} valid=10s ipv6=off;#g" "$SRC_NGINX"
# If no resolver line exists, insert one right after the 'http {' line
if ! grep -qE 'resolver[[:space:]]+[0-9]+\.[0-9]+' "$SRC_NGINX"; then
  awk -v ip="$RESOLVER_IP" '
    {print}
    /http[[:space:]]*\{/ && !ins { print "  resolver " ip " valid=10s ipv6=off;"; ins=1 }
  ' "$SRC_NGINX" > "$SRC_NGINX.tmp"
  mv "$SRC_NGINX.tmp" "$SRC_NGINX"
fi

echo "▶ Updating HAProxy to kube-dns + direct service target in $SRC_HAPROXY …"
# swap docker resolvers -> kube
perl -0777 -pe 's/resolvers\s+docker.*?\n\n/resolvers kube\n  nameserver dns '"$RESOLVER_IP"':53\n  hold valid 10s\n\n/s' \
  -i '' "$SRC_HAPROXY" || true
# replace server-template with direct service using kube resolvers
perl -0777 -pe 's/^[ \t]*server-template[^\n]+api-gateway:4000[^\n]*$/  server api api-gateway:4000 check resolvers kube resolve-prefer ipv4/m' \
  -i '' "$SRC_HAPROXY" || true

echo "▶ Remove overlay-level ConfigMapGenerators that might shadow base (safe if absent)…"
sed -i '' -e '/^configMapGenerator:/,/^[^[:space:]]/d' "$OVERLAY/kustomization.yaml" || true

echo "▶ Render first 120 lines so you can sanity-check the ConfigMaps…"
kubectl kustomize "$OVERLAY" | sed -n '1,120p' || true

echo "▶ Apply overlay…"
kubectl apply -k "$OVERLAY"

echo "▶ Restart edge (nginx + haproxy)…"
kubectl -n "$NS" rollout restart deploy/nginx deploy/haproxy
kubectl -n "$NS" rollout status  deploy/nginx
kubectl -n "$NS" rollout status  deploy/haproxy

echo "▶ In-cluster checks (nginx -> haproxy -> gateway)…"
kubectl -n "$NS" run netshoot --restart=Never --image=nicolaka/netshoot -- sleep 300 >/dev/null
kubectl -n "$NS" exec netshoot -- sh -lc '
  set -e
  for u in \
    http://nginx:8080/healthz \
    http://nginx:8080/api/healthz \
    http://haproxy:8081/healthz \
    http://api-gateway:4000/healthz ; do
      echo "== $u =="; wget -qO- "$u" || echo FAIL; echo;
  done'
kubectl -n "$NS" delete pod netshoot --now >/dev/null

echo "▶ Optional local test (new terminal):"
echo "  kubectl -n $NS port-forward svc/nginx 8080:8080 8082:8082"
echo "  curl -sf http://localhost:8080/healthz && echo OK"
echo "  curl -sf http://localhost:8080/api/healthz && echo OK"
