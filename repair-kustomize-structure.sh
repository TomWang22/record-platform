# repair-kustomize-structure.sh
set -euo pipefail

BASE=infra/k8s/base
OVER=infra/k8s/overlays/dev

# 1) Ensure base sub-dirs have kustomization.yaml
write_kz() {
  d="$1"
  f="$BASE/$d/kustomization.yaml"
  [[ -f "$f" ]] && return 0
  cat >"$f" <<'YAML'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deploy.yaml
  - service.yaml
YAML
  echo "wrote $f"
}
for d in api-gateway auth-service records-service listings-service analytics-service python-ai-service haproxy nginx; do
  write_kz "$d"
done

# 2) Base/config: make it a directory resource (so overlay doesn't include files)
mkdir -p "$BASE/config"
if [[ ! -f "$BASE/config/kustomization.yaml" ]]; then
  cat >"$BASE/config/kustomization.yaml" <<'YAML'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - app-config.yaml
  - app-secrets.yaml
YAML
  echo "wrote $BASE/config/kustomization.yaml"
fi

# 3) Base/exporters as a directory resource
if [[ ! -f "$BASE/exporters/kustomization.yaml" ]]; then
  cat >"$BASE/exporters/kustomization.yaml" <<'YAML'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - nginx-exporter.yaml
  - haproxy-exporter.yaml
YAML
  echo "wrote $BASE/exporters/kustomization.yaml"
fi

# 4) Base/monitoring as a directory resource
mkdir -p "$BASE/monitoring"
if [[ ! -f "$BASE/monitoring/kustomization.yaml" ]]; then
  cat >"$BASE/monitoring/kustomization.yaml" <<'YAML'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - servicemonitors.yaml
YAML
  echo "wrote $BASE/monitoring/kustomization.yaml"
fi

# 5) Move configMapGenerator for HAProxy & NGINX into their base kustomizations
append_if_missing() {
  file="$1"; marker="$2"; block="$3"
  grep -q "$marker" "$file" 2>/dev/null && return 0
  printf "\n%s\n" "$block" >>"$file"
  echo "updated $file ($marker)"
}

# Ensure the config files live under the base dirs (copy from your existing infra/* if needed)
[[ -f infra/haproxy/haproxy.cfg ]] && cp -f infra/haproxy/haproxy.cfg "$BASE/haproxy/haproxy.cfg"
[[ -f infra/nginx/nginx.conf   ]] && cp -f infra/nginx/nginx.conf   "$BASE/nginx/nginx.conf"

append_if_missing "$BASE/haproxy/kustomization.yaml" "configMapGenerator" \
'configMapGenerator:
  - name: haproxy-cm
    files:
      - haproxy.cfg'

append_if_missing "$BASE/nginx/kustomization.yaml" "configMapGenerator" \
'configMapGenerator:
  - name: nginx-cm
    files:
      - nginx.conf'

# 6) Rewrite overlay to only reference directories; drop cross-tree file refs & generators
cat >"$OVER/kustomization.yaml" <<'YAML'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: record-platform

resources:
  # everything as directories
  - ../../base/config
  - ../../base/haproxy
  - ../../base/nginx
  - ../../base/exporters
  - ../../base/api-gateway
  - ../../base/auth-service
  - ../../base/records-service
  - ../../base/listings-service
  - ../../base/analytics-service
  - ../../base/python-ai-service
  - ../../base/monitoring

generatorOptions:
  disableNameSuffixHash: true

images:
  - name: ghcr.io/yourorg/api-gateway
    newTag: dev
  - name: ghcr.io/yourorg/auth-service
    newTag: dev
  - name: ghcr.io/yourorg/records-service
    newTag: dev
  - name: ghcr.io/yourorg/listings-service
    newTag: dev
  - name: ghcr.io/yourorg/analytics-service
    newTag: dev
  - name: ghcr.io/yourorg/python-ai-service
    newTag: dev
YAML
echo "rewrote $OVER/kustomization.yaml"

echo "✅ Kustomize structure repaired."
