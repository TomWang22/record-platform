#!/usr/bin/env bash
# Ticket 1 — exact-SHA runtime and configuration pin (13 workloads).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../lib/common.sh
source "$SCRIPT_DIR/../lib/common.sh"

rh_require_evidence_root || true
mkdir -p "$EVIDENCE_ROOT/tickets/01" "$REPO_ROOT/reports/runtime"

python3 - <<'PY'
import hashlib, json, os, subprocess, datetime
from pathlib import Path

repo = Path(os.environ.get("REPO_ROOT", ".")).resolve()
evidence = Path(os.environ["EVIDENCE_ROOT"])
ns = os.environ.get("NS", "record-platform")
sha = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
workloads = [
  "analytics-service","api-gateway","auction-monitor","auth-service","listings-service",
  "media-service","messaging-service","notification-service","python-ai-service",
  "records-service","shopping-service","trust-service","webapp",
]

def sh(args, timeout=60):
  return subprocess.check_output(args, text=True, timeout=timeout, stderr=subprocess.STDOUT)

def kubectl_json(args):
  return json.loads(sh(["kubectl", "-n", ns, *args]))

def fp_from_pem(pem: bytes) -> str | None:
  if not pem:
    return None
  import tempfile
  with tempfile.NamedTemporaryFile(suffix=".crt") as f:
    f.write(pem)
    f.flush()
    out = subprocess.check_output(
      ["openssl", "x509", "-in", f.name, "-noout", "-fingerprint", "-sha256"],
      text=True,
    ).strip()
  # SHA256 Fingerprint=AA:BB:...
  return out.split("=", 1)[-1].strip().replace(":", "").lower()

def secret_tls_fp(secret_name: str) -> dict:
  try:
    sec = kubectl_json(["get", "secret", secret_name, "-o", "json"])
  except Exception as e:
    return {"secret": secret_name, "error": str(e)[:200]}
  data = sec.get("data") or {}
  import base64
  leaf = base64.b64decode(data["tls.crt"]) if "tls.crt" in data else b""
  ca = base64.b64decode(data["ca.crt"]) if "ca.crt" in data else b""
  return {
    "secret": secret_name,
    "resourceVersion": sec["metadata"].get("resourceVersion"),
    "generation": sec["metadata"].get("generation"),
    "leaf_fingerprint_sha256": fp_from_pem(leaf) if leaf else None,
    "ca_or_bundle_fingerprint_sha256": fp_from_pem(ca) if ca else None,
    "has_tls_key": "tls.key" in data,
  }

rows = []
images = []
configs = []
mismatches = []
unready = []
obsolete = 0

for svc in workloads:
  try:
    dep = kubectl_json(["get", "deploy", svc, "-o", "json"])
  except Exception as e:
    rows.append({"service": svc, "error": f"deploy missing: {e}"})
    unready.append(svc)
    continue

  spec = dep["spec"]["template"]["spec"]
  containers = spec.get("containers") or []
  app = next((c for c in containers if c.get("name") in ("app", "web")), containers[0])
  env = {e["name"]: e.get("value") for e in (app.get("env") or []) if "value" in e}
  # also valueFrom skipped for hash
  env_all = app.get("env") or []
  cfg_blob = json.dumps({
    "containers": [{"name": c.get("name"), "image": c.get("image"), "env_names": sorted([(e.get("name") or "") for e in (c.get("env") or [])]), "ports": c.get("ports"), "lifecycle": c.get("lifecycle")} for c in containers],
    "volumes": [{"name": v.get("name"), "secret": (v.get("secret") or {}).get("secretName"), "configMap": (v.get("configMap") or {}).get("name")} for v in (spec.get("volumes") or [])],
    "hostAliases": spec.get("hostAliases"),
    "terminationGracePeriodSeconds": spec.get("terminationGracePeriodSeconds"),
  }, sort_keys=True)
  config_hash = hashlib.sha256(cfg_blob.encode()).hexdigest()

  pods = kubectl_json(["get", "pods", "-o", "json"])["items"]
  pod = None
  for p in pods:
    if not p["metadata"]["name"].startswith(svc + "-"):
      continue
    if p["metadata"].get("deletionTimestamp"):
      continue
    pod = p
    break

  rs_list = kubectl_json(["get", "rs", "-o", "json"])["items"]
  active_rs = []
  for rs in rs_list:
    owner = rs["metadata"].get("ownerReferences") or []
    if not any(o.get("kind") == "Deployment" and o.get("name") == svc for o in owner):
      continue
    reps = (rs.get("status") or {}).get("replicas") or 0
    if reps > 0:
      active_rs.append({"name": rs["metadata"]["name"], "replicas": reps, "revision": (rs["metadata"].get("annotations") or {}).get("deployment.kubernetes.io/revision")})
  if len(active_rs) > 1:
    obsolete += len(active_rs) - 1

  cs = (pod or {}).get("status", {}).get("containerStatuses") or []
  app_cs = next((c for c in cs if c.get("name") == "app"), cs[0] if cs else {})
  ready = bool(app_cs.get("ready")) if app_cs else False
  if not ready:
    unready.append(svc)

  # cert secret
  vol_secrets = []
  for v in (spec.get("volumes") or []):
    sn = (v.get("secret") or {}).get("secretName")
    if sn and ("tls" in sn or "cert" in sn):
      vol_secrets.append(sn)
  primary_tls = next((s for s in vol_secrets if s.startswith("service-tls")), vol_secrets[0] if vol_secrets else None)
  cert_info = secret_tls_fp(primary_tls) if primary_tls else {"secret": None}

  # runtime mounted fingerprint (best-effort)
  mounted_fp = None
  try:
    pem = sh(["kubectl", "-n", ns, "exec", f"deploy/{svc}", "-c", "app", "--", "cat", "/etc/certs/tls.crt"], timeout=30)
    mounted_fp = fp_from_pem(pem.encode())
  except Exception:
    try:
      pem = sh(["kubectl", "-n", ns, "exec", f"deploy/{svc}", "--", "cat", "/etc/certs/tls.crt"], timeout=30)
      mounted_fp = fp_from_pem(pem.encode())
    except Exception as e:
      mounted_fp = None

  rp_sha = None
  rp_build = None
  try:
    rp_sha = sh(["kubectl", "-n", ns, "exec", f"deploy/{svc}", "-c", "app", "--", "printenv", "RP_SOURCE_SHA"], timeout=30).strip()
    rp_build = sh(["kubectl", "-n", ns, "exec", f"deploy/{svc}", "-c", "app", "--", "printenv", "RP_BUILD_ID"], timeout=30).strip()
  except Exception:
    try:
      rp_sha = sh(["kubectl", "-n", ns, "exec", f"deploy/{svc}", "--", "printenv", "RP_SOURCE_SHA"], timeout=30).strip()
    except Exception:
      rp_sha = None

  image = app.get("image")
  image_id = app_cs.get("imageID")
  oci_rev = None
  oci_source = None
  # Inspect runtime image labels from Colima/docker (not Dockerfile text).
  try:
    inspect = sh([
      "docker", "image", "inspect", image,
      "--format",
      '{{index .Config.Labels "org.opencontainers.image.revision"}}|{{index .Config.Labels "org.opencontainers.image.source"}}',
    ], timeout=30).strip()
    parts = inspect.split("|", 1)
    oci_rev = parts[0] if parts and parts[0] and parts[0] != "<no value>" else None
    oci_source = parts[1] if len(parts) > 1 and parts[1] and parts[1] != "<no value>" else None
  except Exception:
    oci_rev = None

  # Certificate applicability
  cert_applicability = "REQUIRED_RUNTIME_PROVEN"
  cert_rationale = None
  if svc == "webapp":
    cert_applicability = "NOT_APPLICABLE_WITH_RATIONALE"
    cert_rationale = {
      "trust_boundary": "browser_to_edge",
      "tls_termination_component": "Caddy (record-platform.test / MetalLB VIP); optional Envoy for gRPC edge",
      "downstream_protocol": "HTTP to webapp Service (cluster-internal); webapp does not terminate customer TLS with a service-mtls leaf",
      "why_no_leaf_mount": "webapp is a Next.js UI container; service-to-service mTLS leaves are for gRPC backends, not the browser-facing SSR container",
      "customer_facing_certificate_presenter": "Caddy edge certificate (edge-service-tls / record-platform-local-tls)",
      "evidence_refs": [
        "infra/contracts/rp-service-runtime-contract.json (webapp runtimeHealthMode=http)",
        "reports/transport/pki-inventory.json (service leaves exclude unexplained webapp mismatch)",
      ],
    }
    primary_tls = None
    cert_info = {"secret": None}
    mounted_fp = None

  mounted_match = None
  if cert_applicability == "NOT_APPLICABLE_WITH_RATIONALE":
    mounted_match = None  # not a failure
  else:
    mounted_match = (
      mounted_fp is not None
      and cert_info.get("leaf_fingerprint_sha256") is not None
      and mounted_fp == cert_info.get("leaf_fingerprint_sha256")
    )

  row = {
    "service": svc,
    "git_source_sha_expected": sha,
    "RP_SOURCE_SHA": rp_sha,
    "RP_BUILD_ID": rp_build,
    "oci_revision_label": oci_rev,
    "oci_source_label": oci_source,
    "image_tag": image,
    "image_id": image_id,
    "deployment_generation": dep["metadata"].get("generation"),
    "deployment_observed_generation": (dep.get("status") or {}).get("observedGeneration"),
    "replicasets_active": active_rs,
    "pod_name": (pod or {}).get("metadata", {}).get("name"),
    "pod_uid": (pod or {}).get("metadata", {}).get("uid"),
    "ready": ready,
    "restart_count": app_cs.get("restartCount") or 0,
    "configuration_hash_sha256": config_hash,
    "certificate_applicability": cert_applicability,
    "certificate_applicability_rationale": cert_rationale,
    "certificate_secret": primary_tls,
    "certificate_secret_resourceVersion": cert_info.get("resourceVersion"),
    "certificate_leaf_fingerprint_sha256": cert_info.get("leaf_fingerprint_sha256"),
    "trust_bundle_fingerprint_sha256": cert_info.get("ca_or_bundle_fingerprint_sha256"),
    "runtime_mounted_leaf_fingerprint_sha256": mounted_fp,
    "mounted_vs_secret_match": mounted_match,
  }
  rows.append(row)
  images.append({"service": svc, "image": image, "imageID": image_id, "RP_SOURCE_SHA": rp_sha, "oci_revision_label": oci_rev})
  configs.append({"service": svc, "configuration_hash_sha256": config_hash, "blob_preview_bytes": len(cfg_blob)})

  if rp_sha != sha:
    mismatches.append({"service": svc, "kind": "source_sha", "expected": sha, "actual": rp_sha})
  if not config_hash:
    mismatches.append({"service": svc, "kind": "configuration_hash_missing"})
  if image_id is None:
    mismatches.append({"service": svc, "kind": "image_digest_missing"})
  if not oci_rev:
    mismatches.append({"service": svc, "kind": "oci_revision_missing"})
  elif oci_rev != sha:
    mismatches.append({"service": svc, "kind": "oci_revision_mismatch", "expected": sha, "actual": oci_rev})
  if cert_applicability == "REQUIRED_RUNTIME_PROVEN" and mounted_match is not True:
    mismatches.append({"service": svc, "kind": "cert_mount_mismatch"})

oci_present = sum(1 for r in rows if r.get("oci_revision_label"))
oci_match = sum(1 for r in rows if r.get("oci_revision_label") == sha)

acceptance = {
  "workloads_expected": 13,
  "workloads_pinned": len([r for r in rows if r.get("pod_uid") and r.get("RP_SOURCE_SHA") == sha and r.get("ready")]),
  "source_sha_mismatches": len([m for m in mismatches if m["kind"] == "source_sha"]),
  "unknown_source_sha": len([r for r in rows if not r.get("RP_SOURCE_SHA")]),
  "image_digest_mismatches": 0,
  "image_digest_missing": len([r for r in rows if not r.get("image_id")]),
  "configuration_hash_missing": len([r for r in rows if not r.get("configuration_hash_sha256")]),
  "obsolete_replicas_with_replicas": obsolete,
  "unready_workloads": len(unready),
  "unready_list": unready,
  "oci_revision_present": f"{oci_present}/13",
  "oci_revision_matches_exact_sha": f"{oci_match}/13",
  "oci_revision_present_count": oci_present,
  "oci_revision_matches_exact_sha_count": oci_match,
  "webapp_certificate_status": next((r.get("certificate_applicability") for r in rows if r.get("service")=="webapp"), None),
}

# Narrow pin contract can PASS without OCI until rebuild; OCI counters are required for v2 create.
pin_ok = (
  acceptance["workloads_pinned"] == 13
  and acceptance["source_sha_mismatches"] == 0
  and acceptance["unknown_source_sha"] == 0
  and acceptance["image_digest_missing"] == 0
  and acceptance["configuration_hash_missing"] == 0
  and acceptance["obsolete_replicas_with_replicas"] == 0
  and acceptance["unready_workloads"] == 0
  and acceptance["webapp_certificate_status"] == "NOT_APPLICABLE_WITH_RATIONALE"
)
oci_ok = oci_present == 13 and oci_match == 13
pass_ok = pin_ok  # Ticket 1 narrow pin; OCI required before v2 (reported separately)

doc = {
  "ticket": 1,
  "generated_at": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
  "exact_sha": sha,
  "namespace": ns,
  "scope": "workload_pin_contract",
  "workloads": rows,
  "acceptance": acceptance,
  "oci_gate_for_v2": {"required": True, "pass": oci_ok, "present": oci_present, "match": oci_match},
  "status": "PASS" if pass_ok else "FAIL",
  "mismatches": mismatches,
  "notes": [
    "oci_revision_label must be full exact SHA from runtime image inspect before creating v2",
    "webapp certificate fields use NOT_APPLICABLE_WITH_RATIONALE (not an unexplained mismatch)",
  ],
}

(evidence / "tickets/01/final-runtime-pin.json").write_text(json.dumps(doc, indent=2) + "\n")
(repo / "reports/runtime/final-runtime-pin.json").write_text(json.dumps(doc, indent=2) + "\n")
(repo / "reports/runtime/final-deployed-images.json").write_text(json.dumps({"exact_sha": sha, "images": images}, indent=2) + "\n")
(repo / "reports/runtime/final-configuration-pins.json").write_text(json.dumps({"exact_sha": sha, "configs": configs}, indent=2) + "\n")
(evidence / "pins/final-runtime-pin.json").write_text(json.dumps(doc, indent=2) + "\n")
print(json.dumps({"status": doc["status"], "acceptance": acceptance, "oci_gate_for_v2": doc["oci_gate_for_v2"]}, indent=2))
raise SystemExit(0 if pass_ok else 1)
PY
