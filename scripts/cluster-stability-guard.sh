#!/usr/bin/env bash
# Phase 0 guard: fail fast when cluster is resource-starved before heavy preflight phases.
set -euo pipefail

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

MEM_FREE_MIN="${CLUSTER_GUARD_MEM_FREE_MIN:-20}"
METRICS_RESTART_WAIT_SEC="${CLUSTER_GUARD_METRICS_RESTART_WAIT_SEC:-10}"
METRICS_ATTEMPTS="${CLUSTER_GUARD_METRICS_ATTEMPTS:-5}"
METRICS_SLEEP_SEC="${CLUSTER_GUARD_METRICS_SLEEP_SEC:-3}"

say "=== Phase 0: Cluster Stability Guard ==="
echo "Cluster Stability Guard — verifying node headroom..."

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl not found" >&2
  exit 1
fi

if ! kubectl top nodes >/dev/null 2>&1; then
  warn "Metrics server unavailable. Restarting deployment/metrics-server in kube-system..."
  kubectl rollout restart -n kube-system deployment/metrics-server
  sleep "$METRICS_RESTART_WAIT_SEC"
fi

top_out=""
for i in $(seq 1 "$METRICS_ATTEMPTS"); do
  if top_out="$(kubectl top nodes --no-headers 2>/dev/null)" && [[ -n "${top_out// }" ]]; then
    break
  fi
  [[ "$i" -lt "$METRICS_ATTEMPTS" ]] && sleep "$METRICS_SLEEP_SEC"
done

if [[ -z "${top_out// }" ]]; then
  echo "❌ Unable to read node usage from metrics-server after retries." >&2
  exit 1
fi

_nodes="$(printf '%s\n' "$top_out" | awk 'NF {n++} END {print n+0}')"
if [[ -n "${CLUSTER_GUARD_CPU_IDLE_MIN:-}" ]]; then
  CPU_IDLE_MIN="$CLUSTER_GUARD_CPU_IDLE_MIN"
elif ((_nodes <= 1)); then
  CPU_IDLE_MIN="${CLUSTER_GUARD_CPU_IDLE_MIN_SINGLE:-10}"
else
  CPU_IDLE_MIN="${CLUSTER_GUARD_CPU_IDLE_MIN_MULTI:-20}"
fi
echo "Cluster guard: nodes=${_nodes} cpu_idle_min=${CPU_IDLE_MIN}% mem_free_min=${MEM_FREE_MIN}%"

node_count=0
while read -r name cpu_cores cpu_pct mem_bytes mem_pct; do
  [[ -z "${name:-}" ]] && continue
  cpu_pct="${cpu_pct%%%}"
  mem_pct="${mem_pct%%%}"
  [[ "$cpu_pct" =~ ^[0-9]+$ ]] || { echo "❌ Unexpected CPU% token for ${name}: ${cpu_pct}" >&2; exit 1; }
  [[ "$mem_pct" =~ ^[0-9]+$ ]] || { echo "❌ Unexpected MEM% token for ${name}: ${mem_pct}" >&2; exit 1; }
  cpu_idle=$((100 - cpu_pct))
  mem_free=$((100 - mem_pct))
  node_count=$((node_count + 1))
  echo "node=${name} cpu=${cpu_cores} mem=${mem_bytes} cpu_idle=${cpu_idle}% mem_free=${mem_free}%"
  if (( cpu_idle < CPU_IDLE_MIN )); then
    echo "❌ Node ${name} CPU headroom <${CPU_IDLE_MIN}% (idle=${cpu_idle}%). Aborting preflight."
    exit 1
  fi
  if (( mem_free < MEM_FREE_MIN )); then
    echo "❌ Node ${name} memory headroom <${MEM_FREE_MIN}% (free=${mem_free}%). Aborting preflight."
    exit 1
  fi
done <<< "$top_out"

if (( node_count == 0 )); then
  echo "❌ kubectl top nodes returned no nodes." >&2
  exit 1
fi

ok "Cluster headroom OK (${node_count} node(s); cpu_idle>=${CPU_IDLE_MIN}%, mem_free>=${MEM_FREE_MIN}%)"
