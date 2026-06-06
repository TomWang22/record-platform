#!/usr/bin/env bash
# Collect diagnostics for non-Ready / CrashLoop pods in record-platform.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${RP_K8S_NS:-record-platform}"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$REPO_ROOT/bench_logs/pod-diagnostics/$TS"
mkdir -p "$OUT"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

command -v kubectl >/dev/null 2>&1 || { echo "kubectl required" >&2; exit 1; }

issues=()
summary_json="$OUT/summary.json"
echo '{"pods":[]}' >"$summary_json"

while read -r line; do
  name="${line%% *}"
  ready="${line#* }"
  ready="${ready%% *}"
  status="${line#* * }"
  status="${status%% *}"
  restarts="${line#* * * }"
  restarts="${restarts%% *}"

  need=0
  [[ "$ready" != "1/1" && "$ready" != "2/2" ]] && need=1
  [[ "$status" == *CrashLoop* || "$status" == *Error* || "$status" == *CreateContainer* ]] && need=1
  [[ "$need" -eq 0 ]] && continue

  pod_dir="$OUT/$name"
  mkdir -p "$pod_dir"
  issues+=("$name ($ready $status restarts=$restarts)")

  kubectl get pod "$name" -n "$NS" -o wide >"$pod_dir/status.txt" 2>&1 || true
  kubectl describe pod "$name" -n "$NS" >"$pod_dir/describe.txt" 2>&1 || true
  kubectl logs "$name" -n "$NS" --all-containers --tail=120 >"$pod_dir/logs.txt" 2>&1 || true
  kubectl logs "$name" -n "$NS" --all-containers --previous --tail=80 >"$pod_dir/logs-previous.txt" 2>&1 || true

  kubectl get pod "$name" -n "$NS" -o jsonpath='{range .spec.containers[*]}{.name}{"\n"}{end}' 2>/dev/null \
    | while read -r c; do
      [[ -z "$c" ]] && continue
      kubectl exec -n "$NS" "$name" -c "$c" -- sh -c '
        echo "=== env ports ==="
        env | grep -E "PORT|POSTGRES|KAFKA|TLS|GRPC|GATEWAY" | sort || true
        echo "=== listen ==="
        (ss -lntp 2>/dev/null || netstat -lnt 2>/dev/null || true) | head -20
      ' >"$pod_dir/exec-$c.txt" 2>&1 || true
    done
done < <(kubectl get pods -n "$NS" --no-headers 2>/dev/null | grep -vE '^kafka-[0-9] ' || true)

{
  echo "# Pod diagnostics — $TS"
  echo ""
  echo "Namespace: \`$NS\`"
  echo ""
  echo "## Non-ready pods (${#issues[@]})"
  for i in "${issues[@]:-}"; do echo "- $i"; done
  echo ""
  echo "Artifacts: \`bench_logs/pod-diagnostics/$TS/\`"
} >"$OUT/summary.md"

python3 - <<PY
import json
from pathlib import Path
p = Path("$OUT/summary.json")
p.write_text(json.dumps({"timestamp": "$TS", "namespace": "$NS", "pods": $(printf '%s\n' "${issues[@]:-}" | python3 -c 'import json,sys; print(json.dumps([x for x in sys.stdin.read().splitlines() if x]))')}, indent=2) + "\n")
PY

say "Diagnostics: $OUT/summary.md"
[[ ${#issues[@]} -gt 0 ]] && exit 1
echo "✅ All pods Ready"
exit 0
