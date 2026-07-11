#!/usr/bin/env python3
"""Offline semantic validation for Kafka health Prometheus rules (ConfigMap data)."""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

EXPECTED_ALERTS = frozenset(
    {
        "KafkaUnderReplicatedPartitions",
        "KafkaActiveControllerCount",
        "KafkaLeaderElectionRateHigh",
        "KafkaCARotated",
        "KafkaMetallbAdvertisedLBDrift",
        "KafkaRuntimeConfigDrift",
    }
)

DURATION_RE = re.compile(r"^(\d+)(ms|s|m|h|d|w|y)$", re.IGNORECASE)


def extract_rules_blob(text: str) -> str:
    if "kind: ConfigMap" not in text:
        raise ValueError("expected ConfigMap manifest")
    match = re.search(r"kafka-health\.yml:\s*\|\s*\n", text)
    if not match:
        raise ValueError("ConfigMap missing data[kafka-health.yml]")
    start = match.end()
    lines = text[start:].splitlines()
    body: list[str] = []
    for line in lines:
        if line and not line.startswith(" "):
            break
        body.append(line[4:] if line.startswith("    ") else line.lstrip())
    blob = "\n".join(body).strip()
    if not blob:
        raise ValueError("kafka-health.yml body is empty")
    return blob


def validate_rules_blob(blob: str) -> list[str]:
    errors: list[str] = []
    groups = re.split(r"^- name:\s*", blob, flags=re.MULTILINE)[1:]
    if not groups:
        errors.append("spec.groups is empty")
        return errors

    rule_names: list[str] = []
    for chunk in groups:
        rules = re.split(r"^\s+- alert:\s*", chunk, flags=re.MULTILINE)[1:]
        if not rules:
            errors.append("group has no rules")
        for rule in rules:
            name_match = re.match(r"(\S+)", rule)
            if not name_match:
                errors.append("rule missing alert name")
                continue
            name = name_match.group(1)
            rule_names.append(name)
            expr_match = re.search(r"^\s+expr:\s*(.+)$", rule, flags=re.MULTILINE)
            if not expr_match or not expr_match.group(1).strip():
                errors.append(f"rule {name}: empty expr")
            for_match = re.search(r"^\s+for:\s*(\S+)", rule, flags=re.MULTILINE)
            if for_match and not DURATION_RE.match(for_match.group(1)):
                errors.append(f"rule {name}: invalid duration {for_match.group(1)!r}")

    dupes = {n for n in rule_names if rule_names.count(n) > 1}
    for name in sorted(dupes):
        errors.append(f"duplicate rule name: {name}")

    present_alerts = {n for n in rule_names if n in EXPECTED_ALERTS}
    for name in sorted(EXPECTED_ALERTS - present_alerts):
        errors.append(f"expected Kafka health alert missing: {name}")

    return errors


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "path",
        type=Path,
        nargs="?",
        default=Path("infra/k8s/base/observability/prometheus-rules-kafka-health.yaml"),
    )
    args = ap.parse_args()
    path = args.path.resolve()
    text = path.read_text(encoding="utf-8")
    if "name: prometheus-rules-kafka-health" not in text:
        print("BLOCKED: ConfigMap metadata.name missing", file=sys.stderr)
        return 1
    errors = validate_rules_blob(extract_rules_blob(text))
    if errors:
        for err in errors:
            print(f"BLOCKED: {err}", file=sys.stderr)
        return 1
    print(f"Kafka health Prometheus rules semantic validation PASS ({path.name})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
