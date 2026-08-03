#!/usr/bin/env python3
"""Seal Gate 5 v8 preflight: single-writer lock + immutable preflight manifest."""
from __future__ import annotations

import hashlib
import json
import os
import socket
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(os.environ.get("RP_GATE5_V8_ROOT", "/tmp/record-platform-runtime-heartbeat-gate5-v8"))
REPO = Path(__file__).resolve().parents[1]
NS = os.environ.get("HOUSING_NS", "record-platform")
CTRL_SHA = "c7e71bd749654b2526eab1b5e064d8dccaeb91de"
RUNTIME_SHA = "c800ac5313ea8fb88a59f08c7347103ba1d4ed19"


def utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sh(*args: str) -> str:
    return subprocess.check_output(list(args), text=True).strip()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def kubectl_json(args: list[str]):
    return json.loads(sh("kubectl", "-n", NS, *args))


def main() -> int:
    if not ROOT.is_dir():
        print(f"missing evidence root: {ROOT}", file=sys.stderr)
        return 2
    preflight = ROOT / "preflight"
    preflight.mkdir(parents=True, exist_ok=True)
    lock = preflight / "single-writer.json"
    if lock.exists():
        existing = json.loads(lock.read_text())
        if existing.get("pid") and Path(f"/proc/{existing['pid']}").exists():
            # Linux; on macOS fall through to hostname/pid check below
            pass
        if existing.get("holder") not in (None, f"{socket.gethostname()}:{os.getpid()}"):
            # Allow re-seal by same host if lock age > 0 and force not set — require exclusive create
            if os.environ.get("RP_GATE5_V8_RESEAL") != "1":
                print(f"single-writer already held: {existing}", file=sys.stderr)
                return 3

    holder = f"{socket.gethostname()}:{os.getpid()}"
    lock_body = {
        "document": "gate5-v8-single-writer",
        "ts": utc(),
        "holder": holder,
        "pid": os.getpid(),
        "hostname": socket.gethostname(),
        "evidence_root": str(ROOT),
        "writers": 1,
    }
    # O_EXCL if first writer
    try:
        fd = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o444)
        with os.fdopen(fd, "w") as f:
            json.dump(lock_body, f, indent=2)
            f.write("\n")
    except FileExistsError:
        if os.environ.get("RP_GATE5_V8_RESEAL") == "1":
            os.chmod(lock, 0o644)
            lock.write_text(json.dumps(lock_body, indent=2) + "\n")
            os.chmod(lock, 0o444)
        else:
            print(f"single-writer lock exists: {lock}", file=sys.stderr)
            return 3

    head = sh("git", "-C", str(REPO), "rev-parse", "HEAD")
    if head != CTRL_SHA and os.environ.get("RP_GATE5_V8_ALLOW_SHA_DRIFT") != "1":
        print(f"controller SHA drift: expected {CTRL_SHA} got {head}", file=sys.stderr)
        return 4

    # Hash existing preflight files
    pf_files = sorted(p for p in preflight.iterdir() if p.is_file() and p.name.startswith("PREFLIGHT"))
    file_hashes = {p.name: sha256_file(p) for p in pf_files}

    sts = kubectl_json(["get", "sts", "kafka", "-o", "json"])
    pods = kubectl_json(["get", "pods", "-l", "app=kafka", "-o", "json"])
    kafka_pods = []
    for item in pods.get("items", []):
        md = item["metadata"]
        st = item.get("status", {})
        containers = (item.get("status", {}).get("containerStatuses") or [{}])[0]
        kafka_pods.append(
            {
                "name": md["name"],
                "uid": md["uid"],
                "resourceVersion": md["resourceVersion"],
                "image": (containers.get("image") or ""),
                "imageID": (containers.get("imageID") or ""),
                "ready": all(c.get("ready") for c in (st.get("containerStatuses") or [])),
            }
        )

    services = [
        "analytics-service",
        "auction-monitor",
        "auth-service",
        "listings-service",
        "media-service",
        "messaging-service",
        "notification-service",
        "python-ai-service",
        "shopping-service",
        "trust-service",
        "ollama-gateway",
        "ollama-worker",
    ]
    participants = []
    for svc in services:
        pl = kubectl_json(["get", "pods", "-l", f"app={svc}", "-o", "json"])
        items = pl.get("items") or []
        if not items:
            # try app.kubernetes.io/name
            pl = kubectl_json(["get", "pods", "-l", f"app.kubernetes.io/name={svc}", "-o", "json"])
            items = pl.get("items") or []
        for item in items:
            md = item["metadata"]
            cs = (item.get("status", {}).get("containerStatuses") or [{}])[0]
            env_sha = None
            for c in item.get("spec", {}).get("containers") or []:
                for e in c.get("env") or []:
                    if e.get("name") == "RP_SOURCE_SHA":
                        env_sha = e.get("value")
            participants.append(
                {
                    "service": svc,
                    "pod": md["name"],
                    "uid": md["uid"],
                    "image": cs.get("image") or "",
                    "imageID": cs.get("imageID") or "",
                    "RP_SOURCE_SHA": env_sha,
                }
            )

    cert_rvs = {}
    for svc in services:
        secret = f"kafka-client-tls-{svc}"
        try:
            sec = kubectl_json(["get", "secret", secret, "-o", "json"])
            cert_rvs[secret] = sec["metadata"]["resourceVersion"]
        except subprocess.CalledProcessError:
            cert_rvs[secret] = None

    acl_summary = REPO / "reports/kafka/gate5-v7-acl-bootstrap-summary.json"
    acl_hash = sha256_file(acl_summary) if acl_summary.is_file() else None
    authorizer = REPO / "reports/kafka/gate5-v7-authorizer-verify.json"
    authorizer_hash = sha256_file(authorizer) if authorizer.is_file() else None

    # Topic/group census hash from final ACL manifest
    manifest = REPO / "reports/kafka/gate5-v7-final-acl-manifest.json"
    census_hash = sha256_file(manifest) if manifest.is_file() else None

    pin_path = ROOT / "pin" / "runtime-pin.json"
    pin_path.parent.mkdir(parents=True, exist_ok=True)
    pin_body = {
        "controller_sha": CTRL_SHA,
        "participant_runtime_sha": RUNTIME_SHA,
        "git_head": head,
        "ts": utc(),
    }
    pin_path.write_text(json.dumps(pin_body, indent=2) + "\n")
    pin_hash = sha256_file(pin_path)

    manifest_body = {
        "document": "gate5-v8-preflight-manifest",
        "ts": utc(),
        "immutable": True,
        "evidence_root": str(ROOT),
        "exact_controller_sha": CTRL_SHA,
        "accepted_participant_runtime_sha": RUNTIME_SHA,
        "runtime_pin_hash": pin_hash,
        "preflight_file_hashes": file_hashes,
        "kafka_statefulset": {
            "generation": sts["metadata"].get("generation"),
            "observedGeneration": sts.get("status", {}).get("observedGeneration"),
            "resourceVersion": sts["metadata"].get("resourceVersion"),
            "readyReplicas": sts.get("status", {}).get("readyReplicas"),
            "replicas": sts.get("spec", {}).get("replicas"),
        },
        "kafka_pod_uids": {p["name"]: p["uid"] for p in kafka_pods},
        "broker_image_digests": {p["name"]: p["imageID"] for p in kafka_pods},
        "participant_pod_uids": {p["pod"]: p["uid"] for p in participants},
        "participant_image_digests": {p["pod"]: p["imageID"] for p in participants},
        "certificate_secret_resourceVersions": cert_rvs,
        "acl_read_only_snapshot_hash": acl_hash,
        "authorizer_configuration_hash": authorizer_hash,
        "topic_group_census_hash": census_hash,
        "single_writer": True,
        "writers": 1,
        "holder": holder,
    }
    man_path = preflight / "preflight-manifest.json"
    man_bytes = (json.dumps(manifest_body, indent=2, sort_keys=True) + "\n").encode()
    man_path.write_bytes(man_bytes)
    os.chmod(man_path, 0o444)
    digest = sha256_bytes(man_bytes)
    (preflight / "preflight-manifest.sha256").write_text(digest + "\n")
    os.chmod(preflight / "preflight-manifest.sha256", 0o444)

    # Update STATUS to matrices running
    status = ROOT / "STATUS.json"
    os.chmod(status, 0o644)
    status.write_text(
        json.dumps(
            {
                "document": "STATUS",
                "ts": utc(),
                "state": "MATRICES_RUNNING",
                "preflight_sealed": True,
                "preflight_manifest_sha256": digest,
                "gate5_final_pass": False,
                "gate6_authorized": False,
                "pre_performance_gate_earned": False,
                "production_approved": False,
                "evidence_complete_pass": False,
            },
            indent=2,
        )
        + "\n"
    )
    print(json.dumps({"sealed": True, "preflight_manifest_sha256": digest, "single_writer": True}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
