#!/usr/bin/env bash
# Shared per-service TLS chain verification (mounted /etc/certs in pod or host paths).
set -euo pipefail

_rp_cert_chain_verify_host() {
  local svc="$1" leaf="$2" chain="$3" ca="$4" hostname="$5"
  python3 - "$svc" "$leaf" "$chain" "$ca" "$hostname" <<'PY'
import json, subprocess, sys, re
from datetime import datetime, timezone

svc, leaf, chain, ca, hostname = sys.argv[1:6]

def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    return p.returncode, (p.stdout or "") + (p.stderr or "")

def x509_field(path, *args):
    rc, out = run(["openssl", "x509", "-in", path, "-noout", *args])
    return out.strip() if rc == 0 else ""

def split_chain(path):
    text = open(path, encoding="utf-8", errors="replace").read()
    certs = []
    cur = []
    for line in text.splitlines():
        cur.append(line)
        if line.strip() == "-----END CERTIFICATE-----":
            certs.append("\n".join(cur) + "\n")
            cur = []
    return certs

def parse_sans(path):
    ext = x509_field(path, "-ext", "subjectAltName")
    if not ext:
        return []
    return re.findall(r"DNS:([^,\s]+)", ext)

def not_after_ok(path):
    na = x509_field(path, "-enddate")
    if not na.startswith("notAfter="):
        return False, na
    # OpenSSL format: notAfter=Jun  2 12:00:00 2026 GMT
    try:
        dt = datetime.strptime(na.replace("notAfter=", "").strip(), "%b %d %H:%M:%S %Y %Z")
        dt = dt.replace(tzinfo=timezone.utc)
        return dt > datetime.now(timezone.utc), na
    except Exception:
        return True, na

certs = split_chain(chain)
chain_parts = len(certs)
if chain_parts < 1:
    print(json.dumps({"ok": False, "error": "no certificates in chain file"}))
    sys.exit(0)

with open(leaf, "w", encoding="utf-8") as f:
    f.write(certs[0])
intermediate = ""
if chain_parts >= 2:
    intermediate = certs[1]

subject = x509_field(leaf, "-subject")
issuer = x509_field(leaf, "-issuer")
serial = x509_field(leaf, "-serial")
nb = x509_field(leaf, "-startdate")
na = x509_field(leaf, "-enddate")
fp_rc, fp_out = run(["openssl", "x509", "-in", leaf, "-noout", "-fingerprint", "-sha256"])
fingerprint = ""
if fp_rc == 0:
    fingerprint = fp_out.split("=", 1)[-1].replace(":", "").strip()

expected = [
    svc,
    f"{svc}.record-platform",
    f"{svc}.record-platform.svc",
    f"{svc}.record-platform.svc.cluster.local",
]
sans = parse_sans(leaf)
san_ok = all(e in sans for e in expected)
record_local = "record.local" in subject or any("record.local" in s for s in sans)

expires_ok, expires_raw = not_after_ok(leaf)

# Strict chain verify (no -k, no insecure)
verify_cmd = ["openssl", "verify", "-CAfile", ca, leaf]
if chain_parts >= 2:
    # untrusted intermediate for verify
    untrusted = f"/tmp/rp-chain-{svc}-int.pem"
    with open(untrusted, "w", encoding="utf-8") as f:
        f.write(intermediate)
    verify_cmd = ["openssl", "verify", "-CAfile", ca, "-untrusted", untrusted, leaf]

verify_rc, verify_out = run(verify_cmd)
verify_ok = verify_rc == 0

# Hostname check (OpenSSL 3+) — -untrusted must precede -verify_hostname
host_cmd = ["openssl", "verify", "-CAfile", ca]
if chain_parts >= 2:
    host_cmd += ["-untrusted", f"/tmp/rp-chain-{svc}-int.pem"]
host_cmd += ["-verify_hostname", hostname, leaf]
host_rc, host_out = run(host_cmd)
hostname_ok = host_rc == 0

ok = (
    chain_parts >= 1
    and verify_ok
    and hostname_ok
    and san_ok
    and not record_local
    and expires_ok
)

print(json.dumps({
    "ok": ok,
    "chain_parts": chain_parts,
    "leaf_subject": subject,
    "issuer": issuer,
    "serial": serial,
    "not_before": nb,
    "not_after": na,
    "expires_ok": expires_ok,
    "san_list": sans,
    "san_ok": san_ok,
    "record_local": record_local,
    "verify_ok": verify_ok,
    "verify_out": verify_out.strip()[:500],
    "hostname_ok": hostname_ok,
    "hostname": hostname,
    "hostname_out": host_out.strip()[:300],
    "fingerprint_sha256": fingerprint,
}, separators=(",", ":")))
PY
}

rp_cert_chain_verify_mounted() {
  local svc="$1" dep="$2" container="${3:-app}" mount="${4:-/etc/certs}"
  local hostname="${svc}.record-platform.svc.cluster.local"
  local tmp
  tmp="$(mktemp -d)"
  kubectl -n "${HOUSING_NS:-record-platform}" exec "deploy/$dep" -c "$container" -- \
    cat "${mount}/tls.crt" >"$tmp/tls.crt" 2>/dev/null || { echo '{"ok":false,"error":"cannot read mounted tls.crt"}'; rm -rf "$tmp"; return 1; }
  kubectl -n "${HOUSING_NS:-record-platform}" exec "deploy/$dep" -c "$container" -- \
    cat "${mount}/ca.crt" >"$tmp/ca.crt" 2>/dev/null || { echo '{"ok":false,"error":"cannot read mounted ca.crt"}'; rm -rf "$tmp"; return 1; }
  _rp_cert_chain_verify_host "$svc" "$tmp/leaf.pem" "$tmp/tls.crt" "$tmp/ca.crt" "$hostname"
  rm -rf "$tmp"
}

rp_cert_chain_secret_fingerprint() {
  local secret="$1"
  local ns="${HOUSING_NS:-record-platform}"
  local tmp
  tmp="$(mktemp)"
  kubectl -n "$ns" get secret "$secret" -o jsonpath='{.data.tls\.crt}' 2>/dev/null | base64 -d >"$tmp" 2>/dev/null || true
  if [[ ! -s "$tmp" ]]; then
    echo "missing"
    rm -f "$tmp"
    return
  fi
  openssl x509 -in "$tmp" -noout -fingerprint -sha256 2>/dev/null | sed 's/^.*=//' | tr -d ':' || echo "unavailable"
  rm -f "$tmp"
}
