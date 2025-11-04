#!/usr/bin/env bash
set -euo pipefail

OVERLAY="infra/k8s/overlays/dev"
PATCHDIR="$OVERLAY/patches"
NS="record-platform"
SERVICES=(api-gateway auth-service records-service listings-service analytics-service python-ai-service)

mkdir -p "$PATCHDIR"

for s in "${SERVICES[@]}"; do
  cat > "$PATCHDIR/envfrom-$s.yaml" <<YAML
apiVersion: apps/v1
kind: Deployment
metadata:
  name: $s
  namespace: $NS
spec:
  template:
    spec:
      containers:
        - name: app
          envFrom:
            - configMapRef: { name: app-config }
            - secretRef:    { name: app-secrets }
YAML
done

# Ensure kustomization has a patches section and references these files
KS="$OVERLAY/kustomization.yaml"
if ! grep -q '^patches:' "$KS"; then
  printf "\npatches:\n" >> "$KS"
fi

for s in "${SERVICES[@]}"; do
  p="patches/envfrom-$s.yaml"
  if ! grep -q "$p" "$KS"; then
    cat >> "$KS" <<YAML
  - path: $p
    target:
      kind: Deployment
      name: $s
      namespace: $NS
YAML
  fi
done

echo "Generated patches in $PATCHDIR and updated $KS."
echo "Apply them with: kubectl apply -k $OVERLAY"
