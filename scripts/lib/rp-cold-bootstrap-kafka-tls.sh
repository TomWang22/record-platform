#!/usr/bin/env bash
# Post-bootstrap Kafka TLS: verify after bootstrap-cluster P5b, or refresh if P5b was skipped.
rp_cb_refresh_kafka_tls_after_metallb() {
  local ns="${HOUSING_NS:-record-platform}"
  local script_dir="${RP_CB_REPO_ROOT}/scripts"
  local boot_log="${RP_CB_BOOTSTRAP_LOG:-${RP_CB_REPO_ROOT}/bench_logs/bootstrap-cluster.log}"
  local _p5b_done=0

  if [[ "${RP_SKIP_POST_BOOTSTRAP_KAFKA_TLS_REFRESH:-0}" == "1" ]]; then
    _p5b_done=1
  elif [[ -f "$boot_log" ]] && grep -q 'apply-kafka-kraft-staged complete' "$boot_log" 2>/dev/null; then
    _p5b_done=1
  fi

  if [[ "$_p5b_done" == "1" ]]; then
    printf '\n\033[1m▶ Kafka TLS verify-only (P5b already ran kafka-refresh in bootstrap-cluster)\033[0m\n'
    bash "$script_dir/print-rp-cert-proof.sh" || return 1
    make -C "$RP_CB_REPO_ROOT" rp-verify-kafka-cert-chain || return 1
    bash "$script_dir/verify-kafka-tls-sans.sh" || return 1
    echo "✅ Kafka TLS verified (skipped duplicate kafka-refresh-tls-from-lb)"
    return 0
  fi

  printf '\n\033[1m▶ Kafka TLS refresh (MetalLB SANs — P5b not seen in bootstrap log)\033[0m\n'
  export KAFKA_SSL_NS="$ns"
  export KAFKA_SSL_AUTO_METALLB_IPS=1
  if [[ -x "$script_dir/kafka-refresh-tls-from-lb.sh" ]]; then
    bash "$script_dir/kafka-refresh-tls-from-lb.sh" || return 1
  else
    bash "$script_dir/kafka-ssl-from-dev-root.sh" || return 1
  fi
  bash "$script_dir/print-rp-cert-proof.sh" || return 1
  make -C "$RP_CB_REPO_ROOT" rp-verify-kafka-cert-chain || return 1
  bash "$script_dir/verify-kafka-tls-sans.sh" || return 1
  echo "✅ Kafka TLS refreshed with live MetalLB SANs"
  return 0
}
