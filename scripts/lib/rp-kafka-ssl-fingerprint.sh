#!/usr/bin/env bash
# Kafka trust bundle fingerprint — must match ca-cert.pem bytes in disk secret and annotation.
# shellcheck disable=SC2034
rp_kafka_ssl_ca_fingerprint() {
  local pem="$1"
  [[ -f "$pem" ]] || return 1
  openssl x509 -in "$pem" -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2 | tr -d '\r\n'
}

# kubectl go-template prints "<no value>" when an annotation key is absent (not empty string).
rp_kafka_ssl_annotation_value() {
  local raw="${1:-}"
  raw="${raw//$'\r'/}"
  raw="${raw//$'\n'/}"
  if [[ -z "$raw" || "$raw" == "<no value>" ]]; then
    return 1
  fi
  printf '%s' "$raw"
}

rp_kafka_ssl_fingerprint_diag() {
  local disk_fp="$1" secret_fp="$2" ann_fp="$3"
  local rv="${4:-}" cts="${5:-}"
  printf '     disk ca-cert.pem:     %s\n' "${disk_fp:-?}"
  printf '     secret ca-cert.pem:   %s\n' "${secret_fp:-?}"
  printf '     annotation rp.dev:    %s\n' "${ann_fp:-?}"
  [[ -n "$rv" ]] && printf '     secret resourceVersion: %s\n' "$rv"
  [[ -n "$cts" ]] && printf '     secret created:         %s\n' "$cts"
}

# Returns 0 when disk, live secret data, and annotation all match.
rp_kafka_ssl_verify_triple_match() {
  local ns="${1:-record-platform}"
  local disk_pem="${2:-${REPO_ROOT:-.}/certs/kafka-ssl/ca-cert.pem}"
  local tmp
  tmp="$(mktemp)"
  # shellcheck disable=SC2064
  trap 'rm -f "$tmp"' RETURN

  [[ -f "$disk_pem" ]] || { echo "missing disk ca-cert.pem: $disk_pem" >&2; return 1; }
  if ! kubectl get secret kafka-ssl-secret -n "$ns" --request-timeout=20s >/dev/null 2>&1; then
    echo "kafka-ssl-secret missing in $ns" >&2
    return 1
  fi

  local disk_fp secret_fp ann_fp rv cts
  disk_fp="$(rp_kafka_ssl_ca_fingerprint "$disk_pem")"
  kubectl get secret kafka-ssl-secret -n "$ns" -o jsonpath='{.data.ca-cert\.pem}' --request-timeout=25s 2>/dev/null \
    | base64 -d >"$tmp" || true
  [[ -s "$tmp" ]] || { echo "secret missing ca-cert.pem data" >&2; return 1; }
  secret_fp="$(rp_kafka_ssl_ca_fingerprint "$tmp")"
  ann_fp="$(kubectl get secret kafka-ssl-secret -n "$ns" \
    -o go-template='{{index .metadata.annotations "rp.dev/ca-fingerprint-sha256"}}' 2>/dev/null | tr -d '\r\n' || true)"
  ann_fp="$(rp_kafka_ssl_annotation_value "$ann_fp" || true)"
  rv="$(kubectl get secret kafka-ssl-secret -n "$ns" -o jsonpath='{.metadata.resourceVersion}' 2>/dev/null || true)"
  cts="$(kubectl get secret kafka-ssl-secret -n "$ns" -o jsonpath='{.metadata.creationTimestamp}' 2>/dev/null || true)"

  if [[ -z "$disk_fp" || -z "$secret_fp" ]]; then
    rp_kafka_ssl_fingerprint_diag "$disk_fp" "$secret_fp" "$ann_fp" "$rv" "$cts" >&2
    return 1
  fi
  if [[ "$disk_fp" != "$secret_fp" ]]; then
    echo "disk ca-cert.pem fingerprint != live secret data" >&2
    rp_kafka_ssl_fingerprint_diag "$disk_fp" "$secret_fp" "$ann_fp" "$rv" "$cts" >&2
    return 1
  fi
  if [[ -z "$ann_fp" ]]; then
    echo "kafka-ssl-secret missing rp.dev/ca-fingerprint-sha256 (canonical writer: scripts/apply-rp-kafka-ssl-secret.sh)" >&2
    rp_kafka_ssl_fingerprint_diag "$disk_fp" "$secret_fp" "$ann_fp" "$rv" "$cts" >&2
    return 1
  fi
  if [[ "$ann_fp" != "$disk_fp" ]]; then
    echo "annotation rp.dev/ca-fingerprint-sha256 != ca-cert.pem (stale partial apply?)" >&2
    rp_kafka_ssl_fingerprint_diag "$disk_fp" "$secret_fp" "$ann_fp" "$rv" "$cts" >&2
    return 1
  fi
  return 0
}

# Verify live secret ca-cert.pem matches rp.dev/ca-fingerprint-sha256 (not legacy rp.dev).
rp_kafka_ssl_verify_secret_ca_annotation() {
  local ns="${1:-record-platform}"
  local live_pem="$2"
  local live_fp legacy_ann rp_ann

  [[ -f "$live_pem" && -s "$live_pem" ]] || {
    echo "missing live ca-cert.pem: $live_pem" >&2
    return 1
  }
  live_fp="$(rp_kafka_ssl_ca_fingerprint "$live_pem")"
  [[ -n "$live_fp" ]] || {
    echo "could not fingerprint live ca-cert.pem" >&2
    return 1
  }

  legacy_ann="$(kubectl get secret kafka-ssl-secret -n "$ns" \
    -o go-template='{{index .metadata.annotations "rp.dev/ca-fingerprint-sha256"}}' 2>/dev/null | tr -d '\r\n' || true)"
  if rp_kafka_ssl_annotation_value "$legacy_ann" >/dev/null; then
    legacy_ann="$(rp_kafka_ssl_annotation_value "$legacy_ann")"
    echo "kafka-ssl-secret still has legacy rp.dev/ca-fingerprint-sha256=$legacy_ann (run scripts/apply-rp-kafka-ssl-secret.sh)" >&2
    return 1
  fi

  rp_ann="$(kubectl get secret kafka-ssl-secret -n "$ns" \
    -o go-template='{{index .metadata.annotations "rp.dev/ca-fingerprint-sha256"}}' 2>/dev/null | tr -d '\r\n' || true)"
  if ! rp_ann="$(rp_kafka_ssl_annotation_value "$rp_ann")"; then
    echo "kafka-ssl-secret missing rp.dev/ca-fingerprint-sha256 (canonical writer: scripts/apply-rp-kafka-ssl-secret.sh)" >&2
    return 1
  fi
  if [[ "$rp_ann" != "$live_fp" ]]; then
    echo "rp.dev/ca-fingerprint-sha256 ($rp_ann) != live ca-cert.pem ($live_fp)" >&2
    return 1
  fi
  return 0
}
