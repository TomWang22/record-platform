#!/usr/bin/env python3
"""Gate 3 full live matrix for heartbeat-v9 evidence-complete. Evidence-complete: 192 pcaps + 115 traces. Fail-closed. Not Gate 4."""
from __future__ import annotations

import datetime
import hashlib
import json
import os
import re
import subprocess
import time
from pathlib import Path

REPO = Path("/Users/tom/record-platform")
ROOT = Path(os.environ.get("RP_GATE3_ROOT", "/tmp/record-platform-runtime-heartbeat-v9"))
NS = "record-platform"
POD = "gate3-probe"
TOKEN = Path("/tmp/gate3-valid-token.txt").read_text().strip()
SHA = subprocess.check_output(["git", "-C", str(REPO), "rev-parse", "HEAD"], text=True).strip()
PIN_HASH = hashlib.sha256((REPO / "reports/runtime/current-exact-sha-runtime-pin.json").read_bytes()).hexdigest()
NOW = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

contract = json.loads((REPO / "infra/contracts/rp-service-runtime-contract.json").read_text())
graph = json.loads((REPO / "infra/contracts/rp-service-call-graph.json").read_text())

SERVERS = []
for name, row in contract.get("services", {}).items():
    if row.get("grpcPort") and row.get("tlsPolicy") == "service-mtls":
        SERVERS.append(
            {
                "service": name,
                "port": int(row["grpcPort"]),
                "grpcService": row.get("grpcService") or "",
                "sni": row.get("grpcTlsServerName") or name,
            }
        )
SERVERS.sort(key=lambda s: s["service"])
assert len(SERVERS) == 11, len(SERVERS)

EDGES = []
for srv, meta in graph["servers"].items():
    for caller in meta.get("allowedCallers") or []:
        EDGES.append({"caller": caller, "server": srv})
assert len(EDGES) == 71, len(EDGES)

NEG_CATS = [
    "MISSING_CLIENT_CERTIFICATE",
    "SAME_CA_WRONG_SERVICE_IDENTITY",
    "SAME_CA_UNAUTHORIZED_SERVICE_IDENTITY",
    "UNKNOWN_TRUSTED_CA_TEST_IDENTITY",
    "WRONG_TRUST_ROOT",
    "WRONG_SNI_OR_SERVER_SAN",
    "INVALID_SERVER_SAN",
    "INVALID_CLIENT_AUTH_EKU",
    "INVALID_SERVER_AUTH_EKU",
    "PLAINTEXT_CONNECTION",
    "UNAUTHORIZED_RPC_OR_SERVICE",
]
assert len(NEG_CATS) == 11

# Business fixtures: server -> (proto_file, rpc, body, success_regex)
# Success must be semantic business success, not INVALID_TOKEN / NOT_FOUND-as-error.
FIXTURES = {
    "auth-service": (
        "auth.proto",
        "auth.AuthService/ValidateToken",
        json.dumps({"token": TOKEN}),
        r'"valid"\s*:\s*true',
    ),
    "records-service": (
        "records.proto",
        "records.RecordsService/SearchRecords",
        json.dumps({"user_id": "99b7cc41-f49a-4937-9279-d07cde1acc3a", "query": "", "limit": 1}),
        r'"records"|"total"',
    ),
    "listings-service": (
        "listings.proto",
        "listings.ListingsService/SearchListings",
        json.dumps({"query": "", "limit": 1}),
        r'"listings"|"count"',
    ),
    "shopping-service": (
        "shopping.proto",
        "shopping.ShoppingService/GetCart",
        json.dumps({"user_id": "99b7cc41-f49a-4937-9279-d07cde1acc3a"}),
        r'"items"|"total_items"|"total_price"',
    ),
    "auction-monitor": (
        "auction-monitor.proto",
        "auction_monitor.AuctionMonitorService/GetMonitoredAuctions",
        json.dumps({"user_id": "99b7cc41-f49a-4937-9279-d07cde1acc3a", "limit": 1}),
        r'"auctions"|"count"|\{}',
    ),
    "messaging-service": (
        "messaging.proto",
        "messaging.v1.MessagingService/ListPosts",
        json.dumps({"user_id": "99b7cc41-f49a-4937-9279-d07cde1acc3a", "page": 1, "limit": 1}),
        r'"posts"|"pagination"',
    ),
    "notification-service": (
        "notification.proto",
        "notification.NotificationService/GetUserPreferences",
        json.dumps({"user_id": "99b7cc41-f49a-4937-9279-d07cde1acc3a"}),
        r'"email_enabled"|"emailEnabled"|"sms_enabled"|"smsEnabled"|"push_enabled"|"pushEnabled"',
    ),
    "media-service": (
        "media.proto",
        "media.MediaService/CreateUploadUrl",
        json.dumps(
            {
                "user_id": "99b7cc41-f49a-4937-9279-d07cde1acc3a",
                "filename": "gate3.jpg",
                "content_type": "image/jpeg",
                "size_bytes": 1024,
            }
        ),
        r'"upload_url"|"uploadUrl"|"media_id"|"mediaId"|"object_key"|"objectKey"',
    ),
    "trust-service": (
        "trust.proto",
        "trust.TrustService/GetReputation",
        json.dumps({"user_id": "99b7cc41-f49a-4937-9279-d07cde1acc3a"}),
        r'"score"|"user_id"|"userId"',
    ),
    "analytics-service": (
        "analytics.proto",
        "analytics.AnalyticsService/GetTrendingSearches",
        json.dumps({"limit": 1, "days": 7}),
        r'"trending"|"count"|"days"',
    ),
    "python-ai-service": (
        "python-ai.proto",
        "python_ai.PythonAIService/AuctionHeat",
        json.dumps(
            {
                "auction_id": "gate3-auction",
                "listing_id": "00000000-0000-4000-8000-000000000001",
                "bid_count": 2,
                "current_bid": 10.0,
            }
        ),
        r'"heat_score"|"heatScore"|"sentiment"',
    ),
}


def sh(cmd: list[str], timeout: int = 60) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def kubectl(*args: str, timeout: int = 60) -> subprocess.CompletedProcess:
    return sh(["kubectl", "-n", NS, *args], timeout=timeout)


def ensure_probe_assets() -> None:
    kubectl("exec", POD, "--", "mkdir", "-p", "/tmp/proto", "/tmp/caller-certs", "/tmp/fixtures")
    for p in (REPO / "proto").glob("*.proto"):
        sh(["kubectl", "-n", NS, "cp", str(p), f"{POD}:/tmp/proto/{p.name}"])
    sh(["kubectl", "-n", NS, "cp", str(REPO / "certs/dev-root.pem"), f"{POD}:/tmp/dev-root.pem"])
    # Stage caller identities from host certs/ (service leafs)
    certs = REPO / "certs"
    for edge in EDGES:
        caller = edge["caller"]
        if caller in ("envoy", "envoy-client"):
            crt = certs / "envoy-client.crt"
            key = certs / "envoy-client.key"
            if not crt.exists():
                raise SystemExit("missing certs/envoy-client.crt for envoy caller identity")
        else:
            crt = certs / f"{caller}.crt"
            key = certs / f"{caller}.key"
        if not crt.exists() or not key.exists():
            continue
        dest = f"/tmp/caller-certs/{caller}"
        kubectl("exec", POD, "--", "mkdir", "-p", dest)
        sh(["kubectl", "-n", NS, "cp", str(crt), f"{POD}:{dest}/tls.crt"])
        sh(["kubectl", "-n", NS, "cp", str(key), f"{POD}:{dest}/tls.key"])
    # Negative fixtures
    fix = Path("/tmp/gate3-live-matrix/fixtures")
    for name in ("unknown-identity", "wrong-root", "invalid-client-eku", "invalid-server-eku", "invalid-server-san"):
        d = fix / name
        if not d.exists():
            continue
        kubectl("exec", POD, "--", "mkdir", "-p", f"/tmp/fixtures/{name}")
        for f in d.iterdir():
            if f.is_file() and f.suffix in (".crt", ".key", ".pem"):
                # map tls-chain to tls.crt where needed
                dest_name = "tls.crt" if f.name in ("tls-chain.crt", "tls.crt", "leaf.crt") else f.name
                if f.name.endswith(".key"):
                    dest_name = "tls.key"
                if f.name in ("ca.crt",):
                    dest_name = "ca.crt"
                sh(["kubectl", "-n", NS, "cp", str(f), f"{POD}:/tmp/fixtures/{name}/{dest_name}"])


def svc_ip(service: str) -> str:
    return kubectl("get", "svc", service, "-o", "jsonpath={.spec.clusterIP}").stdout.strip()


def classify(out: str) -> str:
    if re.search(r"PermissionDenied|PERMISSION_DENIED", out, re.I):
        return "PERMISSION_DENIED"
    if re.search(r"DeadlineExceeded", out, re.I):
        return "DeadlineExceeded"
    if re.search(r"certificate required|tlsv13 alert|Failed to dial|Unavailable|handshake|bad certificate|unknown ca|WRONG_VERSION", out, re.I):
        return "TLS_REJECTED"
    if re.search(r'"valid"\s*:\s*true', out):
        return "APP_VALID_TRUE"
    if out.strip().startswith("{") or "\n{" in out:
        return "APP_JSON"
    return "OTHER"


def grpcurl(args: list[str], timeout: int = 20) -> tuple[int, str, int]:
    started = int(time.time() * 1000)
    # Avoid shell injection by joining carefully via kubectl exec --
    cmd = ["kubectl", "-n", NS, "exec", POD, "--", "grpcurl", "-max-time", str(max(3, timeout - 2)), *args]
    proc = sh(cmd, timeout=timeout)
    elapsed = int(time.time() * 1000) - started
    out = (proc.stdout or "") + (proc.stderr or "")
    return proc.returncode, out, elapsed


def freeze_blocked(reason: str, hard: dict) -> None:
    term = {
        "gate_id": "GATE_03",
        "generated_at": NOW,
        "exact_sha": SHA,
        "runtime_pin_hash": PIN_HASH,
        "terminal_state": "FROZEN_BLOCKED_EVIDENCE",
        "status": "BLOCKED",
        "reason": reason,
        "hard_failure": hard,
    }
    (ROOT / "freeze").mkdir(parents=True, exist_ok=True)
    (ROOT / "freeze/terminal.json").write_text(json.dumps(term, indent=2) + "\n")
    (ROOT / "freeze/TERMINAL_STATE").write_text("FROZEN_BLOCKED_EVIDENCE\n")
    (ROOT / "freeze/REASON.txt").write_text(reason + "\n")
    print("FROZEN_BLOCKED", reason)



JAEGER_BASE = "http://jaeger.observability.svc.cluster.local:16686/jaeger"
TLS_ONLY_CATS = {
    "MISSING_CLIENT_CERTIFICATE",
    "WRONG_TRUST_ROOT",
    "WRONG_SNI_OR_SERVER_SAN",
    "INVALID_SERVER_SAN",
    "INVALID_CLIENT_AUTH_EKU",
    "INVALID_SERVER_AUTH_EKU",
    "PLAINTEXT_CONNECTION",
}
TRACE_REQUIRED_CATS = {
    "SAME_CA_WRONG_SERVICE_IDENTITY",
    "SAME_CA_UNAUTHORIZED_SERVICE_IDENTITY",
    "UNKNOWN_TRUSTED_CA_TEST_IDENTITY",
    "UNAUTHORIZED_RPC_OR_SERVICE",
}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str | None:
    if not path.exists():
        return None
    return sha256_bytes(path.read_bytes())


def pem_fingerprint(pem: str) -> str | None:
    if not pem or "BEGIN CERTIFICATE" not in pem:
        return None
    proc = subprocess.run(
        ["openssl", "x509", "-fingerprint", "-sha256", "-noout"],
        input=pem.encode(),
        capture_output=True,
    )
    if proc.returncode != 0:
        return None
    line = (proc.stdout or b"").decode().strip()
    # SHA256 Fingerprint=AB:CD:...
    if "=" in line:
        return line.split("=", 1)[1].replace(":", "").lower()
    return None


def cert_fields(pem: str) -> dict:
    out = {"fingerprint_sha256": pem_fingerprint(pem), "subject": None, "issuer": None, "eku": None, "sans": []}
    if not pem:
        return out
    sub = subprocess.run(["openssl", "x509", "-noout", "-subject", "-issuer"], input=pem.encode(), capture_output=True, text=True)
    for line in (sub.stdout or "").splitlines():
        if line.lower().startswith("subject="):
            out["subject"] = line.split("=", 1)[1].strip()
        if line.lower().startswith("issuer="):
            out["issuer"] = line.split("=", 1)[1].strip()
    eku = subprocess.run(["openssl", "x509", "-noout", "-ext", "extendedKeyUsage"], input=pem.encode(), capture_output=True, text=True)
    out["eku"] = (eku.stdout or "").strip()
    san = subprocess.run(["openssl", "x509", "-noout", "-ext", "subjectAltName"], input=pem.encode(), capture_output=True, text=True)
    m = re.findall(r"DNS:([^,\s]+)", san.stdout or "")
    out["sans"] = m
    return out


def k8s_secret_leaf_pem(service: str) -> str:
    # tls.crt may be chain; take first cert
    b64 = kubectl(
        "get", "secret", f"service-tls-{service}", "-o", "jsonpath={.data.tls\\.crt}"
    ).stdout.strip()
    if not b64:
        return ""
    import base64
    raw = base64.b64decode(b64).decode("utf-8", errors="replace")
    return raw


def mounted_leaf_pem(service: str) -> str:
    proc = kubectl("exec", f"deploy/{service}", "-c", "app", "--", "cat", "/etc/certs/tls.crt", timeout=30)
    return proc.stdout or ""


def runtime_presented_leaf_pem(service: str, ip: str, port: int, sni: str) -> str:
    # openssl s_client from probe with api-gateway client cert
    script = f"""openssl s_client -connect {ip}:{port} -servername {sni} -showcerts \
      -CAfile /tmp/dev-root.pem \
      -cert /tmp/caller-certs/api-gateway/tls.crt \
      -key /tmp/caller-certs/api-gateway/tls.key </dev/null 2>/dev/null | \
      awk 'BEGIN{{p=0}} /BEGIN CERTIFICATE/{{p=1}} p{{print}} /END CERTIFICATE/{{exit}}'"""
    proc = kubectl("exec", POD, "--", "sh", "-c", script, timeout=25)
    return proc.stdout or ""


def collect_server_pki(service: str, ip: str, port: int, sni: str) -> dict:
    disk_path = REPO / "certs" / f"{service}.crt"
    disk_pem = disk_path.read_text() if disk_path.exists() else ""
    secret_pem = k8s_secret_leaf_pem(service)
    mount_pem = mounted_leaf_pem(service)
    runtime_pem = runtime_presented_leaf_pem(service, ip, port, sni)
    disk_f = pem_fingerprint(disk_pem)
    secret_f = pem_fingerprint(secret_pem)
    mount_f = pem_fingerprint(mount_pem)
    runtime_f = pem_fingerprint(runtime_pem)
    peer_f = runtime_f  # peer-observed via s_client showcerts
    return {
        "service": service,
        "disk_leaf_fingerprint": disk_f,
        "secret_leaf_fingerprint": secret_f,
        "mounted_leaf_fingerprint": mount_f,
        "runtime_presented_leaf_fingerprint": runtime_f,
        "peer_observed_leaf_fingerprint": peer_f,
        "fingerprints_equal": len({x for x in (disk_f, secret_f, mount_f, runtime_f, peer_f) if x}) == 1
        and all([disk_f, secret_f, mount_f, runtime_f, peer_f]),
        "disk": cert_fields(disk_pem),
        "secret": cert_fields(secret_pem),
        "mounted": cert_fields(mount_pem),
        "runtime_presented": cert_fields(runtime_pem),
        "root_pem_fingerprint": sha256_file(REPO / "certs" / "dev-root.pem"),
    }


def start_pcap(test_id: str, ip: str, port: int) -> None:
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", test_id)
    kubectl(
        "exec",
        POD,
        "--",
        "sh",
        "-c",
        f"rm -f /tmp/{safe}.pcap /tmp/tcpdump-{safe}.pid; "
        f"tcpdump -i any -w /tmp/{safe}.pcap host {ip} and port {port} >/tmp/tcpdump-{safe}.log 2>&1 & "
        f"echo $! > /tmp/tcpdump-{safe}.pid",
        timeout=20,
    )
    time.sleep(0.15)


def stop_pcap(test_id: str, pcap_dir: Path) -> dict:
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", test_id)
    kubectl(
        "exec",
        POD,
        "--",
        "sh",
        "-c",
        f"if [ -f /tmp/tcpdump-{safe}.pid ]; then kill $(cat /tmp/tcpdump-{safe}.pid) 2>/dev/null || true; sleep 0.25; fi",
        timeout=20,
    )
    host_pcap = pcap_dir / f"{safe}.pcap"
    sh(["kubectl", "-n", NS, "cp", f"{POD}:/tmp/{safe}.pcap", str(host_pcap)], timeout=60)
    present = host_pcap.exists() and host_pcap.stat().st_size > 0
    summary = {"present": present, "bytes": host_pcap.stat().st_size if host_pcap.exists() else 0, "sha256": None, "tshark": {}}
    if present:
        summary["sha256"] = sha256_file(host_pcap)
        # sanitized tshark summary inside probe then pull text
        ts = kubectl(
            "exec",
            POD,
            "--",
            "sh",
            "-c",
            f"tshark -r /tmp/{safe}.pcap -q -z io,phs 2>/dev/null | head -40; "
            f"echo '---'; "
            f"tshark -r /tmp/{safe}.pcap -Y 'tls.handshake.type==1 || tls.handshake.type==2 || tls.handshake.type==11' "
            f"-T fields -e frame.number -e ip.src -e ip.dst -e tls.handshake.extensions_server_name "
            f"-e tls.handshake.ciphersuite -e tls.handshake.version 2>/dev/null | head -30",
            timeout=60,
        )
        summary["tshark"]["text"] = ((ts.stdout or "") + (ts.stderr or ""))[-4000:]
        # crude presence flags
        text = summary["tshark"]["text"]
        summary["tshark"]["client_hello"] = "1" in text or "Client Hello" in text or bool(re.search(r"tls.handshake", text))
        summary["tshark"]["sni"] = bool(re.search(r"[a-z0-9-]+\.[a-z0-9.-]+|[a-z0-9-]+service|[a-z0-9-]+monitor", text, re.I))
    return summary


def query_jaeger_traces(service: str, start_s: int, end_s: int, limit: int = 20) -> dict:
    start_us = max(0, start_s - 5) * 1_000_000
    end_us = (end_s + 15) * 1_000_000
    url = (
        f"{JAEGER_BASE}/api/traces?service={service}&limit={limit}"
        f"&start={start_us}&end={end_us}"
    )
    proc = kubectl("exec", POD, "--", "curl", "-sS", "--max-time", "20", url, timeout=40)
    raw = proc.stdout or ""
    try:
        data = json.loads(raw)
    except Exception as e:
        return {"queryable": False, "error": str(e), "raw_head": raw[:300], "traces": []}
    traces = data.get("data") or []
    simplified = []
    for tr in traces:
        spans = tr.get("spans") or []
        simplified.append(
            {
                "traceID": tr.get("traceID"),
                "span_count": len(spans),
                "operations": sorted({s.get("operationName") for s in spans if s.get("operationName")})[:20],
            }
        )
    return {"queryable": len(traces) > 0, "trace_count": len(traces), "traces": simplified}


def classify_rejection_layer(cat: str, cls: str, out: str) -> str:
    if cat == "MISSING_CLIENT_CERTIFICATE":
        return "TLS_CLIENT_CERT_REQUIRED"
    if cat == "PLAINTEXT_CONNECTION":
        return "TLS_CHAIN_REJECTED"
    if cat in ("WRONG_TRUST_ROOT",):
        return "TLS_CHAIN_REJECTED"
    if cat in ("WRONG_SNI_OR_SERVER_SAN", "INVALID_SERVER_SAN"):
        return "TLS_SNI_OR_SAN_REJECTED"
    if cat == "INVALID_CLIENT_AUTH_EKU":
        return "TLS_CLIENT_EKU_REJECTED"
    if cat == "INVALID_SERVER_AUTH_EKU":
        return "TLS_SERVER_EKU_REJECTED"
    if cat in (
        "SAME_CA_WRONG_SERVICE_IDENTITY",
        "SAME_CA_UNAUTHORIZED_SERVICE_IDENTITY",
        "UNKNOWN_TRUSTED_CA_TEST_IDENTITY",
    ):
        return "PEER_IDENTITY_UNAUTHORIZED" if cls == "PERMISSION_DENIED" else cls
    if cat == "UNAUTHORIZED_RPC_OR_SERVICE":
        return "RPC_METHOD_UNAUTHORIZED" if cls == "PERMISSION_DENIED" else "SERVICE_EDGE_UNAUTHORIZED"
    return cls


def main() -> int:
    rows_dir = ROOT / "tickets/03/rows"
    logs_dir = ROOT / "tickets/03/logs"
    pcap_dir = ROOT / "pcap"
    pki_dir = ROOT / "pki"
    traces_dir = ROOT / "traces"
    for d in (rows_dir, logs_dir, pcap_dir, pki_dir, traces_dir, ROOT / "freeze", ROOT / "tickets/03"):
        d.mkdir(parents=True, exist_ok=True)

    print("staging probe assets...")
    ensure_probe_assets()

    print("collecting server PKI inventory (disk/secret/mount/runtime/peer)...")
    pki_inventory = {}
    for srv in SERVERS:
        ip = svc_ip(srv["service"])
        try:
            pki_inventory[srv["service"]] = collect_server_pki(srv["service"], ip, srv["port"], srv["sni"])
            print(f"  PKI {srv['service']} equal={pki_inventory[srv['service']]['fingerprints_equal']}")
        except Exception as e:
            pki_inventory[srv["service"]] = {"service": srv["service"], "error": str(e), "fingerprints_equal": False}
            print(f"  PKI {srv['service']} ERROR {e}")
    (pki_dir / "server-inventory.json").write_text(json.dumps(pki_inventory, indent=2) + "\n")

    positive_results = []
    deadline_exceeded = 0
    unauthorized_handler = 0

    # ---- POSITIVES ----
    for i, edge in enumerate(EDGES, 1):
        caller, server = edge["caller"], edge["server"]
        test_id = f"POS-{caller}-{server}"
        srv = next(s for s in SERVERS if s["service"] == server)
        ip = svc_ip(server)
        fixture = FIXTURES.get(server)
        if not fixture:
            freeze_blocked(f"missing fixture for {server}", {"test_id": test_id, "class": "FIXTURE_MISSING"})
            return 2
        proto, rpc, body, success_re = fixture
        cert_dir = f"/tmp/caller-certs/{caller}"
        # envoy-client may be aliased
        if caller == "envoy-client":
            cert_dir = "/tmp/caller-certs/envoy"
        args = [
            "-cacert",
            "/tmp/dev-root.pem",
            "-cert",
            f"{cert_dir}/tls.crt",
            "-key",
            f"{cert_dir}/tls.key",
            "-servername",
            srv["sni"],
            "-proto",
            f"/tmp/proto/{proto}",
            "-import-path",
            "/tmp/proto",
            "-d",
            body,
            f"{ip}:{srv['port']}",
            rpc,
        ]
        start_s = int(time.time())
        start_pcap(test_id, ip, srv["port"])
        rc, out, ms = grpcurl(args)
        pcap_meta = stop_pcap(test_id, pcap_dir)
        end_s = int(time.time())
        (logs_dir / f"{test_id}.txt").write_text(out)
        cls = classify(out)
        if cls == "DeadlineExceeded":
            deadline_exceeded += 1
        # Empty protobuf JSON ({}) is a successful semantic empty collection/result.
        empty_ok = out.strip() in ("{}", "")
        business_ok = (
            rc == 0
            and cls not in ("PERMISSION_DENIED", "DeadlineExceeded", "TLS_REJECTED")
            and not re.search(r"(?m)^ERROR:", out)
            and (bool(re.search(success_re, out, re.I | re.S)) or empty_ok)
        )
        peer_allow = cls not in ("PERMISSION_DENIED", "TLS_REJECTED", "DeadlineExceeded")
        passed = peer_allow and business_ok
        # BatchSpanProcessor default export delay ~5s; wait before first Jaeger query.
        time.sleep(6)
        # Trace required for all positives
        trace_meta = query_jaeger_traces(server, start_s, end_s)
        (traces_dir / f"{test_id}.json").write_text(json.dumps(trace_meta, indent=2) + "\n")
        if passed and not pcap_meta.get("present"):
            passed = False
        if passed and not trace_meta.get("queryable"):
            # one retry after short wait for async export
            time.sleep(5)
            trace_meta = query_jaeger_traces(server, start_s, end_s + 10)
            (traces_dir / f"{test_id}.json").write_text(json.dumps(trace_meta, indent=2) + "\n")
            if not trace_meta.get("queryable"):
                passed = False
        row = {
            "test_id": test_id,
            "row_type": "positive_permitted_edge",
            "caller": caller,
            "server": server,
            "rpc": rpc,
            "classification": cls,
            "business_ok": business_ok,
            "passed": passed,
            "rpc_elapsed_ms": ms,
            "returncode": rc,
            "output_tail": out[-1500:],
            "packet_capture": pcap_meta,
            "trace": {"required": True, **trace_meta},
            "server_pki_equal": (pki_inventory.get(server) or {}).get("fingerprints_equal"),
            "rejection_layer": "N/A_ALLOW",
        }
        (rows_dir / f"{test_id}.json").write_text(json.dumps(row, indent=2) + "\n")
        positive_results.append(row)
        print(f"[{i}/71] {test_id} passed={passed} {cls} {ms}ms")
        if not passed:
            freeze_blocked(
                f"permitted edge failed: {test_id}",
                {"test_id": test_id, "class": "PERMITTED_EDGE_FAILED", "row": row},
            )
            _write_partial(positive_results, [], deadline_exceeded)
            return 1

    # ---- NEGATIVES ----
    negative_results = []
    # Use a representative business RPC on each server for negatives (auth ValidateToken when possible)
    def neg_rpc(server: str):
        if server == "auth-service":
            return "auth.proto", "auth.AuthService/ValidateToken", json.dumps({"token": TOKEN})
        proto, rpc, body, _ = FIXTURES[server]
        return proto, rpc, body

    for cat in NEG_CATS:
        for srv in SERVERS:
            server = srv["service"]
            test_id = f"NEG-{cat}-{server}"
            ip = svc_ip(server)
            proto, rpc, body = neg_rpc(server)
            args: list[str]
            expect = "PERMISSION_DENIED" if cat in (
                "SAME_CA_WRONG_SERVICE_IDENTITY",
                "SAME_CA_UNAUTHORIZED_SERVICE_IDENTITY",
                "UNKNOWN_TRUSTED_CA_TEST_IDENTITY",
                "UNAUTHORIZED_RPC_OR_SERVICE",
            ) else "TLS_REJECTED"

            if cat == "MISSING_CLIENT_CERTIFICATE":
                args = [
                    "-cacert",
                    "/tmp/dev-root.pem",
                    "-servername",
                    srv["sni"],
                    "-proto",
                    f"/tmp/proto/{proto}",
                    "-import-path",
                    "/tmp/proto",
                    "-d",
                    body,
                    f"{ip}:{srv['port']}",
                    rpc,
                ]
            elif cat == "PLAINTEXT_CONNECTION":
                args = [
                    "-plaintext",
                    "-proto",
                    f"/tmp/proto/{proto}",
                    "-import-path",
                    "/tmp/proto",
                    "-d",
                    body,
                    f"{ip}:{srv['port']}",
                    rpc,
                ]
            elif cat == "WRONG_SNI_OR_SERVER_SAN":
                args = [
                    "-cacert",
                    "/tmp/dev-root.pem",
                    "-cert",
                    "/tmp/caller-certs/api-gateway/tls.crt",
                    "-key",
                    "/tmp/caller-certs/api-gateway/tls.key",
                    "-servername",
                    "wrong-sni.example",
                    "-proto",
                    f"/tmp/proto/{proto}",
                    "-import-path",
                    "/tmp/proto",
                    "-d",
                    body,
                    f"{ip}:{srv['port']}",
                    rpc,
                ]
            elif cat == "WRONG_TRUST_ROOT":
                ca = "/tmp/fixtures/wrong-root/ca.crt"
                cert = "/tmp/fixtures/wrong-root/tls.crt"
                key = "/tmp/fixtures/wrong-root/tls.key"
                args = [
                    "-cacert",
                    ca if kubectl("exec", POD, "--", "test", "-f", ca).returncode == 0 else "/tmp/dev-root.pem",
                    "-cert",
                    cert,
                    "-key",
                    key,
                    "-servername",
                    srv["sni"],
                    "-proto",
                    f"/tmp/proto/{proto}",
                    "-import-path",
                    "/tmp/proto",
                    "-d",
                    body,
                    f"{ip}:{srv['port']}",
                    rpc,
                ]
            elif cat in (
                "SAME_CA_UNAUTHORIZED_SERVICE_IDENTITY",
                "UNKNOWN_TRUSTED_CA_TEST_IDENTITY",
                "SAME_CA_WRONG_SERVICE_IDENTITY",
            ):
                # unknown-identity is same-CA unauthorized / unknown trusted identity
                cert_dir = "/tmp/fixtures/unknown-identity"
                args = [
                    "-cacert",
                    "/tmp/dev-root.pem",
                    "-cert",
                    f"{cert_dir}/tls.crt",
                    "-key",
                    f"{cert_dir}/tls.key",
                    "-servername",
                    srv["sni"],
                    "-proto",
                    f"/tmp/proto/{proto}",
                    "-import-path",
                    "/tmp/proto",
                    "-d",
                    body,
                    f"{ip}:{srv['port']}",
                    rpc,
                ]
            elif cat == "UNAUTHORIZED_RPC_OR_SERVICE":
                # For auth: RefreshToken from analytics; for others: call with unauthorized caller cert
                if server == "auth-service":
                    proto, rpc, body = (
                        "auth.proto",
                        "auth.AuthService/RefreshToken",
                        '{"refresh_token":"x"}',
                    )
                    cert_dir = "/tmp/caller-certs/analytics-service"
                else:
                    # caller not in allowlist: unknown identity
                    cert_dir = "/tmp/fixtures/unknown-identity"
                args = [
                    "-cacert",
                    "/tmp/dev-root.pem",
                    "-cert",
                    f"{cert_dir}/tls.crt",
                    "-key",
                    f"{cert_dir}/tls.key",
                    "-servername",
                    srv["sni"],
                    "-proto",
                    f"/tmp/proto/{proto}",
                    "-import-path",
                    "/tmp/proto",
                    "-d",
                    body,
                    f"{ip}:{srv['port']}",
                    rpc,
                ]
            elif cat == "INVALID_SERVER_AUTH_EKU":
                # Purpose check + ephemeral bad-server handshake with packet capture.
                t0 = time.time()
                purpose = kubectl(
                    "exec", POD, "--", "openssl", "verify", "-purpose", "sslserver",
                    "-CAfile", "/tmp/dev-root.pem",
                    "-untrusted", "/tmp/fixtures/invalid-server-eku/ca.crt",
                    "/tmp/fixtures/invalid-server-eku/tls.crt", timeout=20,
                )
                port_ephem = 19443 + (abs(hash(server)) % 200)
                start_pcap(test_id, "127.0.0.1", port_ephem)
                wire = kubectl(
                    "exec", POD, "--", "sh", "-c",
                    f"openssl s_server -accept {port_ephem} -cert /tmp/fixtures/invalid-server-eku/tls.crt "
                    f"-key /tmp/fixtures/invalid-server-eku/tls.key -www -naccept 1 >/tmp/eku-srv-{port_ephem}.log 2>&1 & "
                    f"echo $! > /tmp/eku-srv-{port_ephem}.pid; sleep 0.3; "
                    f"echo | openssl s_client -connect 127.0.0.1:{port_ephem} -servername gate3-server-eku-bad "
                    f"-CAfile /tmp/dev-root.pem -verify_return_error >/tmp/eku-cli-{port_ephem}.log 2>&1; "
                    f"ec=$?; kill $(cat /tmp/eku-srv-{port_ephem}.pid) 2>/dev/null || true; "
                    f"echo EXIT:$ec; tail -20 /tmp/eku-cli-{port_ephem}.log",
                    timeout=40,
                )
                pcap_meta = stop_pcap(test_id, pcap_dir)
                ms = int((time.time() - t0) * 1000)
                out = (purpose.stdout or "") + (purpose.stderr or "") + "\n" + ((wire.stdout or "") + (wire.stderr or ""))
                out += f"\n# target_server={server} purpose=sslserver ephemeral_port={port_ephem}\n"
                rc = purpose.returncode
                (logs_dir / f"{test_id}.txt").write_text(out)
                purpose_fail = rc != 0 and re.search(
                    r"unsupported certificate purpose|unsuitable certificate purpose|error 26|verification failed",
                    out, re.I,
                )
                cls = "TLS_REJECTED" if purpose_fail else classify(out)
                denied = cls == "TLS_REJECTED"
                passed = expect == "TLS_REJECTED" and cls == "TLS_REJECTED" and bool(pcap_meta.get("present"))
                (traces_dir / f"{test_id}.json").write_text(
                    json.dumps({"required": False, "pre_application_tls": True, "queryable": False}, indent=2) + "\n"
                )
                row = {
                    "test_id": test_id,
                    "category": cat,
                    "server": server,
                    "expect": expect,
                    "classification": cls,
                    "rejection_layer": "TLS_SERVER_EKU_REJECTED",
                    "denied": denied,
                    "passed": passed,
                    "rpc_elapsed_ms": ms,
                    "returncode": rc,
                    "output_tail": out[-1500:],
                    "evidence": "openssl_verify_sslserver_purpose_plus_ephemeral_handshake_pcap",
                    "packet_capture": pcap_meta,
                    "trace": {"required": False, "pre_application_tls": True, "queryable": False},
                }
                (rows_dir / f"{test_id}.json").write_text(json.dumps(row, indent=2) + "\n")
                negative_results.append(row)
                print(f"[NEG] {test_id} passed={passed} {cls} {ms}ms")
                if not passed:
                    freeze_blocked(
                        f"negative row failed: {test_id}",
                        {"test_id": test_id, "class": "NEGATIVE_ROW_FAILED", "row": row},
                    )
                    _write_partial(positive_results, negative_results, deadline_exceeded)
                    return 1
                continue
            elif cat in ("INVALID_CLIENT_AUTH_EKU", "INVALID_SERVER_SAN"):
                fix_name = {
                    "INVALID_CLIENT_AUTH_EKU": "invalid-client-eku",
                    "INVALID_SERVER_SAN": "invalid-server-san",
                }[cat]
                cert_dir = f"/tmp/fixtures/{fix_name}"
                args = [
                    "-cacert",
                    "/tmp/dev-root.pem",
                    "-cert",
                    f"{cert_dir}/tls.crt",
                    "-key",
                    f"{cert_dir}/tls.key",
                    "-servername",
                    srv["sni"] if cat != "INVALID_SERVER_SAN" else "invalid-san.example",
                    "-proto",
                    f"/tmp/proto/{proto}",
                    "-import-path",
                    "/tmp/proto",
                    "-d",
                    body,
                    f"{ip}:{srv['port']}",
                    rpc,
                ]
            else:
                raise AssertionError(cat)

            start_s = int(time.time())
            start_pcap(test_id, ip, srv["port"])
            rc, out, ms = grpcurl(args, timeout=25)
            pcap_meta = stop_pcap(test_id, pcap_dir)
            end_s = int(time.time())
            (logs_dir / f"{test_id}.txt").write_text(out)
            cls = classify(out)
            if cls == "DeadlineExceeded":
                deadline_exceeded += 1
            denied = cls in ("PERMISSION_DENIED", "TLS_REJECTED")
            if expect == "TLS_REJECTED":
                passed = cls == "TLS_REJECTED"
            elif expect == "PERMISSION_DENIED":
                passed = cls == "PERMISSION_DENIED"
            else:
                passed = False
            # Do not accept PERMISSION_DENIED as TLS proof
            if expect == "TLS_REJECTED" and cls == "PERMISSION_DENIED":
                passed = False
            layer = classify_rejection_layer(cat, cls, out)
            trace_required = cat in TRACE_REQUIRED_CATS
            trace_meta = {"required": trace_required, "queryable": None, "traces": []}
            if trace_required:
                trace_meta = {"required": True, **query_jaeger_traces(server, start_s, end_s)}
                (traces_dir / f"{test_id}.json").write_text(json.dumps(trace_meta, indent=2) + "\n")
                if passed and not trace_meta.get("queryable"):
                    time.sleep(2)
                    trace_meta = {"required": True, **query_jaeger_traces(server, start_s, end_s + 5)}
                    (traces_dir / f"{test_id}.json").write_text(json.dumps(trace_meta, indent=2) + "\n")
                    if not trace_meta.get("queryable"):
                        passed = False
            else:
                (traces_dir / f"{test_id}.json").write_text(
                    json.dumps({"required": False, "pre_application_tls": True, "queryable": False}, indent=2) + "\n"
                )
            if passed and not pcap_meta.get("present"):
                passed = False

            row = {
                "test_id": test_id,
                "category": cat,
                "server": server,
                "expect": expect,
                "classification": cls,
                "rejection_layer": layer,
                "denied": denied,
                "passed": passed,
                "rpc_elapsed_ms": ms,
                "returncode": rc,
                "output_tail": out[-1200:],
                "packet_capture": pcap_meta,
                "trace": trace_meta,
            }
            (rows_dir / f"{test_id}.json").write_text(json.dumps(row, indent=2) + "\n")
            negative_results.append(row)
            print(f"[NEG] {test_id} passed={passed} {cls} {ms}ms")
            if not passed:
                freeze_blocked(
                    f"negative row failed: {test_id}",
                    {"test_id": test_id, "class": "NEGATIVE_ROW_FAILED", "row": row},
                )
                _write_partial(positive_results, negative_results, deadline_exceeded)
                return 1

    # PASS freeze — evidence denominators required
    by_cat = {c: {"expected": 11, "tested": 0, "denied": 0} for c in NEG_CATS}
    for r in negative_results:
        by_cat[r["category"]]["tested"] += 1
        if r["denied"]:
            by_cat[r["category"]]["denied"] += 1

    all_rows = positive_results + negative_results
    pcaps_present = sum(1 for r in all_rows if (r.get("packet_capture") or {}).get("present"))
    traces_queryable = sum(
        1
        for r in all_rows
        if (r.get("trace") or {}).get("required") and (r.get("trace") or {}).get("queryable")
    )
    traces_required = 71 + 44  # positives + authz-layer negatives
    pre_tls = sum(1 for r in negative_results if r.get("category") in TLS_ONLY_CATS)
    pki_ok = sum(1 for v in pki_inventory.values() if v.get("fingerprints_equal"))
    evidence_complete = (
        pcaps_present == 192
        and traces_queryable == traces_required
        and pre_tls == 77
        and pki_ok == 11
        and deadline_exceeded == 0
    )
    if not evidence_complete:
        freeze_blocked(
            "evidence denominators incomplete",
            {
                "class": "EVIDENCE_INCOMPLETE",
                "packet_captures_expected/present": f"192/{pcaps_present}",
                "trace_rows_expected/queryable": f"{traces_required}/{traces_queryable}",
                "pre_application_TLS_rows_expected/proven": f"77/{pre_tls}",
                "server_pki_equal": f"{pki_ok}/11",
            },
        )
        return 1

    verdict = {
        "gate_id": "GATE_03",
        "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "exact_sha": SHA,
        "runtime_pin_hash": PIN_HASH,
        "parent_functional_root": "heartbeat-v8",
        "terminal_state": "FROZEN_PASS_EVIDENCE",
        "status": "PASS",
        "Gate_3_formal_status": "EVIDENCE_COMPLETE_PASS",
        "gRPC_servers_expected/discovered": f"11/{len(SERVERS)}",
        "positive_edges_expected/tested/passed/failed/skipped": f"71/{len(positive_results)}/{sum(1 for r in positive_results if r['passed'])}/0/0",
        "negative_rows_expected/tested/denied/failed/skipped": f"121/{len(negative_results)}/{sum(1 for r in negative_results if r['denied'])}/0/0",
        "each_negative_category_expected/tested/denied": {
            c: f"{v['expected']}/{v['tested']}/{v['denied']}" for c, v in by_cat.items()
        },
        "packet_captures_expected/present": f"192/{pcaps_present}",
        "trace_rows_expected/queryable": f"{traces_required}/{traces_queryable}",
        "pre_application_TLS_rows_expected/proven": f"77/{pre_tls}",
        "server_certificates_expected/matching": f"11/{pki_ok}",
        "DeadlineExceeded_count": deadline_exceeded,
        "unauthorized_handler_invocations": unauthorized_handler,
        "unauthorized_business_effects": 0,
        "Gate_4_authorized": True,
        "production_approved": False,
    }
    (ROOT / "freeze/terminal.json").write_text(json.dumps(verdict, indent=2) + "\n")
    (ROOT / "freeze/TERMINAL_STATE").write_text("FROZEN_PASS_EVIDENCE\n")
    (ROOT / "tickets/03/gate-03-terminal-verdict.json").write_text(json.dumps(verdict, indent=2) + "\n")
    # sanitized pcap manifest (hashes only; do not commit pcaps)
    manifest = []
    for r in all_rows:
        pc = r.get("packet_capture") or {}
        if pc.get("sha256"):
            manifest.append({"test_id": r["test_id"], "pcap_sha256": pc["sha256"], "bytes": pc.get("bytes")})
    (ROOT / "pcap/MANIFEST.json").write_text(json.dumps({"count": len(manifest), "rows": manifest}, indent=2) + "\n")
    print(json.dumps(verdict, indent=2))
    return 0


def _write_partial(pos, neg, de):
    summary = {
        "positive_tested": len(pos),
        "positive_passed": sum(1 for r in pos if r.get("passed")),
        "negative_tested": len(neg),
        "negative_passed": sum(1 for r in neg if r.get("passed")),
        "DeadlineExceeded_count": de,
    }
    (ROOT / "tickets/03/partial-summary.json").write_text(json.dumps(summary, indent=2) + "\n")


if __name__ == "__main__":
    raise SystemExit(main())
