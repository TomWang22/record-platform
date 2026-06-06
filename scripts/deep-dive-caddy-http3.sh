#!/usr/bin/env bash
# Deep-dive: get to the bottom of Caddy HTTP/3 — ConfigMap keys, mount in pod, Caddy validate, rollout status.
# Run when: ensure script says "unchanged" but pod Caddyfile looks empty, rollout times out, or in-cluster HTTP/3 returns 000.
#
# Usage: ./scripts/deep-dive-caddy-http3.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NS="${CADDY_NS:-ingress-nginx}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
fail(){ echo "❌ $*"; }
info(){ echo "ℹ️  $*"; }

cd "$REPO_ROOT"

# --- 1. ConfigMap: exact keys and that Caddyfile key exists and has content ---
say "=== 1. ConfigMap caddy-h3: keys and Caddyfile key size ==="
if ! kubectl get configmap caddy-h3 -n "$NS" -o name &>/dev/null; then
  fail "ConfigMap caddy-h3 not found in $NS"
  exit 1
fi
_info=$(kubectl get configmap caddy-h3 -n "$NS" -o json 2>/dev/null)
_keys=""
if command -v jq &>/dev/null; then
  _keys=$(echo "$_info" | jq -r '.data | keys[]' 2>/dev/null || true)
else
  _keys=$(echo "$_info" | grep -oE '"[A-Za-z0-9_.-]+":' | tr -d '":' || true)
fi
if [[ -z "$_keys" ]]; then
  warn "ConfigMap .data keys could not be parsed; showing first 500 chars of configmap:"
  echo "$_info" | head -c 500
  echo ""
else
  info "ConfigMap .data keys: $(echo $_keys | tr '\n' ' ')"
  while IFS= read -r k; do
    [[ -z "$k" ]] && continue
    _len="?"
    command -v jq &>/dev/null && _len=$(echo "$_info" | jq -r --arg k "$k" '.data[$k] | length' 2>/dev/null || true)
    info "  key \"$k\" length: ${_len} bytes"
  done <<< "$_keys"
fi
# Deploy expects key "Caddyfile" (capital C)
if echo "$_keys" | grep -qx "Caddyfile"; then
  ok "ConfigMap has key 'Caddyfile' (matches deploy volume items)"
else
  fail "ConfigMap has NO key 'Caddyfile'. Deploy mounts key Caddyfile → /etc/caddy/Caddyfile. Keys present: $(echo $_keys | tr '\n' ' ')"
fi
info "First 25 lines of ConfigMap .data.Caddyfile (what K8s has):"
kubectl get configmap caddy-h3 -n "$NS" -o jsonpath='{.data.Caddyfile}' 2>/dev/null | head -25 | sed 's/^/  /' || warn "Could not read .data.Caddyfile"

# --- 2. Pod: what file exists at /etc/caddy, content and Caddy validate ---
say "=== 2. Pod: mount path /etc/caddy and Caddyfile content ==="
# Prefer a Running pod so exec works (avoid "container not found" when pod is ImagePullBackOff)
POD=$(kubectl get pods -n "$NS" -l app=caddy-h3 --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
if [[ -z "$POD" ]]; then
  POD=$(kubectl get pods -n "$NS" -l app=caddy-h3 -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
fi
if [[ -z "$POD" ]]; then
  fail "No caddy-h3 pod in $NS (deployment may be scaled to 0 or not deployed)"
  exit 1
fi
_phase=$(kubectl get pod -n "$NS" "$POD" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
info "Using pod: $POD (phase: $_phase)"
if [[ "$_phase" != "Running" ]]; then
  warn "Pod is not Running — exec will fail. Check section 4 for ImagePullBackOff / rollout."
fi
info "Listing /etc/caddy (no stderr hidden):"
kubectl exec -n "$NS" "$POD" -- ls -la /etc/caddy 2>&1 | sed 's/^/  /' || true
info "Line count of /etc/caddy/Caddyfile:"
kubectl exec -n "$NS" "$POD" -- wc -l /etc/caddy/Caddyfile 2>&1 | sed 's/^/  /' || true
info "First 35 lines of /etc/caddy/Caddyfile (exact content in pod):"
kubectl exec -n "$NS" "$POD" -- cat /etc/caddy/Caddyfile 2>&1 | head -35 | sed 's/^/  /' || true
info "Caddy version in image:"
kubectl exec -n "$NS" "$POD" -- caddy version 2>&1 | sed 's/^/  /' || true
info "Caddy validate --config /etc/caddy/Caddyfile:"
kubectl exec -n "$NS" "$POD" -- caddy validate --config /etc/caddy/Caddyfile 2>&1 | sed 's/^/  /' && ok "Caddy config valid" || warn "Caddy validate failed (invalid or empty config)"

# --- 3. UDP 443 in pod ---
say "=== 3. UDP 443 listening in pod ==="
kubectl exec -n "$NS" "$POD" -- ss -lunp 2>/dev/null | grep -E "443|UNCONN" | sed 's/^/  /' || info "ss -lunp (no 443/UNCONN or ss not available)"
_udp=$(kubectl exec -n "$NS" "$POD" -- ss -lunp 2>/dev/null | grep 443 || true)
if [[ -n "$_udp" ]]; then
  ok "UDP 443 is bound in pod (QUIC listening)"
else
  warn "No UDP 443 in pod — Caddy is not listening for QUIC."
  info "If Caddyfile in pod has 'protocols h1 h2 h3', Caddy likely started before the config was updated and does not reload the file. Reset image and rollout so new pods load the config: ./scripts/reset-caddy-h3-to-default-image.sh && ./scripts/ensure-caddy-http3-config.sh"
fi

# --- 4. Rollout status and why a replica might be stuck ---
say "=== 4. Deployment and pod status (why rollout might time out) ==="
kubectl get deployment caddy-h3 -n "$NS" -o wide 2>/dev/null | sed 's/^/  /'
kubectl get pods -n "$NS" -l app=caddy-h3 -o wide 2>/dev/null | sed 's/^/  /'
for p in $(kubectl get pods -n "$NS" -l app=caddy-h3 -o jsonpath='{.items[*].metadata.name}' 2>/dev/null); do
  _ready=$(kubectl get pod -n "$NS" "$p" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "Unknown")
  if [[ "$_ready" != "True" ]]; then
    warn "Pod $p is not Ready. Describe and events:"
    kubectl describe pod -n "$NS" "$p" 2>/dev/null | tail -40 | sed 's/^/  /'
    kubectl get events -n "$NS" --field-selector involvedObject.name="$p" --sort-by='.lastTimestamp' 2>/dev/null | tail -15 | sed 's/^/  /'
  fi
done
info "Recent events in namespace (last 15):"
kubectl get events -n "$NS" --sort-by='.lastTimestamp' 2>/dev/null | tail -15 | sed 's/^/  /'

# --- 5. Root cause: ImagePullBackOff? ---
say "=== 5. Root cause check ==="
_image=$(kubectl get deployment caddy-h3 -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)
_pull_fail=""
for p in $(kubectl get pods -n "$NS" -l app=caddy-h3 -o jsonpath='{.items[*].metadata.name}' 2>/dev/null); do
  _reason=$(kubectl get pod -n "$NS" "$p" -o jsonpath='{.status.containerStatuses[0].state.waiting.reason}' 2>/dev/null || true)
  if [[ "$_reason" == "ImagePullBackOff" ]] || [[ "$_reason" == "ErrImagePull" ]]; then
    _pull_fail="$p"
    break
  fi
done
if [[ -n "$_pull_fail" ]] && echo "$_image" | grep -q "caddy-with-tcpdump\|k3d-record-platform-registry"; then
  warn "At least one pod is ImagePullBackOff (e.g. $_pull_fail). Deployment image: $_image"
  echo "  → Registry/custom image not available. Reset to default Caddy so rollout completes:"
  echo "  →   ./scripts/reset-caddy-h3-to-default-image.sh"
  echo "  → Then re-apply HTTP/3 config: ./scripts/ensure-caddy-http3-config.sh"
  echo ""
fi

# --- 6. Summary and fix hints ---
say "=== 6. Summary ==="
_cm_has=$(kubectl get configmap caddy-h3 -n "$NS" -o jsonpath='{.data.Caddyfile}' 2>/dev/null | head -1)
_pod_lines="0"
if [[ "$_phase" == "Running" ]]; then
  _pod_lines=$(kubectl exec -n "$NS" "$POD" -- wc -l /etc/caddy/Caddyfile 2>/dev/null | awk '{print $1}' || echo "0")
fi
if [[ -z "$_cm_has" ]]; then
  fail "ConfigMap .data.Caddyfile is empty or missing. Re-create: kubectl create configmap caddy-h3 -n $NS --from-file=Caddyfile=$REPO_ROOT/Caddyfile --dry-run=client -o yaml | kubectl apply -f -"
elif [[ "$_phase" != "Running" ]]; then
  warn "Skipping pod Caddyfile check (no Running pod). Fix ImagePullBackOff first (see section 5), then re-run this script."
elif [[ "${_pod_lines:-0}" -eq 0 ]]; then
  fail "Pod file /etc/caddy/Caddyfile has 0 lines but ConfigMap has content → volume mount or key mismatch. Deploy uses items: [{ key: Caddyfile, path: Caddyfile }]. Delete pods to force remount: kubectl delete pod -n $NS -l app=caddy-h3"
else
  ok "ConfigMap has content and Running pod sees $_pod_lines lines"
fi
echo ""
echo "  Next: ensure-caddy-http3-config.sh then verify-caddy-http3-in-cluster.sh"
