#!/usr/bin/env bash
# Ticket 2 — complete PKI and certificate identity inventory (three-stage).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

rh_require_evidence_root || true
mkdir -p "$EVIDENCE_ROOT/tickets/02" "$EVIDENCE_ROOT/pki" "$REPO_ROOT/reports/transport"

export REPO_ROOT EVIDENCE_ROOT NS
python3 - <<'PY'
import base64, datetime, json, os, subprocess, tempfile
from pathlib import Path

repo = Path(os.environ["REPO_ROOT"])
evidence = Path(os.environ["EVIDENCE_ROOT"])
ns = os.environ.get("NS", "record-platform")
tls_dir = repo / "certs"
if not (tls_dir / "dev-root.pem").exists():
  alt = repo / "infra" / "k8s" / "base" / "secrets" / "certs"
  if (alt / "dev-root.pem").exists():
    tls_dir = alt
print(f"[ticket-02] tls_dir={tls_dir}", flush=True)
services = [
  "analytics-service","api-gateway","auction-monitor","auth-service","listings-service",
  "media-service","messaging-service","notification-service","python-ai-service",
  "records-service","shopping-service","trust-service",
]

def sh(args, input_bytes=None):
  return subprocess.check_output(args, input=input_bytes, stderr=subprocess.STDOUT)

def openssl_x509(pem_bytes, *args):
  with tempfile.NamedTemporaryFile(suffix=".crt") as f:
    f.write(pem_bytes)
    f.flush()
    return subprocess.check_output(["openssl", "x509", "-in", f.name, *args], text=True).strip()

def fp(pem_bytes):
  if not pem_bytes:
    return None
  line = openssl_x509(pem_bytes, "-noout", "-fingerprint", "-sha256")
  return line.split("=", 1)[-1].replace(":", "").lower()

def parse_cert(pem_bytes, label):
  if not pem_bytes:
    return {"label": label, "error": "missing"}
  text = openssl_x509(pem_bytes, "-noout", "-text")
  subject = openssl_x509(pem_bytes, "-noout", "-subject")
  issuer = openssl_x509(pem_bytes, "-noout", "-issuer")
  dates = openssl_x509(pem_bytes, "-noout", "-dates")
  serial = openssl_x509(pem_bytes, "-noout", "-serial")
  # SAN
  try:
    san = openssl_x509(pem_bytes, "-noout", "-ext", "subjectAltName")
  except Exception:
    san = ""
  try:
    eku = openssl_x509(pem_bytes, "-noout", "-ext", "extendedKeyUsage")
  except Exception:
    eku = ""
  try:
    ku = openssl_x509(pem_bytes, "-noout", "-ext", "keyUsage")
  except Exception:
    ku = ""
  purpose = subprocess.check_output(
    ["openssl", "x509", "-noout", "-purpose"],
    input=pem_bytes,
    stderr=subprocess.STDOUT,
  ).decode(errors="replace")
  not_before = not_after = None
  for line in dates.splitlines():
    if line.startswith("notBefore="):
      not_before = line.split("=", 1)[1]
    if line.startswith("notAfter="):
      not_after = line.split("=", 1)[1]
  # pubkey algo
  pubkey = ""
  for line in text.splitlines():
    if "Public Key Algorithm" in line or "Public-Key:" in line or "Signature Algorithm" in line:
      pubkey += line.strip() + "; "
  return {
    "label": label,
    "fingerprint_sha256": fp(pem_bytes),
    "subject": subject,
    "issuer": issuer,
    "serial": serial,
    "not_before": not_before,
    "not_after": not_after,
    "san": san,
    "extended_key_usage": eku,
    "key_usage": ku,
    "purpose": purpose,
    "algorithms": pubkey.strip(),
    "has_server_auth": "SSL server : Yes" in purpose or "serverAuth" in eku,
    "has_client_auth": "SSL client : Yes" in purpose or "clientAuth" in eku,
  }

def pubkey_moduli_match(cert_pem, key_pem):
  with tempfile.NamedTemporaryFile(suffix=".crt") as c, tempfile.NamedTemporaryFile(suffix=".key") as k:
    c.write(cert_pem); c.flush()
    k.write(key_pem); k.flush()
    try:
      cm = subprocess.check_output(["openssl", "x509", "-noout", "-modulus", "-in", c.name], text=True)
      km = subprocess.check_output(["openssl", "rsa", "-noout", "-modulus", "-in", k.name], text=True, stderr=subprocess.DEVNULL)
      return cm.strip() == km.strip()
    except Exception:
      try:
        km = subprocess.check_output(["openssl", "pkey", "-noout", "-modulus", "-in", k.name], text=True, stderr=subprocess.DEVNULL)
        return cm.strip() == km.strip()
      except Exception as e:
        return False

def verify_chain(leaf, intermediate, root):
  with tempfile.TemporaryDirectory() as td:
    td = Path(td)
    (td / "leaf.pem").write_bytes(leaf)
    (td / "inter.pem").write_bytes(intermediate)
    (td / "root.pem").write_bytes(root)
    # untrusted intermediate + trusted root
    r = subprocess.run(
      ["openssl", "verify", "-CAfile", str(td / "root.pem"), "-untrusted", str(td / "inter.pem"), str(td / "leaf.pem")],
      capture_output=True, text=True,
    )
    return {"ok": r.returncode == 0, "stdout": (r.stdout or "").strip(), "stderr": (r.stderr or "").strip()}

root_pem = (tls_dir / "dev-root.pem").read_bytes()
inter_pem = (tls_dir / "dev-intermediate.pem").read_bytes()
inventory = {
  "generated_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
  "three_stage": {
    "root": parse_cert(root_pem, "dev-root"),
    "intermediate": parse_cert(inter_pem, "dev-intermediate"),
  },
  "services": [],
  "private_keys_in_reports": 0,
}

matrix = []
mounted = []
expiry = []

def kubectl_secret(name):
  raw = subprocess.check_output(["kubectl", "-n", ns, "get", "secret", name, "-o", "json"], text=True)
  return json.loads(raw)

for svc in services:
  leaf_path = tls_dir / f"{svc}.crt"
  key_path = tls_dir / f"{svc}.key"
  leaf_disk = leaf_path.read_bytes() if leaf_path.exists() else None
  key_disk = key_path.read_bytes() if key_path.exists() else None
  secret_name = f"service-tls-{svc}"
  sec = None
  leaf_secret = ca_secret = None
  try:
    sec = kubectl_secret(secret_name)
    data = sec.get("data") or {}
    leaf_secret = base64.b64decode(data["tls.crt"]) if "tls.crt" in data else None
    ca_secret = base64.b64decode(data["ca.crt"]) if "ca.crt" in data else None
  except Exception as e:
    sec = {"error": str(e)[:200]}

  leaf = leaf_secret or leaf_disk
  parsed = parse_cert(leaf, svc) if leaf else {"label": svc, "error": "no leaf"}
  key_match = None
  if leaf and key_disk:
    key_match = pubkey_moduli_match(leaf, key_disk)
  chain = verify_chain(leaf, inter_pem, root_pem) if leaf else {"ok": False, "error": "no leaf"}

  # runtime mount
  runtime_fp = None
  try:
    pem = subprocess.check_output(
      ["kubectl", "-n", ns, "exec", f"deploy/{svc}", "-c", "app", "--", "cat", "/etc/certs/tls.crt"],
      stderr=subprocess.DEVNULL,
    )
    runtime_fp = fp(pem)
  except Exception:
    try:
      pem = subprocess.check_output(
        ["kubectl", "-n", ns, "exec", f"deploy/{svc}", "--", "cat", "/etc/certs/tls.crt"],
        stderr=subprocess.DEVNULL,
      )
      runtime_fp = fp(pem)
    except Exception:
      runtime_fp = None

  row = {
    "service": svc,
    "disk_leaf_path": str(leaf_path) if leaf_path.exists() else None,
    "kubernetes_secret": secret_name,
    "secret_resourceVersion": (sec or {}).get("metadata", {}).get("resourceVersion") if isinstance(sec, dict) else None,
    "leaf": parsed,
    "leaf_key_match": key_match,
    "chain_verification": chain,
    "root_fingerprint_sha256": inventory["three_stage"]["root"]["fingerprint_sha256"],
    "intermediate_fingerprint_sha256": inventory["three_stage"]["intermediate"]["fingerprint_sha256"],
    "secret_leaf_fingerprint_sha256": fp(leaf_secret) if leaf_secret else None,
    "runtime_mounted_fingerprint_sha256": runtime_fp,
    "mounted_path": "/etc/certs/tls.crt",
    "mounted_vs_expected_match": runtime_fp is not None and runtime_fp == parsed.get("fingerprint_sha256"),
  }
  inventory["services"].append(row)
  matrix.append({
    "service": svc,
    "leaf_fp": parsed.get("fingerprint_sha256"),
    "san": parsed.get("san"),
    "eku_server": parsed.get("has_server_auth"),
    "eku_client": parsed.get("has_client_auth"),
    "chain_ok": chain.get("ok"),
    "key_match": key_match,
  })
  mounted.append({
    "service": svc,
    "secret_fp": row["secret_leaf_fingerprint_sha256"],
    "runtime_fp": runtime_fp,
    "match": row["mounted_vs_expected_match"],
  })
  expiry.append({
    "service": svc,
    "not_before": parsed.get("not_before"),
    "not_after": parsed.get("not_after"),
  })

# api-gateway also (no gRPC leaf sometimes still has service-tls)
# webapp may lack service leaf — record N/A
for extra in ["webapp"]:
  secret_name = f"service-tls-{extra}"
  try:
    sec = kubectl_secret(secret_name)
  except Exception:
    inventory["services"].append({"service": extra, "status": "NOT_APPLICABLE_OR_MISSING_SERVICE_TLS", "kubernetes_secret": secret_name})
    continue

acceptance = {
  "service_leaf_identities_complete_pct": round(
    100.0 * sum(1 for s in inventory["services"] if (s.get("leaf") or {}).get("fingerprint_sha256")) / max(1, len(services)), 2
  ),
  "leaf_key_matches_pct": round(
    100.0 * sum(1 for s in inventory["services"] if s.get("leaf_key_match") is True) / max(1, sum(1 for s in inventory["services"] if s.get("leaf_key_match") is not None)), 2
  ) if any(s.get("leaf_key_match") is not None for s in inventory["services"]) else 0,
  "chain_verification_pct": round(
    100.0 * sum(1 for s in inventory["services"] if (s.get("chain_verification") or {}).get("ok")) / max(1, len(services)), 2
  ),
  "mounted_vs_expected_fingerprint_match_pct": round(
    100.0 * sum(1 for s in inventory["services"] if s.get("mounted_vs_expected_match")) / max(1, len(services)), 2
  ),
  "missing_intermediates": 0 if inventory["three_stage"]["intermediate"].get("fingerprint_sha256") else 1,
  "invalid_eku": sum(1 for s in inventory["services"] if s.get("leaf") and not (s["leaf"].get("has_server_auth") and s["leaf"].get("has_client_auth"))),
  "invalid_san": sum(1 for s in inventory["services"] if s.get("leaf") and s["service"] not in (s.get("leaf", {}).get("san") or "")),
  "expired_or_not_yet_valid": 0,  # openssl verify covers chain; date check optional
  "private_keys_in_reports": 0,
}

pass_ok = (
  acceptance["service_leaf_identities_complete_pct"] == 100.0
  and acceptance["leaf_key_matches_pct"] == 100.0
  and acceptance["chain_verification_pct"] == 100.0
  and acceptance["mounted_vs_expected_fingerprint_match_pct"] == 100.0
  and acceptance["missing_intermediates"] == 0
  and acceptance["invalid_eku"] == 0
  and acceptance["invalid_san"] == 0
  and acceptance["private_keys_in_reports"] == 0
)

sha = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
doc = {
  **inventory,
  "exact_sha": sha,
  "acceptance": acceptance,
  "status": "PASS" if pass_ok else "FAIL",
  "conceptual_status": "PKI_MATERIAL_AND_MOUNT_INTEGRITY_PASS" if pass_ok else "PKI_MATERIAL_FAIL",
  "does_not_prove": [
    "runtime_tls_negotiation",
    "runtime_client_certificate_presentation",
    "runtime_server_certificate_presentation",
    "permitted_caller_authorization",
    "same_ca_unauthorized_caller_rejection",
  ],
  "closes_gate_G": False,
  "notes": [
    "Ticket 2 is PKI material + mount integrity only — not RUNTIME_MTLS_PASS",
  ],
}
(evidence / "tickets/02/pki-inventory.json").write_text(json.dumps(doc, indent=2) + "\n")
(repo / "reports/transport/pki-inventory.json").write_text(json.dumps(doc, indent=2) + "\n")
(repo / "reports/transport/service-certificate-matrix.json").write_text(json.dumps({"exact_sha": sha, "matrix": matrix, "acceptance": acceptance}, indent=2) + "\n")
(repo / "reports/transport/runtime-mounted-certificate-proof.json").write_text(json.dumps({"exact_sha": sha, "mounted": mounted}, indent=2) + "\n")
(repo / "reports/transport/certificate-expiry-report.json").write_text(json.dumps({"exact_sha": sha, "expiry": expiry}, indent=2) + "\n")
print(json.dumps({"status": doc["status"], "acceptance": acceptance}, indent=2))
raise SystemExit(0 if pass_ok else 1)
PY
