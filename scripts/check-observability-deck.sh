#!/usr/bin/env bash
# Check that the observation deck is on and capturing: sidecars + stack (Istio, Splunk, Grafana, Prometheus, New Relic, Linkerd, Jaeger, OpenTelemetry).
# Output one line per component (OK / NOT_RUNNING / NAMESPACE_MISSING). Safe to run without cluster (outputs NOT_RUNNING).
# Usage: ./scripts/check-observability-deck.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

_kubectl() { kubectl --request-timeout=10s "$@" 2>/dev/null || true; }

check_ns() { _kubectl get ns "$1" >/dev/null 2>&1; }
count_running() { _kubectl -n "$1" get pods --no-headers 2>/dev/null | grep -c Running 2>/dev/null || echo "0"; }
has_deploy() { _kubectl -n "$1" get deploy "$2" >/dev/null 2>&1; }
sidecar_count() { _kubectl get pods -A -o jsonpath='{range .items[*]}{.metadata.namespace}{"\t"}{.metadata.name}{"\t"}{range .spec.containers[*]}{.name}{"\n"}{end}{end}' 2>/dev/null | grep -c -E 'istio-proxy|linkerd-proxy' || echo "0"; }

echo "=== Observation deck status ==="
echo ""

# Observability namespace + core stack
OBS_NS="observability"
if ! check_ns "$OBS_NS"; then
  echo "observability namespace: NAMESPACE_MISSING"
  echo "prometheus: NOT_RUNNING (no observability ns)"
  echo "grafana: NOT_RUNNING (no observability ns)"
  echo "jaeger: NOT_RUNNING (no observability ns)"
  echo "otel-collector (OpenTelemetry): NOT_RUNNING (no observability ns)"
  echo "newrelic: NOT_CHECKED (optional)"
else
  echo "observability namespace: OK"
  for comp in prometheus grafana jaeger otel-collector; do
    if has_deploy "$OBS_NS" "$comp"; then
      n=$(count_running "$OBS_NS" | head -1 | tr -cd '0-9')
      n=${n:-0}
      if [[ "$n" -gt 0 ]] 2>/dev/null; then
        run=$(_kubectl -n "$OBS_NS" get deploy "$comp" -o jsonpath='{.status.readyReplicas}' 2>/dev/null | head -1 | tr -cd '0-9')
        run=${run:-0}
        [[ "$run" -gt 0 ]] 2>/dev/null && echo "$comp: OK (readyReplicas=${run})" || echo "$comp: NOT_RUNNING (deploy exists, 0 ready)"
      else
        echo "$comp: NOT_RUNNING (0 pods in ns)"
      fi
    else
      echo "$comp: NOT_RUNNING (no deployment)"
    fi
  done
  # New Relic: often optional (secret present = configured)
  if _kubectl -n "$OBS_NS" get secret newrelic-secret >/dev/null 2>&1; then
    echo "newrelic: CONFIGURED (secret present)"
  else
    echo "newrelic: NOT_CONFIGURED (optional)"
  fi
fi

# Linkerd: check for linkerd namespace or inject
if check_ns "linkerd"; then
  run=$(count_running "linkerd" | head -1 | tr -cd '0-9')
  run=${run:-0}
  [[ "$run" -gt 0 ]] 2>/dev/null && echo "linkerd: OK ($run pod(s))" || echo "linkerd: NOT_RUNNING"
else
  echo "linkerd: NOT_RUNNING (no linkerd ns)"
fi

# Istio: check for istio-system and sidecars
if check_ns "istio-system"; then
  run=$(count_running "istio-system" | head -1 | tr -cd '0-9')
  run=${run:-0}
  [[ "$run" -gt 0 ]] 2>/dev/null && echo "istio: OK (control plane $run pod(s))" || echo "istio: NOT_RUNNING"
else
  echo "istio: NOT_RUNNING (no istio-system ns)"
fi

# Sidecars (istio-proxy / linkerd-proxy) — capturing traffic
sc=$(sidecar_count 2>/dev/null | head -1 | tr -cd '0-9')
sc=${sc:-0}
if [[ "$sc" -gt 0 ]] 2>/dev/null; then
  echo "sidecars (istio/linkerd proxy): OK ($sc proxy container(s) detected)"
else
  echo "sidecars (istio/linkerd proxy): NONE (no proxy containers; traffic may not be captured)"
fi

# Splunk: optional; often a forwarder or HEC
if check_ns "splunk" || _kubectl get pods -A 2>/dev/null | grep -q splunk; then
  echo "splunk: OK (present)"
else
  echo "splunk: NOT_CONFIGURED (optional)"
fi

echo ""
echo "Ensure observability is ON and sidecars are running so load/suite traffic is captured (Grafana, Prometheus, Jaeger, OpenTelemetry)."
