#!/usr/bin/env bash
# F.namespace.prepare — non-destructive ensure of record-platform namespace.
# Never deletes the namespace.
set -euo pipefail

NS="${HOUSING_NS:-record-platform}"
CTX="$(kubectl config current-context 2>/dev/null || true)"
[[ -n "$CTX" ]] || { echo "❌ no kubectl context" >&2; exit 1; }

echo "context=${CTX}"
echo "namespace=${NS}"

if kubectl get ns "$NS" >/dev/null 2>&1; then
  echo "namespace_state=exists"
else
  echo "namespace_state=absent — creating"
  kubectl create namespace "$NS"
fi

kubectl label ns "$NS" --overwrite \
  "app.kubernetes.io/part-of=record-platform" \
  "rp.dev/managed-by=rp-prepare-record-platform-namespace" >/dev/null

uid="$(kubectl get ns "$NS" -o jsonpath='{.metadata.uid}')"
echo "namespace_uid=${uid}"
echo "✅ F.namespace.prepare: ${NS} ready (uid=${uid})"
