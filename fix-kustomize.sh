# fix-kustomize.sh
set -euo pipefail

base=infra/k8s/base

ensure_kz() {
  d="$1"
  f="$base/$d/kustomization.yaml"
  if [[ ! -f "$f" ]]; then
    echo "writing $f"
    cat >"$f" <<'YAML'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - deploy.yaml
  - service.yaml
YAML
  fi
}

# 1) ensure each base component has a kustomization.yaml
for d in api-gateway auth-service records-service listings-service analytics-service python-ai-service haproxy nginx; do
  ensure_kz "$d"
done

# exporters are single-file; still OK to create a simple kustomize file if you want:
for f in nginx-exporter haproxy-exporter; do
  dir="$base/exporters"
  kz="$dir/$f.kustomization.yaml"
  if [[ ! -f "$kz" ]]; then
    echo "writing $kz"
    cat >"$kz" <<YAML
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - $f.yaml
YAML
  fi
done

# 2) rewrite overlays/dev/kustomization.yaml with correct paths
overlay=infra/k8s/overlays/dev/kustomization.yaml
echo "rewriting $overlay"
cat >"$overlay" <<'YAML'
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: record-platform

resources:
  - ../../base/namespaces.yaml

  # config + edge
  - ../../base/config/app-config.yaml
  - ../../base/config/app-secrets.yaml
  - ../../base/haproxy
  - ../../base/nginx

  # exporters
  - ../../base/exporters/nginx-exporter.yaml
  - ../../base/exporters/haproxy-exporter.yaml

  # app services
  - ../../base/api-gateway
  - ../../base/auth-service
  - ../../base/records-service
  - ../../base/listings-service
  - ../../base/analytics-service
  - ../../base/python-ai-service

  # prometheus-operator discovery (if using kube-prometheus-stack)
  - ../../base/monitoring/servicemonitors.yaml

generatorOptions:
  disableNameSuffixHash: true

# from overlays/dev to infra/haproxy/nginx is ../../../
configMapGenerator:
  - name: haproxy-cm
    files:
      - haproxy.cfg=../../../haproxy/haproxy.cfg
  - name: nginx-cm
    files:
      - nginx.conf=../../../nginx/nginx.conf
YAML

# 3) remove a non-existent patch reference if present
sed -i.bak '/patchesStrategicMerge:/,/^[^ ]/d' "$overlay" || true

echo "done."
