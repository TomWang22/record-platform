#!/usr/bin/env python3
"""Gate 5 v7 ACL set helpers: expected bindings from manifest + exact compare."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def _canon(binding: dict[str, str]) -> tuple[str, ...]:
    return (
        binding["resource_type"],
        binding["resource_name"],
        binding["resource_pattern_type"],
        binding["principal"],
        binding["host"],
        binding["operation"],
        binding["permission_type"],
    )


def binding_key(b: dict[str, str]) -> str:
    return "|".join(_canon(b))


def normalize_op(op: str) -> str:
    return op.strip().upper().replace("-", "_")


def expected_from_manifest(manifest: dict[str, Any]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for svc, row in (manifest.get("service_principals") or {}).items():
        principal = row["principal"]
        if row.get("super_user") is True:
            raise SystemExit(f"application super_user forbidden: {svc}")
        if principal.startswith("User:CN="):
            raise SystemExit(f"CN-before-O principal forbidden: {principal}")
        for t in row.get("topic_acls") or []:
            name = t["name"]
            if name in {"*", "kafka-cluster"}:
                raise SystemExit(f"wildcard topic forbidden: {name}")
            for op in t.get("operations") or []:
                rows.append(
                    {
                        "resource_type": "TOPIC",
                        "resource_name": name,
                        "resource_pattern_type": "LITERAL",
                        "principal": principal,
                        "host": "*",
                        "operation": normalize_op(op),
                        "permission_type": "ALLOW",
                    }
                )
        for g in row.get("group_acls") or []:
            name = g["name"]
            if name in {"*", "kafka-cluster"}:
                raise SystemExit(f"wildcard group forbidden: {name}")
            for op in g.get("operations") or []:
                rows.append(
                    {
                        "resource_type": "GROUP",
                        "resource_name": name,
                        "resource_pattern_type": "LITERAL",
                        "principal": principal,
                        "host": "*",
                        "operation": normalize_op(op),
                        "permission_type": "ALLOW",
                    }
                )
        for op in row.get("cluster_operations") or []:
            nop = normalize_op(op)
            if nop in {"CREATE", "DELETE", "ALTER", "ALTER_CONFIGS", "ALTERCONFIGS", "CLUSTER_ACTION"}:
                raise SystemExit(f"forbidden cluster op in manifest: {nop}")
            rows.append(
                {
                    "resource_type": "CLUSTER",
                    "resource_name": "kafka-cluster",
                    "resource_pattern_type": "LITERAL",
                    "principal": principal,
                    "host": "*",
                    "operation": nop if nop != "ALTERCONFIGS" else "ALTER_CONFIGS",
                    "permission_type": "ALLOW",
                }
            )
    # Deduplicate while preserving determinism
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for r in sorted(rows, key=_canon):
        k = binding_key(r)
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
    return out


def application_principals(manifest: dict[str, Any]) -> set[str]:
    return {row["principal"] for row in (manifest.get("service_principals") or {}).values()}


def filter_application_bindings(
    live: list[dict[str, str]], app_principals: set[str]
) -> list[dict[str, str]]:
    return [b for b in live if b.get("principal") in app_principals]


def compare_sets(
    expected: list[dict[str, str]],
    actual_app: list[dict[str, str]],
) -> dict[str, Any]:
    exp_keys = [binding_key(b) for b in expected]
    act_keys = [binding_key(b) for b in actual_app]
    exp_set = set(exp_keys)
    act_set = set(act_keys)
    duplicates = sorted({k for k in act_keys if act_keys.count(k) > 1})
    unexpected_deny = sorted(
        binding_key(b)
        for b in actual_app
        if b.get("permission_type", "").upper() == "DENY"
    )
    wildcards = sorted(
        binding_key(b)
        for b in actual_app
        if b.get("resource_name") == "*"
        or (
            b.get("resource_type") in {"TOPIC", "GROUP"}
            and b.get("resource_pattern_type", "").upper() == "PREFIXED"
            and b.get("resource_name") == ""
        )
        or (b.get("resource_type") in {"TOPIC", "GROUP"} and b.get("resource_name") == "*")
    )
    cn_before_o = sorted(
        binding_key(b) for b in actual_app if str(b.get("principal", "")).startswith("User:CN=")
    )
    missing = sorted(exp_set - act_set)
    unexpected = sorted(act_set - exp_set)
    return {
        "expected_acl_rows": len(exp_set),
        "actual_acl_rows": len(act_set),
        "missing_acl_rows": len(missing),
        "unexpected_acl_rows": len(unexpected),
        "duplicate_acl_rows": len(duplicates),
        "unexpected_deny_rows": len(unexpected_deny),
        "wildcard_application_acl_rows": len(wildcards),
        "cn_before_o_rows": len(cn_before_o),
        "missing": missing[:100],
        "unexpected": unexpected[:100],
        "duplicates": duplicates[:50],
        "unexpected_deny": unexpected_deny[:50],
        "wildcards": wildcards[:50],
        "cn_before_o": cn_before_o[:50],
        "manifest_vs_live_delta": len(missing) + len(unexpected) + len(duplicates)
        + len(unexpected_deny)
        + len(wildcards)
        + len(cn_before_o),
        "passed": (
            len(missing) == 0
            and len(unexpected) == 0
            and len(duplicates) == 0
            and len(unexpected_deny) == 0
            and len(wildcards) == 0
            and len(cn_before_o) == 0
            and len(exp_set) == len(act_set)
        ),
    }


def kafka_acls_remove_cmds(bindings: list[dict[str, str]]) -> list[str]:
    cmds: list[str] = []
    for b in bindings:
        op = b["operation"]
        # kafka-acls CLI uses title case ops commonly
        cli_op = op.title().replace("_", "")
        if op == "IDEMPOTENT_WRITE":
            cli_op = "IdempotentWrite"
        elif op == "ALTER_CONFIGS":
            cli_op = "AlterConfigs"
        principal = b["principal"]
        host = b.get("host") or "*"
        base = (
            f'kafka-acls --bootstrap-server "$BOOT" --command-config /tmp/admin.props '
            f'--remove --force --allow-principal "{principal}" --operation {cli_op} '
            f'--allow-host "{host}"'
        )
        rt = b["resource_type"].upper()
        name = b["resource_name"]
        if rt == "TOPIC":
            cmds.append(f'{base} --topic "{name}"')
        elif rt == "GROUP":
            cmds.append(f'{base} --group "{name}"')
        elif rt == "CLUSTER":
            cmds.append(f"{base} --cluster")
        else:
            raise SystemExit(f"unsupported resource_type for prune: {rt}")
    return cmds


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: gate5-v7-acl-normalize.py <expected|compare|prune-cmds> ...", file=sys.stderr)
        return 2
    mode = argv[1]
    if mode == "expected":
        manifest = json.loads(Path(argv[2]).read_text(encoding="utf-8"))
        rows = expected_from_manifest(manifest)
        print(json.dumps(rows, indent=2))
        return 0
    if mode == "compare":
        expected = json.loads(Path(argv[2]).read_text(encoding="utf-8"))
        live = json.loads(Path(argv[3]).read_text(encoding="utf-8"))
        manifest = json.loads(Path(argv[4]).read_text(encoding="utf-8"))
        app = application_principals(manifest)
        actual_app = filter_application_bindings(live, app)
        result = compare_sets(expected, actual_app)
        result["unknown_principals"] = sorted(
            {
                b["principal"]
                for b in live
                if b.get("principal", "").startswith("User:O=Record Platform,CN=")
                and b["principal"] not in app
                and "gate5-v7-admin" not in b["principal"]
            }
        )
        result["unknown_principals_count"] = len(result["unknown_principals"])
        if result["unknown_principals_count"]:
            result["passed"] = False
            result["manifest_vs_live_delta"] += result["unknown_principals_count"]
        print(json.dumps(result, indent=2))
        return 0 if result["passed"] else 1
    if mode == "prune-cmds":
        expected = json.loads(Path(argv[2]).read_text(encoding="utf-8"))
        live = json.loads(Path(argv[3]).read_text(encoding="utf-8"))
        manifest = json.loads(Path(argv[4]).read_text(encoding="utf-8"))
        app = application_principals(manifest)
        actual_app = filter_application_bindings(live, app)
        exp_set = {binding_key(b) for b in expected}
        unexpected = [b for b in actual_app if binding_key(b) not in exp_set]
        for line in kafka_acls_remove_cmds(unexpected):
            print(line)
        return 0
    print(f"unknown mode {mode}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
