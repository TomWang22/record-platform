#!/usr/bin/env bash
set -euo pipefail
NS="${1:-record-platform}"
kubectl -n "$NS" patch deploy/records-service --type=json -p='[
  {"op":"replace","path":"/spec/template/spec/containers/0/livenessProbe/httpGet/path","value":"/_ping"},
  {"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/_ping"},
  {"op":"replace","path":"/spec/template/spec/containers/0/livenessProbe/initialDelaySeconds","value":90},
  {"op":"replace","path":"/spec/template/spec/containers/0/livenessProbe/failureThreshold","value":10}
]'
kubectl -n "$NS" rollout status deploy/records-service
kubectl -n "$NS" logs deploy/records-service --tail=200
