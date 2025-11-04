#!/usr/bin/env bash
set -euo pipefail

NS="${NS:-record-platform}"
SERVICES=(api-gateway auth-service records-service listings-service analytics-service python-ai-service)

need_jq() { command -v jq >/dev/null || { echo "jq is required"; exit 1; }; }

patch_if_missing() {
  local d="$1"
  # grab the first container (you use 'app' as the first one everywhere)
  local j; j="$(kubectl -n "$NS" get deploy "$d" -o json)"

  # if no envFrom → add both entries
  if ! echo "$j" | jq -e '.spec.template.spec.containers[0].envFrom' >/dev/null; then
    kubectl -n "$NS" patch deploy "$d" --type=json \
      -p='[{
        "op":"add",
        "path":"/spec/template/spec/containers/0/envFrom",
        "value":[
          {"configMapRef":{"name":"app-config"}},
          {"secretRef":{"name":"app-secrets"}}
        ]
      }]'
    echo "patched $d: added envFrom (both)"
    return
  fi

  # envFrom exists → append any missing entries
  local patch='['
  if ! echo "$j" | jq -e '.spec.template.spec.containers[0].envFrom[]
       | select(.configMapRef.name=="app-config")' >/dev/null; then
    patch+='{"op":"add","path":"/spec/template/spec/containers/0/envFrom/-","value":{"configMapRef":{"name":"app-config"}}},'
  fi
  if ! echo "$j" | jq -e '.spec.template.spec.containers[0].envFrom[]
       | select(.secretRef.name=="app-secrets")' >/dev/null; then
    patch+='{"op":"add","path":"/spec/template/spec/containers/0/envFrom/-","value":{"secretRef":{"name":"app-secrets"}}},'
  fi
  patch="${patch%,}]"
  if [[ "$patch" != "[]" ]]; then
    kubectl -n "$NS" patch deploy "$d" --type=json -p="$patch"
    echo "patched $d: appended missing entries"
  else
    echo "ok $d: envFrom already present"
  fi
}

need_jq
for d in "${SERVICES[@]}"; do
  if kubectl -n "$NS" get deploy "$d" >/dev/null 2>&1; then
    patch_if_missing "$d"
  else
    echo "skip $d: deploy not found"
  fi
done

# show the result
echo
echo "== current envFrom =="
for d in "${SERVICES[@]}"; do
  kubectl -n "$NS" get deploy "$d" -o jsonpath="{.metadata.name}{': '}{range .spec.template.spec.containers[0].envFrom[*]}{.configMapRef.name}{.secretRef.name}{' '}{end}{'\n'}" 2>/dev/null || true
done