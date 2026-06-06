#!/usr/bin/env bash
# Install MetalLB in phases with QPS-friendly apply: one YAML document at a time with delay.
# Single-node API returns 503 when kubectl apply -f URL does a burst of GETs; this script
# downloads the manifest, splits on ---, and applies each doc with a pause to respect API limits.
#
# Usage: ./scripts/install-metallb-chunked.sh
#   METALLB_POOL=192.168.106.240-192.168.106.250  to override pool
#   USE_IN_VM=1         use colima ssh for kubectl (when host API is down but in-VM works)
#   APPLY_DELAY=3       seconds between applying each YAML doc (default 3; respect QPS)
#   DOC_RETRIES=5       retries per doc on 503/error (default 5)
#   DOC_RETRY_SLEEP=10  seconds between retries per doc (default 10)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

METALLB_VERSION="${METALLB_VERSION:-v0.14.3}"
METALLB_MANIFEST_URL="https://raw.githubusercontent.com/metallb/metallb/${METALLB_VERSION}/config/manifests/metallb-native.yaml"
METALLB_POOL="${METALLB_POOL:-192.168.106.240-192.168.106.250}"
USE_IN_VM="${USE_IN_VM:-0}"
APPLY_DELAY="${APPLY_DELAY:-3}"
DOC_RETRIES="${DOC_RETRIES:-5}"
DOC_RETRY_SLEEP="${DOC_RETRY_SLEEP:-10}"
RETRIES="${METALLB_CHUNKED_RETRIES:-6}"
RETRY_SLEEP="${METALLB_CHUNKED_SLEEP:-20}"

ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
info(){ echo "📋 $*"; }

_kubectl() {
  if [[ "$USE_IN_VM" == "1" ]]; then
    colima ssh -- kubectl "$@" --request-timeout=60s
  else
    kubectl "$@" --request-timeout=60s
  fi
}

# Phase 0: Ensure we can reach API (host or in-VM)
phase0_check_api() {
  if [[ "$USE_IN_VM" == "1" ]]; then
    info "Using in-VM kubectl (USE_IN_VM=1)"
    if ! colima ssh -- kubectl get nodes --request-timeout=15s 2>/dev/null; then
      warn "In-VM API not reachable. Start Colima and wait for k3s, or run without USE_IN_VM when host API works."
      return 1
    fi
  else
    "$SCRIPT_DIR/colima-forward-6443.sh" 2>/dev/null || true
    if ! "$SCRIPT_DIR/ensure-k8s-api.sh" 2>/dev/null; then
      warn "Host API not reachable. Try USE_IN_VM=1 ./scripts/install-metallb-chunked.sh"
      return 1
    fi
  fi
  return 0
}

# When USE_IN_VM=1, apply path is inside VM (VM_PATH). Otherwise host path.
_apply_one_doc() {
  local f="$1" i=1
  while [[ $i -le $DOC_RETRIES ]]; do
    if _kubectl apply -f "$f" --validate=false 2>/dev/null; then
      return 0
    fi
    [[ $i -lt $DOC_RETRIES ]] && { info "  retry $i/$DOC_RETRIES in ${DOC_RETRY_SLEEP}s..."; sleep "$DOC_RETRY_SLEEP"; }
    i=$((i + 1))
  done
  return 1
}

# Copy manifest dir from host to VM so in-VM kubectl can read it. Sets VM_MANIFEST_DIR.
_copy_manifest_to_vm() {
  local host_dir="$1"
  VM_MANIFEST_DIR="/tmp/metallb-chunked-$$"
  info "  Copying chunked manifest into VM at $VM_MANIFEST_DIR..."
  colima ssh -- "mkdir -p $VM_MANIFEST_DIR"
  tar c -C "$host_dir" -f - . 2>/dev/null | colima ssh -- "tar x -C $VM_MANIFEST_DIR -f -"
  ok "  Copied"
}

# Split multi-doc YAML into separate files. Writes chunk_000.yaml, chunk_001.yaml, ... into $2
_split_yaml_into_chunks() {
  local manifest_path="$1" out_dir="$2"
  mkdir -p "$out_dir"
  # Split on line that is exactly "---"; emit one file per document (skip empty)
  awk -v outdir="$out_dir" '
    BEGIN { fn=0; n=0; buf="" }
    /^---$/ {
      if (n) { f=outdir "/chunk_" sprintf("%03d", fn) ".yaml"; print buf > f; close(f); fn++; }
      n=0; buf=""; next
    }
    { buf = (buf == "" ? $0 : buf "\n" $0); n=1 }
    END { if (n) { f=outdir "/chunk_" sprintf("%03d", fn) ".yaml"; print buf > f } }
  ' "$manifest_path"
  # Return count (chunk_*.yaml)
  ls -1 "$out_dir"/chunk_*.yaml 2>/dev/null | wc -l | tr -d ' '
}

# --- Main ---

if ! phase0_check_api; then
  exit 1
fi

# Phase 1: Namespace only
info "Phase 1/3: Creating metallb-system namespace..."
for _attempt in $(seq 1 "$RETRIES"); do
  if _kubectl apply -f - --validate=false <<EOF 2>/dev/null; then
apiVersion: v1
kind: Namespace
metadata:
  name: metallb-system
  labels:
    pod-security.kubernetes.io/audit: privileged
    pod-security.kubernetes.io/enforce: privileged
    pod-security.kubernetes.io/warn: privileged
EOF
    break
  fi
  [[ $_attempt -lt $RETRIES ]] && { info "Namespace attempt $_attempt failed; sleeping ${RETRY_SLEEP}s..."; sleep "$RETRY_SLEEP"; }
  [[ $_attempt -eq $RETRIES ]] && { warn "Namespace phase failed"; exit 1; }
done
ok "Namespace created"
sleep "$APPLY_DELAY"

# Phase 2: Download manifest, split into docs, apply one doc at a time with delay (respect QPS)
info "Phase 2/3: Downloading MetalLB manifest and applying doc-by-doc (delay ${APPLY_DELAY}s between docs to respect API QPS)..."
TMPDIR_METALLB="${TMPDIR_METALLB:-/tmp}"
MANIFEST_DIR="$TMPDIR_METALLB/metallb-chunked-$$"
mkdir -p "$MANIFEST_DIR"
cleanup_manifest() { rm -rf "$MANIFEST_DIR"; }
trap cleanup_manifest EXIT

if ! curl -sSfL -o "$MANIFEST_DIR/full.yaml" "$METALLB_MANIFEST_URL"; then
  warn "Failed to download $METALLB_MANIFEST_URL"
  exit 1
fi
CHUNK_COUNT=$(_split_yaml_into_chunks "$MANIFEST_DIR/full.yaml" "$MANIFEST_DIR")
# When USE_IN_VM=1, kubectl runs inside VM so it needs paths inside VM; copy chunked files there.
if [[ "$USE_IN_VM" == "1" ]]; then
  _copy_manifest_to_vm "$MANIFEST_DIR"
  APPLY_BASE="$VM_MANIFEST_DIR"
else
  APPLY_BASE="$MANIFEST_DIR"
fi
info "  Applying $CHUNK_COUNT documents (delay ${APPLY_DELAY}s between each)..."
FAILED_DOCS=()
for i in $(seq 0 $((CHUNK_COUNT - 1))); do
  name="chunk_$(printf '%03d' "$i").yaml"
  f="$APPLY_BASE/$name"
  if ! _apply_one_doc "$f"; then
    FAILED_DOCS+=("$name")
    warn "  $name failed after $DOC_RETRIES retries (continuing with next doc)"
  fi
  sleep "$APPLY_DELAY"
done
if [[ ${#FAILED_DOCS[@]} -gt 0 ]]; then
  warn "Phase 2 had ${#FAILED_DOCS[@]} failed doc(s): ${FAILED_DOCS[*]}. Re-run script to retry; already-applied resources will be unchanged."
  # Don't exit - we may have applied enough for controller/speaker; try phase 3
fi
ok "Phase 2 done (doc-by-doc with QPS delay)"
sleep 5

# Wait for webhook endpoints so pool apply does not hit InternalError
info "Waiting for webhook-service endpoints..."
for _w in $(seq 1 45); do
  if _kubectl get endpoints -n metallb-system webhook-service -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null | grep -q .; then
    ok "Webhook ready"
    break
  fi
  [[ $_w -eq 45 ]] && warn "Webhook not ready after 90s; pool apply may fail with InternalError"
  sleep 2
done
sleep "$APPLY_DELAY"

# Phase 3: Pool + L2
info "Phase 3/3: Applying IPAddressPool and L2Advertisement..."
for _attempt in $(seq 1 "$RETRIES"); do
  if _kubectl apply -f - --validate=false <<EOF 2>/dev/null; then
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: record-platform-pool
  namespace: metallb-system
spec:
  addresses:
  - ${METALLB_POOL}
---
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: record-platform-l2
  namespace: metallb-system
spec:
  ipAddressPools:
  - record-platform-pool
EOF
    break
  fi
  [[ $_attempt -lt $RETRIES ]] && { info "Pool attempt $_attempt failed; sleeping ${RETRY_SLEEP}s..."; sleep "$RETRY_SLEEP"; }
  [[ $_attempt -eq $RETRIES ]] && { warn "Pool phase failed. Controller/speaker may be running; apply pool later. See install-metallb.sh for pool YAML."; exit 1; }
done
ok "Pool and L2 applied"

info "MetalLB installed (chunked, QPS-friendly). Verify: kubectl -n metallb-system get pods; kubectl get ipaddresspool -n metallb-system"
info "LoadBalancer services will get an IP from $METALLB_POOL. Check: kubectl get svc -A | grep LoadBalancer"
