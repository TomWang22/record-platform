#!/usr/bin/env bash
# Wait for deployment rollout and verify old ReplicaSets scaled to 0.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${RP_K8S_NS:-record-platform}"
TIMEOUT="${RP_ROLLOUT_TIMEOUT:-300s}"

deployments=("$@")
if [[ ${#deployments[@]} -eq 0 ]]; then
  mapfile -t deployments < <(kubectl get deploy -n "$NS" -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null \
    | grep -E 'service|gateway|webapp|monitor' || true)
fi

fail=0
for d in "${deployments[@]}"; do
  echo "=== rollout $d ==="
  if ! kubectl rollout status "deployment/$d" -n "$NS" --timeout="$TIMEOUT"; then
    echo "❌ rollout failed: $d" >&2
    fail=1
    continue
  fi
  desired="$(kubectl get deploy "$d" -n "$NS" -o jsonpath='{.spec.replicas}')"
  updated="$(kubectl get deploy "$d" -n "$NS" -o jsonpath='{.status.updatedReplicas}')"
  available="$(kubectl get deploy "$d" -n "$NS" -o jsonpath='{.status.availableReplicas}')"
  if [[ "$desired" != "$updated" || "$desired" != "$available" ]]; then
    echo "❌ $d desired=$desired updated=$updated available=$available" >&2
    fail=1
  fi
  while read -r rs ready; do
    [[ -z "$rs" ]] && continue
    if [[ "${ready:-0}" != "0" ]] && [[ "$rs" != "$(kubectl get deploy "$d" -n "$NS" -o jsonpath='{.status.conditions[?(@.type=="Progressing")].message}' 2>/dev/null)" ]]; then
      cur="$(kubectl get rs "$rs" -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo 0)"
      new_rs="$(kubectl get deploy "$d" -n "$NS" -o jsonpath='{.status.conditions[?(@.type=="Available")].reason}' 2>/dev/null)"
      # active RS has desired replicas; stale RS should be 0
      owner="$(kubectl get rs "$rs" -n "$NS" -o jsonpath='{.metadata.ownerReferences[0].name}' 2>/dev/null)"
      [[ "$owner" == "$d" && "$cur" != "0" ]] || continue
      latest="$(kubectl get rs -n "$NS" -l "app=$d" --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1].metadata.name}' 2>/dev/null)"
      if [[ "$rs" != "$latest" && "$cur" != "0" ]]; then
        echo "❌ stale ReplicaSet $rs still has $cur replicas" >&2
        fail=1
      fi
    fi
  done < <(kubectl get rs -n "$NS" -l "app=$d" --no-headers 2>/dev/null | awk '{print $1,$2}' || true)
  echo "✅ $d rollout clean"
done

exit "$fail"
