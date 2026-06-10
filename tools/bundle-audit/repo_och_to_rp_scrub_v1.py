#!/usr/bin/env python3
"""
OCH → RP string scrub for strict rp_namespace_linter_v1.py.

Walks scripts/, infra/, and services/ on disk (many paths are gitignored but
must still be lint-clean locally). Also scrubs repo-root Makefile and Caddyfile.
Does not modify docs/ (except renames listed in PATH_RENAMES under docs/).

  python3 tools/bundle-audit/repo_och_to_rp_scrub_v1.py --dry-run
  python3 tools/bundle-audit/repo_och_to_rp_scrub_v1.py --apply
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

SKIP_DIR_NAMES = frozenset(
    {
        ".git",
        "node_modules",
        "__pycache__",
        ".venv",
        "dist",
        "build",
        ".next",
        "coverage",
        "generated",
    }
)

TEXT_SUFFIXES = frozenset(
    {
        ".yaml",
        ".yml",
        ".json",
        ".ts",
        ".tsx",
        ".js",
        ".mjs",
        ".cjs",
        ".sh",
        ".bash",
        ".md",
        ".proto",
        ".sql",
        ".toml",
    }
)

OCH_HYPHEN_TOKEN = re.compile(r"\boch-([a-z][a-z0-9-]*)\b")

# Longest-first literals before the final regex sweep.
REPLACEMENTS: list[tuple[str, str]] = [
    ("off-campus-housing-tracker", "record-platform"),
    ("off-campus-housing.test", "record.test"),
    ("off-campus-housing.local", "record.test"),
    ("rollout-restart-och-full-stack.sh", "rollout-restart-rp-full-stack.sh"),
    ("rollout-restart-och-after-pool-tuning.sh", "rollout-restart-rp-after-pool-tuning.sh"),
    ("recycle-och-postgres-compose.sh", "recycle-rp-postgres-compose.sh"),
    ("rebuild-och-images-and-rollout.sh", "rebuild-rp-images-and-rollout.sh"),
    ("package-och-preflight-transport-bundle.sh", "package-preflight-transport-bundle.sh"),
    ("k8s-rollout-och-ordered.sh", "k8s-rollout-rp-ordered.sh"),
    ("diagnose-och-deployment.sh", "diagnose-rp-deployment.sh"),
    ("apply-och-messaging-and-restart.sh", "apply-rp-messaging-and-restart.sh"),
    ("och-housing-docker-services-default.sh", "housing-docker-services-default.sh"),
    ("ensure-och-grpc-certs.sh", "ensure-rp-grpc-certs.sh"),
    ("och-kafka-event-topics-from-proto.sh", "rp-kafka-event-topics-from-proto.sh"),
    ("prometheus-rules-och-slo.yaml", "prometheus-rules-rp-slo.yaml"),
    ("och-slo-prometheusrule.yaml", "rp-slo-prometheusrule.yaml"),
    ("och-observability-integrity-spec-v1.md", "rp-observability-integrity-spec-v1.md"),
    ("och-kafka-ssl-secret", "kafka-ssl-secret"),
    ("och-service-tls", "edge-service-tls"),
    ("/tmp/och-kafka-verify.props", "/tmp/rp-kafka-verify.props"),
    ("rollout-och-full", "rollout-rp-full"),
    ('"uid": "och-', '"uid": "rp-'),
    ("role: och-slo", "role: rp-slo"),
    ("#och-slo-", "#rp-slo-"),
    ("och-slo.yml", "rp-slo.yml"),
    ("rules/och-slo.yml", "rules/rp-slo.yml"),
    ("prometheus-rules-och-slo", "prometheus-rules-rp-slo"),
    ("name: prometheus-rules-och-slo", "name: prometheus-rules-rp-slo"),
    ("name: och-slo-recording", "name: rp-slo-recording"),
    ("name: och-slo-burn-alerts", "name: rp-slo-burn-alerts"),
    ("name: och-slo-violation-alerts", "name: rp-slo-violation-alerts"),
    ("- name: och-slo-recording", "- name: rp-slo-recording"),
    ("- name: och-slo-burn-alerts", "- name: rp-slo-burn-alerts"),
    ("- name: och-slo-violation-alerts", "- name: rp-slo-violation-alerts"),
    ("- name: och-transport-edge", "- name: rp-transport-edge"),
    ("och-transport-edge", "rp-transport-edge"),
    ("och-microservices-overview", "rp-microservices-overview"),
    ("och-distributed-tracing", "rp-distributed-tracing"),
    ("och-housing-uptime", "rp-housing-uptime"),
    ("och-auth-outbox", "rp-auth-outbox"),
    ("och-cluster-stability", "rp-cluster-stability"),
    ("och-forensic-mode", "rp-forensic-mode"),
    ("och-kafka-health", "rp-kafka-health"),
    ("och-tls-health", "rp-tls-health"),
    ("och-restart-anomaly", "rp-restart-anomaly"),
    ("och-kafka-election", "rp-kafka-election"),
    ("name: och-file", "name: rp-rules-file"),
    ("och-slo-rules", "rp-slo-rules"),
    ("alertmanager-och-slo-example", "alertmanager-rp-slo-example"),
    ("och_preflight", "preflight"),
    ("och-preflight", "preflight"),
    ("och-gateway", "api-gateway"),
    ("och-kafka CA", "Kafka CA"),
    ("_och_env", "_cluster_env"),
]

PATH_RENAMES: list[tuple[str, str]] = [
    ("scripts/apply-och-messaging-and-restart.sh", "scripts/apply-rp-messaging-and-restart.sh"),
    ("scripts/diagnose-och-deployment.sh", "scripts/diagnose-rp-deployment.sh"),
    ("scripts/k8s-rollout-och-ordered.sh", "scripts/k8s-rollout-rp-ordered.sh"),
    ("scripts/package-och-preflight-transport-bundle.sh", "scripts/package-preflight-transport-bundle.sh"),
    ("scripts/rebuild-och-images-and-rollout.sh", "scripts/rebuild-rp-images-and-rollout.sh"),
    ("scripts/recycle-och-postgres-compose.sh", "scripts/recycle-rp-postgres-compose.sh"),
    ("scripts/rollout-restart-och-after-pool-tuning.sh", "scripts/rollout-restart-rp-after-pool-tuning.sh"),
    ("scripts/rollout-restart-och-full-stack.sh", "scripts/rollout-restart-rp-full-stack.sh"),
    ("scripts/lib/och-kafka-event-topics-from-proto.sh", "scripts/lib/rp-kafka-event-topics-from-proto.sh"),
    ("scripts/lib/ensure-och-grpc-certs.sh", "scripts/lib/ensure-rp-grpc-certs.sh"),
    ("scripts/lib/och-housing-docker-services-default.sh", "scripts/lib/housing-docker-services-default.sh"),
    ("infra/k8s/base/observability/prometheus-rules-och-slo.yaml", "infra/k8s/base/observability/prometheus-rules-rp-slo.yaml"),
    ("infra/k8s/base/observability/och-slo-prometheusrule.yaml", "infra/k8s/base/observability/rp-slo-prometheusrule.yaml"),
    ("docs/observability/och-observability-integrity-spec-v1.md", "docs/observability/rp-observability-integrity-spec-v1.md"),
]


def should_scrub_file(p: Path) -> bool:
    if not p.is_file():
        return False
    suf = p.suffix.lower()
    name = p.name
    if suf in TEXT_SUFFIXES:
        return True
    if name in ("Makefile", "makefile", "Dockerfile", "Caddyfile", "package.json"):
        return True
    return False


def iter_scrub_targets(repo: Path) -> list[Path]:
    out: list[Path] = []
    for sub in ("scripts", "infra", "services"):
        root = repo / sub
        if not root.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(root, topdown=True):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIR_NAMES]
            for fn in filenames:
                fp = Path(dirpath) / fn
                if should_scrub_file(fp):
                    out.append(fp)
    for name in ("Makefile", "Caddyfile"):
        fp = repo / name
        if fp.is_file():
            out.append(fp)
    return sorted(set(out))


def scrub_text(text: str) -> str:
    for old, new in REPLACEMENTS:
        if old in text:
            text = text.replace(old, new)
    text = OCH_HYPHEN_TOKEN.sub(r"rp-\1", text)
    return text


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repo-root", type=Path, default=Path.cwd())
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    repo = args.repo_root.resolve()
    if not args.apply and not args.dry_run:
        print("Specify --dry-run or --apply", file=sys.stderr)
        return 2

    changed = 0
    for fp in iter_scrub_targets(repo):
        try:
            raw = fp.read_bytes()
        except OSError:
            continue
        if len(raw) > 4_000_000 or b"\x00" in raw[:8192]:
            continue
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            continue
        new = scrub_text(text)
        if new != text:
            changed += 1
            if args.apply:
                fp.write_text(new, encoding="utf-8", newline="\n")
    print(f"Files with text changes: {changed} ({'applied' if args.apply else 'dry-run'})")

    if args.apply:
        for old, new in PATH_RENAMES:
            a, b = repo / old, repo / new
            if a.is_file() and not b.exists():
                b.parent.mkdir(parents=True, exist_ok=True)
                a.rename(b)
                print(f"mv {old} -> {new}")
            elif a.is_file() and b.exists():
                print(f"skip mv (target exists): {old} -> {new}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
