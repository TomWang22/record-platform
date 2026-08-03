#!/usr/bin/env python3
"""Gate 5 ACL helpers: expected TSV, expanded managed-universe compare, reconcile plans."""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

FIELDS = (
    "resource_type",
    "resource_name",
    "resource_pattern_type",
    "principal",
    "host",
    "operation",
    "permission_type",
)

FORBIDDEN_CLUSTER_OPS = {
    "CREATE",
    "DELETE",
    "ALTER",
    "ALTER_CONFIGS",
    "ALTERCONFIGS",
    "CLUSTER_ACTION",
}

RP_SERVICE_RE = re.compile(r"^User:O=Record Platform,CN=[A-Za-z0-9._-]+$")
CN_BEFORE_O_RE = re.compile(r"^User:CN=.+,O=")


def _canon(binding: dict[str, str]) -> tuple[str, ...]:
    return tuple(binding[f] for f in FIELDS)


def binding_key(b: dict[str, str]) -> str:
    return "|".join(_canon(b))


def normalize_op(op: str) -> str:
    return op.strip().upper().replace("-", "_")


def validate_binding(b: dict[str, str], *, context: str) -> None:
    for f in FIELDS:
        if f not in b or b[f] is None or str(b[f]).strip() == "":
            raise SystemExit(f"{context}: missing/empty field {f}")
    for f in FIELDS:
        if "\t" in b[f] or "\n" in b[f] or "\r" in b[f]:
            raise SystemExit(f"{context}: tab/newline forbidden in {f}")
    if b["resource_type"] not in {"TOPIC", "GROUP", "CLUSTER", "TRANSACTIONAL_ID", "DELEGATION_TOKEN"}:
        raise SystemExit(f"{context}: invalid resource_type {b['resource_type']}")
    if b["resource_pattern_type"] not in {"LITERAL", "PREFIXED"}:
        raise SystemExit(f"{context}: invalid resource_pattern_type {b['resource_pattern_type']}")
    if b["permission_type"] not in {"ALLOW", "DENY"}:
        raise SystemExit(f"{context}: invalid permission_type {b['permission_type']}")
    if not b["principal"].startswith("User:"):
        raise SystemExit(f"{context}: empty/invalid principal")
    if not b["host"]:
        raise SystemExit(f"{context}: malformed host")


def expected_from_manifest_raw(manifest: dict[str, Any]) -> list[dict[str, str]]:
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
            if nop in FORBIDDEN_CLUSTER_OPS or nop == "ALTERCONFIGS":
                raise SystemExit(f"forbidden cluster op in manifest: {nop}")
            rows.append(
                {
                    "resource_type": "CLUSTER",
                    "resource_name": "kafka-cluster",
                    "resource_pattern_type": "LITERAL",
                    "principal": principal,
                    "host": "*",
                    "operation": nop,
                    "permission_type": "ALLOW",
                }
            )
    for i, r in enumerate(rows):
        validate_binding(r, context=f"expected[{i}]")
    return rows


def expected_unique_or_fail(raw: list[dict[str, str]]) -> dict[str, Any]:
    keys = [binding_key(r) for r in raw]
    dupes = sorted({k for k in keys if keys.count(k) > 1})
    unique_map: dict[str, dict[str, str]] = {}
    for r in sorted(raw, key=_canon):
        unique_map[binding_key(r)] = r
    unique = list(unique_map.values())
    result = {
        "expected_rows_raw": len(raw),
        "expected_rows_unique": len(unique),
        "expected_duplicate_rows": len(dupes),
        "expected_duplicates": dupes[:50],
        "rows": unique,
    }
    if dupes:
        raise SystemExit(
            f"expected_duplicate_rows={len(dupes)} — contract defect; refuse silent dedupe"
        )
    return result


def to_tsv(rows: list[dict[str, str]]) -> str:
    lines = ["\t".join(FIELDS)]
    for r in rows:
        validate_binding(r, context="tsv")
        lines.append("\t".join(r[f] for f in FIELDS))
    return "\n".join(lines) + "\n"


def from_tsv(text: str) -> list[dict[str, str]]:
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return []
    header = lines[0].split("\t")
    if header != list(FIELDS):
        raise SystemExit(f"invalid TSV header: {header}")
    out: list[dict[str, str]] = []
    for i, ln in enumerate(lines[1:], start=2):
        cols = ln.split("\t")
        if len(cols) != len(FIELDS):
            raise SystemExit(f"TSV line {i}: expected {len(FIELDS)} columns got {len(cols)}")
        b = dict(zip(FIELDS, cols))
        validate_binding(b, context=f"tsv:{i}")
        out.append(b)
    return out


def application_principals(manifest: dict[str, Any]) -> set[str]:
    return {row["principal"] for row in (manifest.get("service_principals") or {}).values()}


def managed_topics_groups(manifest: dict[str, Any]) -> tuple[set[str], set[str]]:
    topics: set[str] = set()
    groups: set[str] = set()
    for row in (manifest.get("service_principals") or {}).values():
        for t in row.get("topic_acls") or []:
            topics.add(t["name"])
        for g in row.get("group_acls") or []:
            groups.add(g["name"])
    return topics, groups


def load_scope(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def excluded_principals(scope: dict[str, Any], measured: dict[str, Any] | None) -> set[str]:
    out: set[str] = set()
    for row in scope.get("excluded_principals_allowlist") or []:
        out.add(row["principal"])
    for p in scope.get("kafka_internal_system_principals") or []:
        out.add(p if isinstance(p, str) else p["principal"])
    if measured:
        out.add(measured["broker_server_leaf"]["kafka_acl_principal"])
        out.add(measured["recovery_admin"]["kafka_acl_principal"])
    return out


def is_managed_binding(
    b: dict[str, str],
    *,
    app: set[str],
    topics: set[str],
    groups: set[str],
    superseded: set[str],
    excluded: set[str],
) -> bool:
    principal = b.get("principal", "")
    if principal in excluded:
        return False
    if principal in app:
        return True
    if principal in superseded:
        return True
    if CN_BEFORE_O_RE.match(principal):
        return True
    if RP_SERVICE_RE.match(principal):
        return True
    rt = b.get("resource_type", "").upper()
    name = b.get("resource_name", "")
    if rt == "TOPIC" and name in topics:
        return True
    if rt == "GROUP" and name in groups:
        return True
    if rt == "CLUSTER" and principal.startswith("User:O=Record Platform,CN="):
        return True
    return False


def filter_managed(
    live: list[dict[str, str]],
    *,
    manifest: dict[str, Any],
    scope: dict[str, Any],
    measured: dict[str, Any] | None,
) -> list[dict[str, str]]:
    app = application_principals(manifest)
    topics, groups = managed_topics_groups(manifest)
    superseded = set(scope.get("superseded_principals") or [])
    excluded = excluded_principals(scope, measured)
    return [
        b
        for b in live
        if is_managed_binding(
            b, app=app, topics=topics, groups=groups, superseded=superseded, excluded=excluded
        )
    ]


def compare_sets(
    expected: list[dict[str, str]],
    actual_managed: list[dict[str, str]],
    *,
    live_all: list[dict[str, str]],
    manifest: dict[str, Any],
    scope: dict[str, Any],
    measured: dict[str, Any] | None,
) -> dict[str, Any]:
    app = application_principals(manifest)
    topics, groups = managed_topics_groups(manifest)
    superseded = set(scope.get("superseded_principals") or [])
    excluded = excluded_principals(scope, measured)

    exp_keys = [binding_key(b) for b in expected]
    act_keys = [binding_key(b) for b in actual_managed]
    exp_set = set(exp_keys)
    act_set = set(act_keys)
    duplicates = sorted({k for k in act_keys if act_keys.count(k) > 1})

    unexpected_deny = sorted(
        binding_key(b)
        for b in actual_managed
        if b.get("permission_type", "").upper() == "DENY"
    )
    wildcards = sorted(
        binding_key(b)
        for b in actual_managed
        if b.get("resource_name") == "*"
        or (
            b.get("resource_type") in {"TOPIC", "GROUP"}
            and b.get("resource_pattern_type", "").upper() == "PREFIXED"
            and b.get("resource_name") in {"", "*"}
        )
    )
    wrong_pattern = sorted(
        binding_key(b)
        for b in actual_managed
        if b.get("resource_pattern_type", "").upper() not in {"LITERAL", "PREFIXED"}
        or (
            binding_key(b) in exp_set
            and next(
                (
                    e
                    for e in expected
                    if binding_key(e) == binding_key(b)
                    and e["resource_pattern_type"] != b["resource_pattern_type"]
                ),
                None,
            )
        )
    )
    # Wrong host vs expected when key otherwise matches except host is already in unexpected.
    wrong_host: list[str] = []
    for b in actual_managed:
        if b.get("host") != "*":
            wrong_host.append(binding_key(b))
    wrong_host = sorted(set(wrong_host))

    cn_before_o = sorted(
        binding_key(b) for b in actual_managed if CN_BEFORE_O_RE.match(b.get("principal", ""))
    )
    superseded_hits = sorted(
        {b["principal"] for b in actual_managed if b.get("principal") in superseded}
    )
    unknown_principals = sorted(
        {
            b["principal"]
            for b in actual_managed
            if b["principal"] not in app
            and b["principal"] not in excluded
            and b["principal"] not in superseded
            and (
                RP_SERVICE_RE.match(b["principal"])
                or CN_BEFORE_O_RE.match(b["principal"])
                or b["principal"].startswith("User:")
            )
        }
    )
    # Managed resource with unexpected principal
    managed_resource_unknown = []
    for b in live_all:
        if b.get("principal") in excluded:
            continue
        rt = b.get("resource_type", "").upper()
        name = b.get("resource_name", "")
        on_managed = (rt == "TOPIC" and name in topics) or (rt == "GROUP" and name in groups)
        if on_managed and b.get("principal") not in app:
            managed_resource_unknown.append(binding_key(b))
    managed_resource_unknown = sorted(set(managed_resource_unknown))

    forbidden_cluster = sorted(
        binding_key(b)
        for b in actual_managed
        if b.get("resource_type") == "CLUSTER"
        and normalize_op(b.get("operation", "")) in FORBIDDEN_CLUSTER_OPS
        and b.get("principal") in app
    )

    missing = sorted(exp_set - act_set)
    unexpected = sorted(act_set - exp_set)

    delta = (
        len(missing)
        + len(unexpected)
        + len(duplicates)
        + len(unexpected_deny)
        + len(wildcards)
        + len(cn_before_o)
        + len(superseded_hits)
        + len(unknown_principals)
        + len(managed_resource_unknown)
        + len(forbidden_cluster)
        + len(wrong_pattern)
        + len(wrong_host)
    )
    passed = delta == 0 and len(exp_set) == len(set(act_keys))
    return {
        "expected_acl_rows": len(exp_set),
        "actual_managed_acl_rows": len(act_set),
        "actual_acl_rows": len(act_set),
        "raw_live_binding_count": len(live_all),
        "missing_acl_rows": len(missing),
        "unexpected_acl_rows": len(unexpected),
        "duplicate_acl_rows": len(duplicates),
        "unexpected_deny_rows": len(unexpected_deny),
        "wildcard_application_acl_rows": len(wildcards),
        "wrong_pattern_type_rows": len(wrong_pattern),
        "wrong_host_rows": len(wrong_host),
        "unknown_principal_rows": len(unknown_principals),
        "stale_principals": len(superseded_hits),
        "superseded_principals": superseded_hits,
        "managed_resource_unknown_principal_rows": len(managed_resource_unknown),
        "forbidden_cluster_operation_rows": len(forbidden_cluster),
        "cn_before_o_rows": len(cn_before_o),
        "unknown_principals": unknown_principals,
        "missing": missing[:100],
        "unexpected": unexpected[:100],
        "duplicates": duplicates[:50],
        "unexpected_deny": unexpected_deny[:50],
        "wildcards": wildcards[:50],
        "cn_before_o": cn_before_o[:50],
        "forbidden_cluster": forbidden_cluster[:50],
        "managed_resource_unknown": managed_resource_unknown[:50],
        "manifest_vs_live_delta": delta,
        "passed": passed,
    }


def reconcile_plan(
    expected: list[dict[str, str]],
    actual_managed: list[dict[str, str]],
) -> dict[str, Any]:
    exp_set = {binding_key(b): b for b in expected}
    act_set = {binding_key(b): b for b in actual_managed}
    to_create = [exp_set[k] for k in sorted(set(exp_set) - set(act_set))]
    to_delete = [act_set[k] for k in sorted(set(act_set) - set(exp_set))]
    plan = []
    for b in to_delete:
        plan.append(
            {
                "binding_key": binding_key(b),
                "action": "delete",
                "reason_for_removal": "unexpected_managed_binding",
                "principal_classification": "application_or_superseded_or_managed_resource",
                "resource_classification": b["resource_type"],
                "exact_delete_filter": b,
            }
        )
    for b in to_create:
        plan.append(
            {
                "binding_key": binding_key(b),
                "action": "create",
                "reason_for_removal": None,
                "principal_classification": "expected_application",
                "resource_classification": b["resource_type"],
                "exact_create_binding": b,
            }
        )
    return {
        "create_count": len(to_create),
        "delete_count": len(to_delete),
        "create": to_create,
        "delete": to_delete,
        "plan": plan,
    }


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(
            "usage: gate5-v7-acl-normalize.py <expected-json|expected-tsv|compare|reconcile-plan|hash> ...",
            file=sys.stderr,
        )
        return 2
    mode = argv[1]
    if mode == "expected-json":
        manifest = json.loads(Path(argv[2]).read_text(encoding="utf-8"))
        raw = expected_from_manifest_raw(manifest)
        meta = expected_unique_or_fail(raw)
        print(json.dumps({"meta": {k: meta[k] for k in meta if k != "rows"}, "rows": meta["rows"]}, indent=2))
        return 0
    if mode == "expected-tsv":
        manifest = json.loads(Path(argv[2]).read_text(encoding="utf-8"))
        raw = expected_from_manifest_raw(manifest)
        meta = expected_unique_or_fail(raw)
        sys.stdout.write(to_tsv(meta["rows"]))
        print(
            f"expected_rows_raw={meta['expected_rows_raw']} expected_rows_unique={meta['expected_rows_unique']} expected_duplicate_rows={meta['expected_duplicate_rows']}",
            file=sys.stderr,
        )
        return 0
    if mode == "compare":
        # compare <expected.json|tsv> <live.json> <manifest> <scope> [measured]
        expected_path = Path(argv[2])
        live = json.loads(Path(argv[3]).read_text(encoding="utf-8"))
        # live may be {"raw_bindings":[...], ...} or a bare list
        if isinstance(live, dict):
            live_all = live.get("raw_bindings") or live.get("bindings") or live.get("canonical_bindings") or []
        else:
            live_all = live
        manifest = json.loads(Path(argv[4]).read_text(encoding="utf-8"))
        scope = load_scope(Path(argv[5]))
        measured = json.loads(Path(argv[6]).read_text(encoding="utf-8")) if len(argv) > 6 else None
        text = expected_path.read_text(encoding="utf-8")
        if expected_path.suffix == ".tsv" or text.startswith("resource_type\t"):
            expected = from_tsv(text)
        else:
            body = json.loads(text)
            expected = body["rows"] if isinstance(body, dict) and "rows" in body else body
            raw = expected_from_manifest_raw(manifest) if False else expected
            # still enforce no dups in provided expected
            keys = [binding_key(r) for r in expected]
            if len(keys) != len(set(keys)):
                raise SystemExit("expected_duplicate_rows>0 in compare input")
        managed = filter_managed(live_all, manifest=manifest, scope=scope, measured=measured)
        result = compare_sets(
            expected, managed, live_all=live_all, manifest=manifest, scope=scope, measured=measured
        )
        print(json.dumps(result, indent=2))
        return 0 if result["passed"] else 1
    if mode == "reconcile-plan":
        expected_path = Path(argv[2])
        live = json.loads(Path(argv[3]).read_text(encoding="utf-8"))
        live_all = live.get("raw_bindings") if isinstance(live, dict) else live
        if isinstance(live, dict) and not live_all:
            live_all = live.get("canonical_bindings") or []
        manifest = json.loads(Path(argv[4]).read_text(encoding="utf-8"))
        scope = load_scope(Path(argv[5]))
        measured = json.loads(Path(argv[6]).read_text(encoding="utf-8")) if len(argv) > 6 else None
        text = expected_path.read_text(encoding="utf-8")
        expected = from_tsv(text) if expected_path.suffix == ".tsv" or text.startswith("resource_type\t") else (
            json.loads(text)["rows"] if isinstance(json.loads(text), dict) else json.loads(text)
        )
        managed = filter_managed(live_all, manifest=manifest, scope=scope, measured=measured)
        plan = reconcile_plan(expected, managed)
        print(json.dumps(plan, indent=2))
        return 0
    if mode == "hash":
        data = Path(argv[2]).read_bytes()
        print(sha256_bytes(data))
        return 0
    # backward-compat alias
    if mode == "expected":
        return main([argv[0], "expected-json", *argv[2:]])
    print(f"unknown mode {mode}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
