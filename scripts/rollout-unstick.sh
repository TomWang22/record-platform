#!/usr/bin/env bash
set -euo pipefail
NS="${1:-record-platform}"
APP="${2:-}"

echo "== Pods in ${NS} =="
kubectl -n "$NS" get pods -o wide

echo
echo "== Looking for Terminating pods${APP:+ for app=$APP} =="
MAP=( )
while read -r name phase rest; do
  [[ "$name" == "" ]] && continue
  if [[ -n "$APP" ]]; then
    if kubectl -n "$NS" get pod "$name" -o jsonpath='{.metadata.labels.app}' 2>/dev/null | grep -q "^${APP}$"; then
      MAP+=( "$name" )
    fi
  else
    MAP+=( "$name" )
  fi
done < <(kubectl -n "$NS" get pods | awk '$3 ~ /Terminating/ {print $1, $3}')

if (( ${#MAP[@]} == 0 )); then
  echo "No Terminating pods found."
  exit 0
fi

echo
echo "== Force-deleting stuck pods =="
for p in "${MAP[@]}"; do
  echo "Forcing delete: $p"
  kubectl -n "$NS" delete pod "$p" --grace-period=0 --force || true
done

echo
echo "== Recent events =="
kubectl -n "$NS" get events --sort-by=.lastTimestamp | tail -n 40