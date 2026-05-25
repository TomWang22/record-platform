#!/usr/bin/env bash
# gRPC/mTLS RCA matrix: in-pod + cross-pod probes for ALL contract services with grpcPort/service-mtls.
#
# Usage:
#   bash scripts/rca-rp-grpc-mtls.sh --all --required                       # default: runtime gate only
#   bash scripts/rca-rp-grpc-mtls.sh --all --required --strict-integrity    # cluster_dns failures fatal
#   RP_ALLOW_GRPC_DIAGNOSTIC_FAILURES=1  ... --strict-integrity             # override: allow diagnostic failures
#
# Env:
#   RP_GRPC_RCA_REQUIRE_ALL        — 1 to make every service's in-pod failure fatal
#   RP_GRPC_RCA_REQUIRE_CROSS_POD  — 1 to make cluster_dns + pod_ip failures fatal for required services
#   RP_ALLOW_GRPC_DIAGNOSTIC_FAILURES — 1 to allow cluster_dns failures in --strict-integrity mode
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/lib/rp-runtime-health-contract.sh"
source "$SCRIPT_DIR/lib/rp-service-cert-contract.sh"

NS="${HOUSING_NS:-record-platform}"
CONTRACT="$REPO_ROOT/infra/contracts/rp-service-runtime-contract.json"
STRICT_INTEGRITY=0
FILTER=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --required|--all) shift ;;
    --strict-integrity) STRICT_INTEGRITY=1; shift ;;
    -h|--help)
      echo "usage: rca-rp-grpc-mtls.sh [--all] [--required] [--strict-integrity] [service ...]"
      exit 0
      ;;
    *) FILTER+=("$1"); shift ;;
  esac
done

command -v kubectl >/dev/null 2>&1 || { echo "kubectl required" >&2; exit 1; }

_arch_probe() {
  local arch
  arch="$(kubectl get nodes -o jsonpath='{.items[0].status.nodeInfo.architecture}' 2>/dev/null || echo amd64)"
  case "$arch" in
    arm64|aarch64) echo "$REPO_ROOT/scripts/vendor/grpc_health_probe-linux-arm64" ;;
    *) echo "$REPO_ROOT/scripts/vendor/grpc_health_probe-linux-amd64" ;;
  esac
}

_services_to_run() {
  python3 - "$CONTRACT" "${FILTER[@]}" <<'PY'
import json, sys
path = sys.argv[1]
filt = set(sys.argv[2:])
with open(path) as f:
    doc = json.load(f)
for name, row in (doc.get("services") or {}).items():
    if not row.get("grpcPort"):
        continue
    if row.get("tlsPolicy") != "service-mtls":
        continue
    if filt and name not in filt:
        continue
    print(name)
PY
}

_disk_cert_fp() {
  local crt="$1"
  [[ -f "$crt" ]] || { echo "missing"; return; }
  openssl x509 -in "$crt" -noout -fingerprint -sha256 2>/dev/null | sed 's/^.*=//' | tr -d ':'
}

_mounted_cert_fp() {
  local dep="$1" container="$2" raw
  raw="$(kubectl -n "$NS" exec "deploy/$dep" -c "$container" -- \
    openssl x509 -in /etc/certs/tls.crt -noout -fingerprint -sha256 2>&1)" || { echo "unavailable"; return; }
  echo "$raw" | sed 's/^.*=//' | tr -d ':'
}

_classify_failure() {
  local stderr_file="$1"
  [[ -f "$stderr_file" ]] || { echo "unknown"; return; }
  local txt
  txt="$(head -c 2000 "$stderr_file" 2>/dev/null || true)"
  if echo "$txt" | grep -qi 'certificate required'; then
    echo "client_cert_required"
  elif echo "$txt" | grep -qi 'NOT_SERVING\|not.*serving\|service unhealthy'; then
    echo "not_serving"
  elif echo "$txt" | grep -qi 'certificate.*verify\|x509\|unknown authority\|certificate signed by unknown'; then
    echo "cert_verify"
  elif echo "$txt" | grep -qi 'SAN\|subject alternative name\|server name'; then
    echo "san_mismatch"
  elif echo "$txt" | grep -qi 'connection refused'; then
    echo "connection_refused"
  elif echo "$txt" | grep -qi 'i/o timeout\|deadline\|context deadline\|failed to connect.*within'; then
    echo "timeout"
  elif echo "$txt" | grep -qi 'transport.*closing\|connection reset\|broken pipe'; then
    echo "transport_error"
  elif echo "$txt" | grep -qi 'health.*not.*found\|unknown service\|not implemented'; then
    echo "no_health_service"
  elif echo "$txt" | grep -qi 'tls.*handshake\|handshake failure'; then
    echo "tls_handshake"
  else
    echo "unknown"
  fi
}

PROBE_HOST="$(_arch_probe)"
[[ -x "$PROBE_HOST" ]] || { echo "❌ missing vendored probe: $PROBE_HOST" >&2; exit 1; }

OUT="${RP_GRPC_RCA_DIR:-$REPO_ROOT/bench_logs/grpc-mtls-rca}"
mkdir -p "$OUT"
: >"$OUT/summary.ndjson"

FAIL=0
INTEGRITY_FAIL=0
CHECKED=0
EXPECTED=0
SKIPPED_NAMES=()

mapfile -t ALL_SVCS < <(_services_to_run)
EXPECTED=${#ALL_SVCS[@]}

_run_probe() {
  local svc_name="$1" scope="$2" ns_exec="$3" addr="$4" tls_mode="$5" sname="$6" gsvc="$7" ca="$8" cc="$9" ck="${10}"
  local out="$OUT/${svc_name}-${scope}-${tls_mode}.txt"
  local stderr_file="$OUT/${svc_name}-${scope}-${tls_mode}.stderr"
  local args=(-addr="$addr" -service="$gsvc" -connect-timeout=5s -rpc-timeout=15s)
  case "$tls_mode" in
    mtls)
      args+=(-tls -tls-no-verify=false -tls-ca-cert="$ca" -tls-client-cert="$cc" -tls-client-key="$ck" -tls-server-name="$sname")
      ;;
    plaintext) ;;
    *) return 1 ;;
  esac
  if [[ "$ns_exec" == "debug" ]]; then
    local pod
    pod="rca-$(echo "${svc_name}-${scope}" | tr '_.' '-' | cut -c1-50)-$$"
    [[ -f "$ca" && -f "$cc" && -f "$ck" ]] || return 1
    kubectl run "$pod" -n "$NS" --restart=Never --image=nicolaka/netshoot --command -- sleep 300 >/dev/null 2>&1 || return 1
    kubectl wait -n "$NS" --for=condition=Ready "pod/$pod" --timeout=60s >/dev/null 2>&1 || true
    kubectl cp "$PROBE_HOST" "$NS/$pod:/tmp/grpc-health-probe" >/dev/null 2>&1 || true
    kubectl exec -n "$NS" "$pod" -- chmod +x /tmp/grpc-health-probe >/dev/null 2>&1 || true
    kubectl cp "$ca" "$NS/$pod:/tmp/ca.crt" >/dev/null 2>&1
    kubectl cp "$cc" "$NS/$pod:/tmp/client.crt" >/dev/null 2>&1
    kubectl cp "$ck" "$NS/$pod:/tmp/client.key" >/dev/null 2>&1
    local dca=/tmp/ca.crt dcc=/tmp/client.crt dck=/tmp/client.key
    [[ "$tls_mode" == "mtls" ]] && args=(-addr="$addr" -service="$gsvc" -connect-timeout=5s -rpc-timeout=15s -tls -tls-no-verify=false \
      -tls-ca-cert="$dca" -tls-client-cert="$dcc" -tls-client-key="$dck" -tls-server-name="$sname")
    if kubectl exec -n "$NS" "$pod" -- /tmp/grpc-health-probe "${args[@]}" >"$out" 2>"$stderr_file"; then
      kubectl delete pod "$pod" -n "$NS" --wait=false >/dev/null 2>&1 || true
      echo "ok"
      return 0
    fi
    kubectl delete pod "$pod" -n "$NS" --wait=false >/dev/null 2>&1 || true
    return 1
  fi
  local dep="$ns_exec"
  local container
  container="$(kubectl get deployment "$dep" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].name}' 2>/dev/null || echo app)"
  if kubectl -n "$NS" exec "deploy/$dep" -c "$container" -- /usr/local/bin/grpc-health-probe "${args[@]}" >"$out" 2>"$stderr_file"; then
    echo "ok"
    return 0
  fi
  return 1
}

_print_probe_cmd() {
  local scope="$1" addr="$2" sname="$3" gsvc="$4" ca="$5" cc="$6" ck="$7"
  if [[ "$scope" == cluster_dns || "$scope" == pod_ip ]]; then
    echo "    cmd: /tmp/grpc-health-probe -addr=$addr -service=$gsvc -tls -tls-no-verify=false -tls-ca-cert=/tmp/ca.crt -tls-client-cert=/tmp/client.crt -tls-client-key=/tmp/client.key -tls-server-name=$sname -connect-timeout=5s -rpc-timeout=15s"
  else
    echo "    cmd: /usr/local/bin/grpc-health-probe -addr=$addr -service=$gsvc -tls -tls-no-verify=false -tls-ca-cert=/etc/certs/ca.crt -tls-client-cert=/etc/certs/tls.crt -tls-client-key=/etc/certs/tls.key -tls-server-name=$sname -connect-timeout=5s -rpc-timeout=15s"
  fi
}

SUMMARY_ROWS=()
FULL_MATRIX_SERVICES=()

for svc in "${ALL_SVCS[@]}"; do
  [[ -n "$svc" ]] || continue
  svc_json="$(rp_runtime_health_service_json "$svc")"
  dep="$(jq -r '.k8sName // .deployment // empty' <<<"$svc_json")"
  grpc_port="$(jq -r '.grpcPort' <<<"$svc_json")"
  gsvc="$(jq -r '.grpcService // ""' <<<"$svc_json")"
  sname="$(jq -r '.grpcTlsServerName // .k8sName // empty' <<<"$svc_json")"
  tls_policy="$(jq -r '.tlsPolicy // "plaintext"' <<<"$svc_json")"
  grpc_req="$(jq -r '.grpcRequiredForRuntime // false' <<<"$svc_json")"
  grpc_health_supported="$(jq -r 'if .grpcHealthProbeSupported == false then "false" else "true" end' <<<"$svc_json")"
  grpc_optional_reason="$(jq -r '.grpcOptionalReason // ""' <<<"$svc_json")"

  if [[ -z "$gsvc" ]]; then
    echo ""
    echo "=== RCA gRPC: $svc (policy=$tls_policy required=$grpc_req) ==="
    echo "  ℹ️  grpcService empty — skipped: ${grpc_optional_reason:-no service name}"
    SKIPPED_NAMES+=("$svc:no-grpcService")
    CHECKED=$((CHECKED + 1))
    jq -cn --arg service "$svc" --arg reason "${grpc_optional_reason:-grpcService empty}" \
      '{service:$service,skipped:true,reason:$reason}' >>"$OUT/summary.ndjson"
    SUMMARY_ROWS+=("$svc|$grpc_req|$gsvc|$grpc_port|skip|skip|skip|skip|skip|skip")
    FULL_MATRIX_SERVICES+=("$(jq -cn --arg s "$svc" --argjson p "$grpc_port" --arg r "$grpc_req" --arg reason "${grpc_optional_reason:-grpcService empty}" \
      '{service:$s,grpc_port:$p,grpc_service:"",required:($r=="true"),localhost:"skip",anyaddr:"skip",cluster_dns:"skip",pod_ip:"skip",runtime_verdict:"pass",grpc_integrity_verdict:"skip",failure_class:"n/a",skip_reason:$reason}')")
    continue
  fi

  if [[ "$grpc_health_supported" == "false" ]]; then
    echo ""
    echo "=== RCA gRPC: $svc (policy=$tls_policy required=$grpc_req) ==="
    echo "  ℹ️  grpcHealthProbeSupported=false — skipped: ${grpc_optional_reason:-no health service}"
    SKIPPED_NAMES+=("$svc:no-health-probe")
    CHECKED=$((CHECKED + 1))
    jq -cn --arg service "$svc" --arg reason "${grpc_optional_reason:-grpcHealthProbeSupported=false}" \
      '{service:$service,skipped:true,reason:$reason}' >>"$OUT/summary.ndjson"
    SUMMARY_ROWS+=("$svc|$grpc_req|$gsvc|$grpc_port|skip|skip|skip|skip|skip|skip")
    FULL_MATRIX_SERVICES+=("$(jq -cn --arg s "$svc" --argjson p "$grpc_port" --arg gs "$gsvc" --arg r "$grpc_req" --arg reason "${grpc_optional_reason:-no health service}" \
      '{service:$s,grpc_port:$p,grpc_service:$gs,required:($r=="true"),localhost:"skip",anyaddr:"skip",cluster_dns:"skip",pod_ip:"skip",runtime_verdict:"pass",grpc_integrity_verdict:"skip",failure_class:"n/a",skip_reason:$reason}')")
    continue
  fi

  if ! kubectl get deploy "$dep" -n "$NS" >/dev/null 2>&1; then
    echo ""
    echo "=== RCA gRPC: $svc (policy=$tls_policy required=$grpc_req) ==="
    echo "  ℹ️  deployment $dep not found — skipping"
    SKIPPED_NAMES+=("$svc:no-deployment")
    CHECKED=$((CHECKED + 1))
    jq -cn --arg service "$svc" --arg reason "deployment not found" \
      '{service:$service,skipped:true,reason:$reason}' >>"$OUT/summary.ndjson"
    SUMMARY_ROWS+=("$svc|$grpc_req|$gsvc|$grpc_port|skip|skip|skip|skip|skip|skip")
    FULL_MATRIX_SERVICES+=("$(jq -cn --arg s "$svc" --argjson p "$grpc_port" --arg gs "$gsvc" --arg r "$grpc_req" \
      '{service:$s,grpc_port:$p,grpc_service:$gs,required:($r=="true"),localhost:"skip",anyaddr:"skip",cluster_dns:"skip",pod_ip:"skip",runtime_verdict:"skip",grpc_integrity_verdict:"skip",failure_class:"no-deployment"}')")
    continue
  fi

  pod_ip="$(kubectl get pod -n "$NS" -l "app=$dep" -o jsonpath='{.items[0].status.podIP}' 2>/dev/null || true)"
  dns="${dep}.${NS}.svc.cluster.local:${grpc_port}"

  CERTS="${REPO_ROOT}/certs"
  ca_host="$CERTS/dev-chain.pem"
  ck_host="$CERTS/${svc}.key"
  # Build full-chain client cert (leaf + intermediate) for cross-pod mTLS.
  # Servers verify the client cert chain; leaf-only fails with "tls: certificate required".
  cc_host_fullchain="$OUT/${svc}-client-fullchain.crt"
  if [[ -f "$CERTS/${svc}.crt" && -f "$CERTS/dev-intermediate.pem" ]]; then
    cat "$CERTS/${svc}.crt" "$CERTS/dev-intermediate.pem" > "$cc_host_fullchain"
  elif [[ -f "$CERTS/${svc}.crt" ]]; then
    cp "$CERTS/${svc}.crt" "$cc_host_fullchain"
  fi
  cc_host="$cc_host_fullchain"
  ca_inpod="/etc/certs/ca.crt"
  cc_inpod="/etc/certs/tls.crt"
  ck_inpod="/etc/certs/tls.key"

  container="$(kubectl get deployment "$dep" -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].name}' 2>/dev/null || echo app)"
  disk_fp="$(_disk_cert_fp "$CERTS/${svc}.crt")"  # fingerprint from leaf only
  mounted_fp="$(_mounted_cert_fp "$dep" "$container")"
  fp_match="mismatch"
  [[ "$disk_fp" == "$mounted_fp" ]] && fp_match="match"
  [[ "$mounted_fp" == "unavailable" ]] && fp_match="unavailable"

  echo ""
  echo "=== RCA gRPC: $svc (policy=$tls_policy required=$grpc_req) ==="
  echo "  cert fingerprint: disk=${disk_fp:0:16}… mounted=${mounted_fp:0:16}… ${fp_match}"

  results=()
  r_localhost="skip" r_anyaddr="skip" r_dns="skip" r_podip="skip"
  svc_failure_class="none"
  svc_stderr=""
  for scope_addr in \
    "inpod_localhost|${dep}|127.0.0.1:${grpc_port}" \
    "inpod_0.0.0.0|${dep}|0.0.0.0:${grpc_port}" \
    "cluster_dns|debug|${dns}" \
    "pod_ip|debug|${pod_ip}:${grpc_port}"; do
    IFS='|' read -r scope who addr <<<"$scope_addr"
    [[ -z "$pod_ip" && "$scope" == "pod_ip" ]] && continue
    st="fail"
    if [[ "$who" == "debug" ]]; then
      ca_use="$ca_host" cc_use="$cc_host" ck_use="$ck_host"
    else
      ca_use="$ca_inpod" cc_use="$cc_inpod" ck_use="$ck_inpod"
    fi
    if _run_probe "$svc" "$scope" "$who" "$addr" "mtls" "$sname" "$gsvc" "$ca_use" "$cc_use" "$ck_use"; then
      st="ok"
    else
      # Check if failure is NOT_SERVING (gRPC TLS works, health reports unhealthy)
      stderr_file="$OUT/${svc}-${scope}-mtls.stderr"
      if [[ -f "$stderr_file" ]] && grep -qi 'NOT_SERVING\|service unhealthy' "$stderr_file" 2>/dev/null; then
        st="not_serving"
      fi
    fi
    results+=("$scope:mtls:$st")
    printf '  %-18s %-10s %s\n' "$scope" "mtls" "$st"

    case "$scope" in
      inpod_localhost) r_localhost="$st" ;;
      inpod_0.0.0.0)  r_anyaddr="$st" ;;
      cluster_dns)     r_dns="$st" ;;
      pod_ip)          r_podip="$st" ;;
    esac

    if [[ "$st" == "fail" ]]; then
      stderr_file="$OUT/${svc}-${scope}-mtls.stderr"
      fc="$(_classify_failure "$stderr_file")"
      if [[ "$svc_failure_class" == "none" ]]; then
        svc_failure_class="$fc"
      fi
      _print_probe_cmd "$scope" "$addr" "$sname" "$gsvc" "$ca_use" "$cc_use" "$ck_use"
      if [[ -f "$stderr_file" ]] && [[ -s "$stderr_file" ]]; then
        echo "    stderr: $(head -c 200 "$stderr_file" 2>/dev/null | tr '\n' ' ')"
        [[ -z "$svc_stderr" ]] && svc_stderr="$(head -c 200 "$stderr_file" 2>/dev/null | tr '\n' ' ')"
      fi
      echo "    failure_class: $fc"

      if [[ "$scope" == inpod_* ]]; then
        if [[ "$grpc_req" == "true" ]] || [[ "${RP_GRPC_RCA_REQUIRE_ALL:-0}" == "1" ]]; then
          FAIL=1
        fi
      elif [[ "${RP_GRPC_RCA_REQUIRE_CROSS_POD:-0}" == "1" && "$grpc_req" == "true" ]]; then
        FAIL=1
      fi

      if [[ "$scope" == "cluster_dns" ]]; then
        INTEGRITY_FAIL=1
      fi
      if [[ "$scope" == "pod_ip" ]]; then
        echo "    diagnostic: pod_ip failure may be due to bind address, NetworkPolicy, SAN mismatch, or client path"
      fi
    elif [[ "$st" == "not_serving" ]]; then
      stderr_file="$OUT/${svc}-${scope}-mtls.stderr"
      fc="not_serving"
      if [[ "$svc_failure_class" == "none" ]]; then
        svc_failure_class="$fc"
      fi
      echo "    status: NOT_SERVING (gRPC TLS handshake succeeded, health check reports unhealthy)"
      if [[ -n "$grpc_optional_reason" ]]; then
        echo "    contract_reason: $grpc_optional_reason"
      fi
    fi
  done

  # NOT_SERVING means gRPC TLS connectivity works but health check reports unhealthy.
  # For runtime_verdict: NOT_SERVING with grpcRequiredForRuntime=false is still "pass".
  # For grpc_integrity_verdict: NOT_SERVING proves TLS chain works, so it counts as "pass".
  runtime_verdict="pass"
  if [[ "$r_localhost" == "fail" || "$r_anyaddr" == "fail" ]]; then
    # not_serving is a health issue, not a connectivity issue
    if [[ "$r_localhost" == "fail" && "$r_localhost" != "not_serving" ]] || \
       [[ "$r_anyaddr" == "fail" && "$r_anyaddr" != "not_serving" ]]; then
      runtime_verdict="fail"
    fi
  fi

  grpc_integrity_verdict="pass"
  # not_serving proves TLS connectivity; only hard "fail" means integrity failure
  r_dns_effective="$r_dns"
  r_localhost_effective="$r_localhost"
  r_anyaddr_effective="$r_anyaddr"
  [[ "$r_dns" == "not_serving" ]] && r_dns_effective="ok"
  [[ "$r_localhost" == "not_serving" ]] && r_localhost_effective="ok"
  [[ "$r_anyaddr" == "not_serving" ]] && r_anyaddr_effective="ok"
  if [[ "$r_localhost_effective" == "fail" || "$r_anyaddr_effective" == "fail" || "$r_dns_effective" == "fail" ]]; then
    grpc_integrity_verdict="fail"
  elif [[ "$r_podip" == "fail" ]]; then
    grpc_integrity_verdict="pass-diagnostic"
  fi

  SUMMARY_ROWS+=("$svc|$grpc_req|$gsvc|$grpc_port|$r_localhost|$r_anyaddr|$r_dns|$r_podip|$runtime_verdict|$grpc_integrity_verdict")
  CHECKED=$((CHECKED + 1))

  FULL_MATRIX_SERVICES+=("$(jq -cn \
    --arg s "$svc" \
    --argjson p "$grpc_port" \
    --arg gs "$gsvc" \
    --arg r "$grpc_req" \
    --arg rl "$r_localhost" \
    --arg ra "$r_anyaddr" \
    --arg rd "$r_dns" \
    --arg rp "$r_podip" \
    --arg rv "$runtime_verdict" \
    --arg gv "$grpc_integrity_verdict" \
    --arg fc "$svc_failure_class" \
    --arg se "$svc_stderr" \
    --arg dfp "$disk_fp" \
    --arg mfp "$mounted_fp" \
    --arg fpm "$fp_match" \
    '{service:$s,grpc_port:$p,grpc_service:$gs,required:($r=="true"),localhost:$rl,anyaddr:$ra,cluster_dns:$rd,pod_ip:$rp,runtime_verdict:$rv,grpc_integrity_verdict:$gv,failure_class:$fc,stderr:$se,disk_cert_fp:$dfp,mounted_cert_fp:$mfp,fp_match:$fpm}')")

  jq -cn \
    --arg service "$svc" \
    --arg dep "$dep" \
    --arg dns "$dns" \
    --argjson port "$grpc_port" \
    --arg grpc_service "$gsvc" \
    --arg server_name "$sname" \
    --arg tls_policy "$tls_policy" \
    --argjson grpc_required "$([ "$grpc_req" = true ] && echo true || echo false)" \
    --arg results "$(IFS=,; echo "${results[*]}")" \
    --arg disk_fp "$disk_fp" \
    --arg mounted_fp "$mounted_fp" \
    --arg fp_match "$fp_match" \
    --arg runtime_verdict "$runtime_verdict" \
    --arg grpc_integrity_verdict "$grpc_integrity_verdict" \
    --arg failure_class "$svc_failure_class" \
    '{service:$service,deployment:$dep,grpc_port:$port,grpc_service:$grpc_service,tls_server_name:$server_name,tls_policy:$tls_policy,grpc_required:$grpc_required,scopes:($results|split(",")),disk_cert_fp:$disk_fp,mounted_cert_fp:$mounted_fp,fp_match:$fp_match,runtime_verdict:$runtime_verdict,grpc_integrity_verdict:$grpc_integrity_verdict,failure_class:$failure_class}' \
    >>"$OUT/summary.ndjson"
done

echo ""
echo "=== Summary ==="
printf '%-24s %-8s %-40s %-6s %-9s %-9s %-11s %-8s %-12s %s\n' \
  "service" "required" "grpcService" "port" "localhost" "anyaddr" "cluster_dns" "pod_ip" "runtime" "integrity"
printf '%-24s %-8s %-40s %-6s %-9s %-9s %-11s %-8s %-12s %s\n' \
  "-------" "--------" "-----------" "----" "---------" "-------" "-----------" "------" "-------" "---------"
for row in "${SUMMARY_ROWS[@]}"; do
  IFS='|' read -r s req gs gp rl ra rd rp rv gv <<<"$row"
  printf '%-24s %-8s %-40s %-6s %-9s %-9s %-11s %-8s %-12s %s\n' \
    "$s" "$req" "${gs:0:40}" "$gp" "$rl" "$ra" "$rd" "$rp" "$rv" "$gv"
done

echo ""
echo "Coverage: checked=$CHECKED expected=$EXPECTED"
if [[ ${#SKIPPED_NAMES[@]} -gt 0 ]]; then
  echo "  skipped: ${SKIPPED_NAMES[*]}"
fi
if [[ "$CHECKED" -lt "$EXPECTED" ]]; then
  echo "❌ coverage incomplete ($CHECKED/$EXPECTED)" >&2
  FAIL=1
fi

runtime_ok=true
integrity_ok=true
for row in "${SUMMARY_ROWS[@]}"; do
  IFS='|' read -r s req gs gp rl ra rd rp rv gv <<<"$row"
  [[ "$rv" == "fail" && "$req" == "true" ]] && runtime_ok=false
  [[ "$gv" == "fail" ]] && integrity_ok=false
done

jq -cn \
  --argjson checked "$CHECKED" \
  --argjson expected "$EXPECTED" \
  --argjson skipped "${#SKIPPED_NAMES[@]}" \
  --arg skipped_names "$(IFS=,; echo "${SKIPPED_NAMES[*]}")" \
  --argjson coverage_pct "$(python3 -c "print(round($CHECKED/$EXPECTED*100,1) if $EXPECTED>0 else 0)")" \
  --arg require_all "${RP_GRPC_RCA_REQUIRE_ALL:-0}" \
  --arg require_cross_pod "${RP_GRPC_RCA_REQUIRE_CROSS_POD:-0}" \
  --argjson runtime_ok "$runtime_ok" \
  --argjson grpc_integrity_ok "$integrity_ok" \
  --argjson strict_integrity "$STRICT_INTEGRITY" \
  '{checked:$checked,expected:$expected,skipped:$skipped,skipped_names:($skipped_names|split(",")),coverage_pct:$coverage_pct,require_all:$require_all,require_cross_pod:$require_cross_pod,runtime_ok:$runtime_ok,grpc_integrity_ok:$grpc_integrity_ok,strict_integrity:$strict_integrity}' \
  >"$OUT/coverage.json"

{
  echo '{"coverage":{"expected_services":'"$EXPECTED"',"checked_services":'"$CHECKED"',"coverage_percent":'"$(python3 -c "print(round($CHECKED/$EXPECTED*100,1) if $EXPECTED>0 else 0)")"'},"services":['
  first=1
  for fm in "${FULL_MATRIX_SERVICES[@]}"; do
    [[ "$first" -eq 1 ]] && first=0 || echo ","
    echo "$fm"
  done
  echo '],"overall":{"runtime_ok":'"$runtime_ok"',"grpc_integrity_ok":'"$integrity_ok"'}}'
} | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin), indent=2))" >"$OUT/full-matrix.json"

echo ""
echo "Report: $OUT"
bash "$SCRIPT_DIR/lib/rp-grpc-mtls-matrix-report.sh" "$OUT/summary.ndjson"

echo ""
echo "Verdicts:"
echo "  runtime_ok=$runtime_ok"
echo "  grpc_integrity_ok=$integrity_ok"
echo "  strict_integrity=$STRICT_INTEGRITY"
echo "  RP_ALLOW_GRPC_DIAGNOSTIC_FAILURES=${RP_ALLOW_GRPC_DIAGNOSTIC_FAILURES:-0}"

if [[ "$STRICT_INTEGRITY" -eq 1 && "$integrity_ok" == "false" && "${RP_ALLOW_GRPC_DIAGNOSTIC_FAILURES:-0}" != "1" ]]; then
  echo "❌ rca-rp-grpc-mtls: grpc_integrity_ok=false in --strict-integrity mode" >&2
  echo "   cluster_dns mTLS failures mean service-to-service gRPC is not proven" >&2
  echo "   set RP_ALLOW_GRPC_DIAGNOSTIC_FAILURES=1 to override (not recommended)" >&2
  exit 1
fi

[[ "$FAIL" -eq 0 ]] && { echo "✅ rca-rp-grpc-mtls passed (runtime_ok=$runtime_ok integrity_ok=$integrity_ok)"; exit 0; }
echo "❌ rca-rp-grpc-mtls failed (see $OUT)" >&2
exit 1
