#!/usr/bin/env python3
"""Audit RP runtime port contract across Dockerfile, K8s, app-config, proxies."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

REPO = Path(os.environ.get("REPO_ROOT", Path(__file__).resolve().parents[2]))
CONTRACT_PATH = REPO / "infra/contracts/rp-service-runtime-contract.json"
K8S_BASE = REPO / "infra/k8s/base"
OUT_DIR = Path(os.environ.get("OUT_DIR", REPO / "bench_logs/runtime-contract-audit"))
MODE = os.environ.get("RP_RUNTIME_AUDIT_MODE", "all")  # all | ports | probes | dockerfile


def load_contract() -> dict:
    return json.loads(CONTRACT_PATH.read_text())


def add(issues: list, category: str, service: str, msg: str) -> None:
    issues.append({"category": category, "service": service, "message": msg})


def parse_expose(dockerfile: Path) -> set[int]:
    ports: set[int] = set()
    if not dockerfile.is_file():
        return ports
    for line in dockerfile.read_text().splitlines():
        m = re.match(r"^\s*EXPOSE\s+(.+)", line, re.I)
        if m:
            for tok in m.group(1).split():
                if tok.isdigit():
                    ports.add(int(tok))
    return ports


def is_optional_runtime_entry(spec: dict) -> bool:
    """Ollama stack / transport-watchdog: contract metadata only, no Dockerfile in repo."""
    return not spec.get("dockerfile") or not spec.get("deployment")


def audit_dockerfile(svc: str, spec: dict, issues: list) -> None:
    if is_optional_runtime_entry(spec):
        return
    df = REPO / spec["dockerfile"]
    if not df.is_file():
        add(issues, "dockerfile", svc, f"missing {spec['dockerfile']}")
        return
    exposed = parse_expose(df)
    hp = spec["httpPort"]
    if hp not in exposed:
        add(issues, "dockerfile", svc, f"EXPOSE missing HTTP port {hp} (found {sorted(exposed) or 'none'})")
    gp = spec.get("grpcPort")
    if gp and gp not in exposed:
        add(issues, "dockerfile", svc, f"EXPOSE missing gRPC port {gp} (found {sorted(exposed) or 'none'})")


def read_yaml_text(path: Path) -> str:
    return path.read_text() if path.is_file() else ""


def audit_k8s_service(svc: str, spec: dict, issues: list) -> None:
    if is_optional_runtime_entry(spec):
        return
    path = K8S_BASE / svc / "service.yaml"
    text = read_yaml_text(path)
    if not text:
        add(issues, "k8s_service", svc, f"missing {path.relative_to(REPO)}")
        return
    hp = spec["httpPort"]
    if re.search(rf"port:\s*{hp}\b", text) or re.search(rf"port:\s*http\b", text):
        pass
    else:
        # forbidden wrong ports near service
        for bad in (4020, 4011):
            if bad != hp and re.search(rf"port:\s*{bad}\b", text):
                add(issues, "k8s_service", svc, f"Service exposes stale port {bad} (contract {hp})")
        if not re.search(rf"\bport:\s*{hp}\b", text) and "targetPort: http" not in text:
            add(issues, "k8s_service", svc, f"Service HTTP port not {hp} (check service.yaml)")
    gp = spec.get("grpcPort")
    if gp and not re.search(rf"\bport:\s*{gp}\b", text) and "targetPort: grpc" not in text:
        add(issues, "k8s_service", svc, f"Service gRPC port not {gp}")


def audit_k8s_deploy(svc: str, spec: dict, issues: list) -> None:
    if is_optional_runtime_entry(spec):
        return
    path = K8S_BASE / svc / "deploy.yaml"
    if svc == "webapp":
        path = K8S_BASE / "webapp" / "deploy.yaml"
    text = read_yaml_text(path)
    if not text:
        add(issues, "k8s_deploy", svc, f"missing deployment manifest")
        return
    hp = spec["httpPort"]
    gp = spec.get("grpcPort")

    if re.search(rf"containerPort:\s*{hp}\b", text) or "containerPort: http" in text or f'name: http\n              containerPort: {hp}' in text.replace(" ", ""):
        pass
    elif f"containerPort: {hp}" not in text:
        if re.search(r"containerPort:\s*4020", text):
            add(issues, "k8s_deploy", svc, "containerPort 4020 (contract 4000 for api-gateway)" if svc == "api-gateway" else "stale containerPort 4020")
        if re.search(r"containerPort:\s*4011", text) and hp == 4001:
            add(issues, "k8s_deploy", svc, "containerPort 4011 (contract AUTH HTTP 4001)")

    for bad_env, expect in (("GATEWAY_PORT", "4000"), ("AUTH_PORT", "4001")):
        if svc in ("api-gateway",) and bad_env == "GATEWAY_PORT":
            m = re.search(r'GATEWAY_PORT\s*\n\s*value:\s*"(\d+)"', text)
            if m and m.group(1) != expect:
                add(issues, "k8s_deploy", svc, f'GATEWAY_PORT env {m.group(1)} != {expect}')
        if svc == "auth-service" and bad_env == "AUTH_PORT":
            pass

    if gp and f"containerPort: {gp}" not in text and "containerPort: grpc" not in text:
        add(issues, "k8s_deploy", svc, f"missing gRPC containerPort {gp}")

    # Probes: kubelet readiness must not use grpc-health-probe for app Ready
    if "grpc-health-probe" in text and "readinessProbe:" in text:
        block = text.split("readinessProbe:")[1].split("livenessProbe:")[0]
        if "grpc-health-probe" in block:
            add(issues, "k8s_probe", svc, "readinessProbe uses grpc-health-probe (use HTTP /healthz or /readyz per contract)")

    ready = spec.get("readyPath") or spec.get("healthPath")
    if MODE in ("all", "probes") and "readinessProbe:" in text:
        rblock = text.split("readinessProbe:", 1)[1]
        if "livenessProbe:" in rblock:
            rblock = rblock.split("livenessProbe:", 1)[0]
        if "httpGet:" in rblock:
            m = re.search(r"path:\s*(\S+)", rblock)
            rpath = m.group(1) if m else ""
            if rpath != ready:
                add(
                    issues,
                    "k8s_probe",
                    svc,
                    f"readiness httpGet path {rpath!r} != contract readyPath {ready!r}",
                )
        elif "exec:" in rblock and "grpc-health-probe" in rblock:
            add(issues, "k8s_probe", svc, "readiness still gRPC exec probe")


def audit_app_config(issues: list) -> None:
    cfg = read_yaml_text(K8S_BASE / "config/app-config.yaml")
    fixes = {
        "GATEWAY_PORT": "4000",
        "AUTH_PORT": "4001",
    }
    for key, val in fixes.items():
        m = re.search(rf"^\s*{key}:\s*\"?(\d+)\"?", cfg, re.M)
        if m and m.group(1) != val:
            add(issues, "app_config", "app-config", f"{key}={m.group(1)} (contract {val})")


def audit_proxy(issues: list) -> None:
    prom = read_yaml_text(K8S_BASE / "observability/prometheus-deploy.yaml")
    if ":4020" in prom:
        add(issues, "proxy", "prometheus", "scrape target still uses api-gateway:4020")
    if ":4011" in prom and "auth-service" in prom:
        add(issues, "proxy", "prometheus", "scrape target still uses auth-service:4011")
    haproxy = read_yaml_text(K8S_BASE / "haproxy/configmap.yaml")
    if "api-gateway" in haproxy and ":4020" in haproxy:
        add(issues, "proxy", "haproxy", "upstream api-gateway:4020 (contract 4000)")


def audit_app_code(svc: str, spec: dict, issues: list) -> None:
    if svc == "api-gateway":
        p = REPO / "services/api-gateway/src/server.ts"
        if p.is_file() and "4020" in p.read_text() and "4000" not in p.read_text().split("GATEWAY_PORT")[0]:
            t = p.read_text()
            if re.search(r"GATEWAY_PORT\s*\|\|\s*4020", t):
                add(issues, "app_code", svc, "server.ts defaults GATEWAY_PORT to 4020 (contract 4000)")


def main() -> int:
    contract = load_contract()
    issues: list[dict] = []
    services = contract["services"]

    if MODE in ("all", "dockerfile"):
        for svc, spec in services.items():
            audit_dockerfile(svc, spec, issues)
    if MODE in ("all", "ports"):
        audit_app_config(issues)
        audit_proxy(issues)
        for svc, spec in services.items():
            audit_k8s_service(svc, spec, issues)
            audit_k8s_deploy(svc, spec, issues)
            audit_app_code(svc, spec, issues)
    if MODE in ("all", "probes"):
        for svc, spec in services.items():
            audit_k8s_deploy(svc, spec, issues)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    status = "pass" if not issues else "fail"
    report = {"status": status, "mode": MODE, "issue_count": len(issues), "issues": issues}
    (OUT_DIR / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    lines = [f"# RP runtime contract audit ({MODE})", "", f"Status: **{status}**", f"Issues: {len(issues)}", ""]
    for i in issues:
        lines.append(f"- [{i['category']}] **{i['service']}**: {i['message']}")
    (OUT_DIR / "report.md").write_text("\n".join(lines) + "\n")
    print(f"Report: {OUT_DIR / 'report.md'}")
    if issues:
        for i in issues[:40]:
            print(f"❌ [{i['category']}] {i['service']}: {i['message']}", file=sys.stderr)
        if len(issues) > 40:
            print(f"... and {len(issues) - 40} more", file=sys.stderr)
        return 1
    print("✅ runtime contract audit passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
