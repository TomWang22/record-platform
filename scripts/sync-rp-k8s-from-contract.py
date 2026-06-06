#!/usr/bin/env python3
"""Align K8s deploy/service ports and HTTP probes with rp-service-runtime-contract.json."""
from __future__ import annotations

import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CONTRACT = json.loads((REPO / "infra/contracts/rp-service-runtime-contract.json").read_text())
K8S = REPO / "infra/k8s/base"

HTTP_STARTUP = """          startupProbe:
            tcpSocket:
              port: http
            periodSeconds: 5
            timeoutSeconds: 5
            failureThreshold: 60"""

HTTP_READINESS = """          readinessProbe:
            httpGet:
              path: {ready_path}
              port: http
            initialDelaySeconds: 30
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 12"""

HTTP_LIVENESS = """          livenessProbe:
            httpGet:
              path: {health_path}
              port: http
            initialDelaySeconds: 120
            periodSeconds: 20
            timeoutSeconds: 5
            failureThreshold: 6"""

GRPC_SERVICES = [
    "auth-service",
    "records-service",
    "shopping-service",
    "auction-monitor",
    "listings-service",
    "messaging-service",
    "notification-service",
    "trust-service",
    "analytics-service",
    "media-service",
    "python-ai-service",
]


def probe_block(spec: dict) -> str:
    ready = spec.get("readyPath", spec["healthPath"])
    health = spec["healthPath"]
    return (
        HTTP_STARTUP
        + "\n"
        + HTTP_READINESS.format(ready_path=ready)
        + "\n"
        + HTTP_LIVENESS.format(health_path=health)
        + "\n"
    )


def strip_probe_blocks(text: str) -> str:
    """Remove all startup/readiness/liveness probe blocks and related comment banners."""
    text = re.sub(
        r"\n          # (Dual Health|gRPC Health)[^\n]*(?:\n          #[^\n]*)*",
        "",
        text,
    )
    for probe in ("startupProbe", "readinessProbe", "livenessProbe"):
        pat = re.compile(
            rf"\n          {probe}:.*?(?=\n          [a-zA-Z#]|\n      volumes:|\n\n      volumes:)",
            re.S,
        )
        while pat.search(text):
            text = pat.sub("", text, count=1)
    return text


def insert_probes_before_anchor(text: str, spec: dict) -> str:
    block = probe_block(spec)
    for anchor in ("\n          resources:", "\n      volumes:"):
        if anchor in text:
            return text.replace(anchor, "\n" + block + anchor, 1)
    return text + "\n" + block


def replace_probe_block(text: str, spec: dict) -> str:
    return insert_probes_before_anchor(strip_probe_blocks(text), spec)


def fix_http_grpc_ports(text: str, spec: dict) -> str:
    hp = spec["httpPort"]
    gp = spec.get("grpcPort")
    text = re.sub(r"containerPort: \d+\s*\n(\s+- name: grpc)", rf"containerPort: {hp}\n\1", text, count=1)
    text = re.sub(
        r"(- name: http\s*\n\s+containerPort: )\d+",
        rf"\g<1>{hp}",
        text,
        count=1,
    )
    if gp:
        text = re.sub(
            r"(- name: grpc\s*\n\s+containerPort: )\d+",
            rf"\g<1>{gp}",
            text,
            count=1,
        )
        text = re.sub(r'(\n\s+- name: GRPC_PORT\s*\n\s+value: ")\d+(")', rf"\g<1>{gp}\2", text, count=1)
    text = re.sub(r'prometheus\.io/port: "\d+"', f'prometheus.io/port: "{hp}"', text, count=1)
    for env_key in spec.get("httpEnv") or []:
        text = re.sub(
            rf'(\n\s+- name: {re.escape(env_key)}\s*\n\s+value: ")\d+(")',
            rf"\g<1>{hp}\2",
            text,
            count=1,
        )
    return text


def fix_api_gateway(text: str) -> str:
    spec = CONTRACT["services"]["api-gateway"]
    text = text.replace("containerPort: 4020", "containerPort: 4000")
    text = text.replace('value: "4020"', 'value: "4000"')
    text = text.replace('prometheus.io/port: "4020"', 'prometheus.io/port: "4000"')
    text = text.replace("port: 4020", "port: 4000")
    text = text.replace("127.0.0.1:4020/readyz", "127.0.0.1:4000/readyz")
    text = re.sub(r"port 4020 per README", "port 4000 per runtime contract", text)
    text = strip_probe_blocks(text)
    block = probe_block(spec)
    text = text.replace(
        "\n          startupProbe:",
        "\n          startupProbe:",
    )
    # api-gateway uses inline httpGet probes — replace whole probe section
    text = strip_probe_blocks(text)
    text = insert_probes_before_anchor(text, spec)
    return text


def fix_service_ports(svc: str, spec: dict) -> None:
    path = K8S / svc / "service.yaml"
    if not path.is_file():
        return
    t = path.read_text()
    hp = spec["httpPort"]
    gp = spec.get("grpcPort")
    t = re.sub(r"(- port: )\d+(\s*\n\s+targetPort: http)", rf"\g<1>{hp}\2", t, count=1)
    if gp:
        t = re.sub(r"(- port: )\d+(\s*\n\s+targetPort: grpc)", rf"\g<1>{gp}\2", t, count=1)
    if svc == "api-gateway":
        t = t.replace("port: 4020", f"port: {hp}").replace("targetPort: 4020", f"targetPort: {hp}")
    if svc == "auth-service":
        t = re.sub(r"port: 4011\b", f"port: {hp}", t)
    path.write_text(t)


def fix_dockerfile_expose(svc: str, spec: dict) -> None:
    dockerfile = spec.get("dockerfile")
    if not dockerfile:
        return
    path = REPO / dockerfile
    if not path.is_file():
        return
    hp = spec["httpPort"]
    gp = spec.get("grpcPort")
    lines = path.read_text().splitlines()
    out: list[str] = []
    replaced = False
    for line in lines:
        if re.match(r"^\s*EXPOSE\b", line, re.I):
            ports = [str(hp)]
            if gp:
                ports.append(str(gp))
            out.append(f"EXPOSE {' '.join(ports)}")
            replaced = True
        else:
            out.append(line)
    if not replaced:
        out.append(f"EXPOSE {hp}" + (f" {gp}" if gp else ""))
    path.write_text("\n".join(out) + "\n")


def main() -> None:
    ag_deploy = K8S / "api-gateway/deploy.yaml"
    ag_deploy.write_text(fix_api_gateway(ag_deploy.read_text()))
    fix_service_ports("api-gateway", CONTRACT["services"]["api-gateway"])

    for svc in GRPC_SERVICES:
        spec = CONTRACT["services"][svc]
        deploy_path = K8S / svc / "deploy.yaml"
        if not deploy_path.is_file():
            continue
        text = deploy_path.read_text()
        text = fix_http_grpc_ports(text, spec)
        text = replace_probe_block(text, spec)
        deploy_path.write_text(text)
        fix_service_ports(svc, spec)
        fix_dockerfile_expose(svc, spec)

    cfg = K8S / "config/app-config.yaml"
    c = cfg.read_text()
    c = re.sub(r'^  GATEWAY_PORT: "4020"', '  GATEWAY_PORT: "4000"', c, flags=re.M)
    c = re.sub(r'^  AUTH_PORT: "4011"', '  AUTH_PORT: "4001"', c, flags=re.M)
    c = re.sub(r'^  LISTINGS_PORT: "4003"', '  LISTINGS_PORT: "4012"', c, flags=re.M)
    c = re.sub(r'^  ANALYTICS_PORT: "4004"', '  ANALYTICS_PORT: "4017"', c, flags=re.M)
    cfg.write_text(c)

    prom = K8S / "observability/prometheus-deploy.yaml"
    if prom.is_file():
        p = prom.read_text()
        p = p.replace("api-gateway.record-platform.svc.cluster.local:4020", "api-gateway.record-platform.svc.cluster.local:4000")
        p = p.replace("auth-service.record-platform.svc.cluster.local:4011", "auth-service.record-platform.svc.cluster.local:4001")
        prom.write_text(p)

    srv = REPO / "services/api-gateway/src/server.ts"
    if srv.is_file():
        s = srv.read_text()
        s = s.replace("process.env.GATEWAY_PORT || 4020", "process.env.GATEWAY_PORT || 4000")
        srv.write_text(s)

    tw = REPO / "services/transport-watchdog/src/index.ts"
    if tw.is_file():
        t = tw.read_text()
        t = t.replace("127.0.0.1:4020/readyz", "127.0.0.1:4000/readyz")
        tw.write_text(t)

    print("✅ sync-rp-k8s-from-contract.py applied port + HTTP probe alignment")


if __name__ == "__main__":
    main()
