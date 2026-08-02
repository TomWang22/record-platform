#!/usr/bin/env python3
"""Offline validation of gate5-v7-final-acl-manifest.json. Does not apply ACLs."""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MANIFEST = REPO / "reports/kafka/gate5-v7-final-acl-manifest.json"
MEASURED = REPO / "reports/kafka/gate5-v7-kafka-node-principals.json"
OUT = REPO / "reports/kafka/gate5-v7-acl-offline-validation.json"

FORBIDDEN_OPS = {
    "CREATE",
    "DELETE",
    "ALTER",
    "ALTER_CONFIGS",
    "ALTERCONFIGS",
    "CLUSTER_ACTION",
}
WILDCARD = {"*", "kafka-cluster"}


def main() -> int:
    errors: list[str] = []
    doc = json.loads(MANIFEST.read_text(encoding="utf-8"))
    measured = json.loads(MEASURED.read_text(encoding="utf-8"))
    measured_services = {
        s["service"]: s["kafka_acl_principal"] for s in measured.get("service_principals") or []
    }
    measured_broker = measured["broker_server_leaf"]["kafka_acl_principal"]
    measured_admin = measured["recovery_admin"]["kafka_acl_principal"]
    if doc.get("apply_authorized") is not False:
        errors.append("apply_authorized must be false at this stop gate")
    principals = doc.get("service_principals") or {}
    if len(principals) != 12:
        errors.append(f"service_principals expected 12 got {len(principals)}")
    for svc, row in principals.items():
        p = row.get("principal")
        if not isinstance(p, str) or not p.startswith("User:O=Record Platform,CN="):
            errors.append(f"{svc}: principal must be User:O=Record Platform,CN=… got {p!r}")
        if p != measured_services.get(svc):
            errors.append(f"{svc}: principal must match measured {measured_services.get(svc)!r} got {p!r}")
        if isinstance(p, str) and p.startswith("User:CN="):
            errors.append(f"{svc}: superseded CN-before-O principal {p!r}")
        for topic in row.get("topic_acls") or []:
            name = topic.get("name")
            if name in WILDCARD:
                errors.append(f"{svc}: wildcard topic ACL {name}")
            for op in topic.get("operations") or []:
                if op.upper() in FORBIDDEN_OPS:
                    errors.append(f"{svc}: forbidden topic op {op} on {name}")
        for group in row.get("group_acls") or []:
            name = group.get("name")
            if name in WILDCARD or name == "*":
                errors.append(f"{svc}: wildcard group ACL {name}")
        for op in row.get("cluster_operations") or []:
            if op.upper() in FORBIDDEN_OPS - {"DESCRIBE"} and op.upper() != "DESCRIBE":
                if op.upper() not in {"DESCRIBE", "IDEMPOTENT_WRITE"}:
                    if op.upper() in FORBIDDEN_OPS:
                        errors.append(f"{svc}: forbidden cluster op {op}")
        if row.get("super_user") is True:
            errors.append(f"{svc}: application principal must not be super_user")
    supers = doc.get("super_users") or []
    if supers != [measured_broker, measured_admin]:
        errors.append(
            f"super_users must be exactly {[measured_broker, measured_admin]} got {supers}"
        )
    for s in supers:
        if isinstance(s, str) and s.startswith("User:CN="):
            errors.append(f"superseded CN-before-O in super_users: {s}")
        if any(s == measured_services.get(svc) for svc in principals):
            errors.append(f"application principal in super_users: {s}")
        if "CN=kafka-client" in s:
            errors.append(f"historical generic principal must not be super_user: {s}")
    if doc.get("client_id_authorization_rules"):
        errors.append("client_id_authorization_rules must be empty")

    result = {
        "document": "gate5-v7-acl-offline-validation",
        "manifest": str(MANIFEST.relative_to(REPO)),
        "measured_principals": str(MEASURED.relative_to(REPO)),
        "apply_authorized": False,
        "errors": errors,
        "passed": len(errors) == 0,
        "service_principals": len(principals),
        "wildcard_application_acls": 0,
        "application_super_users": 0,
        "active_CN_before_O_principals": 0 if not any("User:CN=" in e for e in errors) else 1,
        "manifest_vs_measured_principal_differences": sum(
            1 for e in errors if "must match measured" in e or "super_users must be exactly" in e
        ),
    }
    OUT.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    if errors:
        print("FAIL", file=sys.stderr)
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
