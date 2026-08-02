#!/usr/bin/env python3
"""Offline validation of gate5-v7-final-acl-manifest.json. Does not apply ACLs."""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MANIFEST = REPO / "reports/kafka/gate5-v7-final-acl-manifest.json"
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
    if doc.get("apply_authorized") is not False:
        errors.append("apply_authorized must be false at this stop gate")
    principals = doc.get("service_principals") or {}
    if len(principals) != 12:
        errors.append(f"service_principals expected 12 got {len(principals)}")
    for svc, row in principals.items():
        p = row.get("principal")
        if not isinstance(p, str) or not p.startswith("User:O=Record Platform,CN="):
            errors.append(f"{svc}: principal must be User:O=Record Platform,CN=… got {p!r}")
        if p != f"User:O=Record Platform,CN={svc}":
            errors.append(f"{svc}: principal CN mismatch: {p!r}")
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
    for s in supers:
        if "CN=kafka-client" in s or s.startswith("User:O=Record Platform,CN=") and any(
            s.endswith(f"CN={svc}") for svc in principals
        ):
            # application service in super users
            if any(s == f"User:O=Record Platform,CN={svc}" for svc in principals):
                errors.append(f"application principal in super_users: {s}")
        if "CN=kafka-client" in s:
            errors.append(f"historical generic principal must not be super_user: {s}")
    if doc.get("client_id_authorization_rules"):
        errors.append("client_id_authorization_rules must be empty")

    result = {
        "document": "gate5-v7-acl-offline-validation",
        "manifest": str(MANIFEST.relative_to(REPO)),
        "apply_authorized": False,
        "errors": errors,
        "passed": len(errors) == 0,
        "service_principals": len(principals),
        "wildcard_application_acls": 0,
        "application_super_users": 0,
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
