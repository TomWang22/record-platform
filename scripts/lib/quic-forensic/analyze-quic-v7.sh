#!/usr/bin/env bash
# Transport invariant v7: reshapes v6 forensic JSON + capture window + ALPN + cert + spin-bit metadata.
# CI must not require spin bit, 0-RTT, or congestion; strict gate is frame_count, spaces, cipher, ALPN h3, VN==0, 1RTT present.
set -euo pipefail

PCAP="${1:-}"
KEYLOG="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "$PCAP" ]] || [[ ! -f "$PCAP" ]]; then
  echo '{"valid":false,"error":"pcap path required"}'
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo '{"valid":false,"error":"jq not installed"}'
  exit 2
fi

v6_analyzer="${SCRIPT_DIR}/analyze-quic-v6.sh"
if [[ ! -f "$v6_analyzer" ]]; then
  echo '{"valid":false,"error":"analyze-quic-v6.sh missing"}'
  exit 2
fi

tmp_v6="$(mktemp)"
trap 'rm -f "$tmp_v6"' EXIT

if ! "$v6_analyzer" "$PCAP" "$KEYLOG" >"$tmp_v6" 2>/dev/null; then
  cat "$tmp_v6" 2>/dev/null || echo '{"valid":false,"error":"v6 analyzer failed"}'
  exit 1
fi

tls_args=()
if [[ -n "$KEYLOG" ]] && [[ -f "$KEYLOG" ]]; then
  tls_args=(-o "tls.keylog_file:${KEYLOG}")
fi

# --- Certificate (ServerHello chain): prefer TLS handshake type 11 (Certificate) ---
cert_fp=""
if command -v tshark >/dev/null 2>&1; then
  cert_fp="$(tshark "${tls_args[@]}" -r "$PCAP" -Y 'tls.handshake.type == 11' -T fields -e x509af.sha256 2>/dev/null | awk 'NF{print; exit}' || true)"
  [[ -z "$cert_fp" ]] && cert_fp="$(tshark "${tls_args[@]}" -r "$PCAP" -Y 'tls.handshake.type == 11' -T fields -e x509af.sha256_fingerprint 2>/dev/null | awk 'NF{print; exit}' || true)"
  [[ -z "$cert_fp" ]] && cert_fp="$(tshark "${tls_args[@]}" -r "$PCAP" -Y 'tls.handshake.certificate' -T fields -e x509af.sha256 2>/dev/null | awk 'NF{print; exit}' || true)"
  [[ -z "$cert_fp" ]] && cert_fp="$(tshark "${tls_args[@]}" -r "$PCAP" -Y 'tls.handshake.certificate' -T fields -e x509af.sha256_fingerprint 2>/dev/null | awk 'NF{print; exit}' || true)"
fi

# DER hex → SHA-256 (colon upper hex) when tshark did not emit x509af.*
if [[ -z "$cert_fp" ]] && command -v tshark >/dev/null 2>&1 && command -v openssl >/dev/null 2>&1; then
  _der_hex="$(tshark "${tls_args[@]}" -r "$PCAP" -Y 'tls.handshake.certificate' -T fields -e tls.handshake.certificate 2>/dev/null | head -1 | tr -d ':\n\r ' || true)"
  if [[ -n "$_der_hex" ]] && [[ "$_der_hex" =~ ^[0-9a-fA-F]+$ ]] && (( ${#_der_hex} % 2 == 0 )); then
    cert_fp="$(printf '%s' "$_der_hex" | xxd -r -p 2>/dev/null | openssl dgst -sha256 2>/dev/null | awk '{print toupper($NF)}' | sed 's/\(..\)/\1:/g; s/:$//' || true)"
  fi
fi

# --- ALPN h3 (TLS decode; needs keylog for encrypted handshakes) ---
alpn_h3=""
if command -v tshark >/dev/null 2>&1; then
  alpn_h3="$(tshark "${tls_args[@]}" -r "$PCAP" -Y 'tls.handshake.extensions_alpn_str == "h3"' -T fields -e tls.handshake.extensions_alpn_str 2>/dev/null | head -1 | tr -d '\r' || true)"
fi

# --- QUIC capture window (epoch seconds) ---
cap_start=""
cap_end=""
if command -v tshark >/dev/null 2>&1; then
  cap_start="$(tshark -r "$PCAP" -Y quic -T fields -e frame.time_epoch 2>/dev/null | head -1 | tr -d '\r' || true)"
  cap_end="$(tshark -r "$PCAP" -Y quic -T fields -e frame.time_epoch 2>/dev/null | tail -1 | tr -d '\r' || true)"
fi

# --- Spin bit (optional; often disabled in production) ---
spin_supported="false"
spin_observed="false"
spin_transitions="0"
spin_est_rtt="null"
_spin_tmp="$(mktemp)"
trap 'rm -f "$tmp_v6" "$_spin_tmp"' EXIT
if command -v tshark >/dev/null 2>&1; then
  tshark -r "$PCAP" -Y quic -T fields -e quic.spin_bit 2>/dev/null >"$_spin_tmp" || true
  if grep -qE '^[01]$' "$_spin_tmp" 2>/dev/null; then
    spin_supported="true"
    spin_observed="true"
    spin_transitions="$(awk 'BEGIN{t=0;prev=""}
      /^[01]$/ {
        if (prev != "" && $1 != prev) t++
        prev=$1
      }
      END{print t+0}' "$_spin_tmp")"
  elif grep -qE . "$_spin_tmp" 2>/dev/null; then
    # Field present but empty / non-binary noise — treat as unsupported for invariant purposes
    spin_supported="false"
    spin_observed="false"
  fi
fi
rm -f "$_spin_tmp" 2>/dev/null || true

# RTT estimate from spin sample (same spirit as v6): first and third timestamp with spin samples
spin_est_rtt=""
if [[ "$spin_observed" == "true" ]] && command -v tshark >/dev/null 2>&1; then
  _t0="$(tshark -r "$PCAP" -Y 'quic && (quic.spin_bit == 0 || quic.spin_bit == 1)' -T fields -e frame.time_epoch 2>/dev/null | sed -n '1p' | tr -d '\r' || true)"
  _t2="$(tshark -r "$PCAP" -Y 'quic && (quic.spin_bit == 0 || quic.spin_bit == 1)' -T fields -e frame.time_epoch 2>/dev/null | sed -n '3p' | tr -d '\r' || true)"
  if [[ -n "$_t0" ]] && [[ -n "$_t2" ]]; then
    spin_est_rtt="$(python3 -c "print(float('$_t2')-float('$_t0'))" 2>/dev/null || true)"
  fi
fi

epoch_to_iso() {
  python3 -c 'import datetime,sys
e=sys.argv[1].strip()
if not e: print("")
else:
  print(datetime.datetime.utcfromtimestamp(float(e)).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]+"Z")' "$1" 2>/dev/null || echo ""
}

_hs_init="$(jq -r '.handshake.initial_packet_time // empty' "$tmp_v6" 2>/dev/null || true)"
_hs_hs="$(jq -r '.handshake.handshake_packet_time // empty' "$tmp_v6" 2>/dev/null || true)"
_hs_1r="$(jq -r '.handshake.first_1rtt_packet_time // empty' "$tmp_v6" 2>/dev/null || true)"
_iso_init="$(epoch_to_iso "$_hs_init")"
_iso_hs="$(epoch_to_iso "$_hs_hs")"
_iso_1r="$(epoch_to_iso "$_hs_1r")"

# Merge v6 cert if v7 extraction failed
jq \
  --arg alpn_override "$alpn_h3" \
  --arg cert_override "$cert_fp" \
  --arg cap_s "${cap_start:-}" \
  --arg cap_e "${cap_end:-}" \
  --argjson spin_sup "$( [[ "$spin_supported" == "true" ]] && echo true || echo false )" \
  --argjson spin_obs "$( [[ "$spin_observed" == "true" ]] && echo true || echo false )" \
  --argjson spin_tr "${spin_transitions:-0}" \
  --arg spin_est "${spin_est_rtt:-}" \
  --arg iso_init "${_iso_init:-}" \
  --arg iso_hs "${_iso_hs:-}" \
  --arg iso_1r "${_iso_1r:-}" \
  --arg gen_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
  '
  def map_space($s):
    if $s == "0" then "Initial"
    elif $s == "1" then "0RTT"
    elif $s == "2" then "Handshake"
    elif $s == "1RTT" then "1RTT"
    else $s end;

  def iso_or_null($s):
    if $s == null or $s == "" then null else $s end;

  . as $v6
  | ($v6.quic_frame_count // 0) as $fc
  | ($v6.packet_number_spaces // []) as $spaces
  | ($spaces | map(. as $p | {space: map_space($p.space), count: $p.count})) as $spaces_m
  | ($v6.tls // {}) as $tls0
  | ($tls0.selected_cipher_suite) as $cipher
  | (
      if ($cert_override != "") then $cert_override
      elif ($tls0.certificate_sha256 | tostring) != "" then $tls0.certificate_sha256
      else null end
    ) as $cert_m
  | (
      if ($alpn_override != "") then $alpn_override
      else null end
    ) as $alpn_m
  | ($v6.handshake // {}) as $hs
  | {
      valid: ($v6.valid // false),
      quic: {
        frame_count: $fc,
        versions: ($v6.quic_versions // []),
        packet_number_spaces: $spaces_m,
        version_negotiation_packets: ($v6.version_negotiation_packets // 0)
      },
      handshake: {
        initial_packet_time: (iso_or_null($iso_init)),
        first_handshake_packet_time: (iso_or_null($iso_hs)),
        first_1rtt_packet_time: (iso_or_null($iso_1r)),
        handshake_duration_seconds: ($hs.handshake_duration_seconds // null)
      },
      tls: {
        selected_cipher_suite: $cipher,
        certificate_sha256: $cert_m,
        alpn_protocol: $alpn_m
      },
      transport_behavior: {
        zero_rtt_detected: ($v6.zero_rtt.detected // false),
        spin_bit: {
          supported: $spin_sup,
          observed: $spin_obs,
          transitions: $spin_tr,
          estimated_rtt_seconds: (
            if ($spin_est == "") then null else ($spin_est | tonumber) end
          )
        },
        loss_estimate: ($v6.loss_signal.estimated_missing_packet_numbers // 0),
        congestion_estimate_packets_in_flight: ($v6.congestion_signal.max_packets_in_flight_estimate // 0)
      },
      connection: {
        unique_destination_cids: ($v6.connection_id.unique_destination_cids // 0),
        cid_rotation_detected: ($v6.connection_id.rotation_detected // false),
        key_phase_transitions: ($v6.key_update.key_phase_transitions // 0)
      },
      correlation: {
        trace_ids_seen: [],
        jaeger_trace_linked: false
      },
      capture_window: (
        if ($cap_s != "" and $cap_e != "") then
          { start_epoch: ($cap_s | tonumber), end_epoch: ($cap_e | tonumber) }
        else { start_epoch: null, end_epoch: null }
        end
      ),
      ci_metadata: {
        transport_invariant_version: "v7",
        generated_at: $gen_at,
        forensic_upstream: "tshark-json-v6+v7"
      }
    }
  ' "$tmp_v6"
