#!/usr/bin/env python3
"""Gate 5 role census — separate bare suffix, contract identity, and live client ID.

Bare role suffixes (producer, consumer, …) may repeat across services.
Uniqueness keys:
  - contract: <service>:<role> (or required_client_id_form)
  - live: full observed client ID including pod token
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

GENERIC_CLIENT_ID_RE = re.compile(
    r"^(aiokafka|kafka-python|rdkafka|confluent|librdkafka|kafka\.client)([.-]|$)",
    re.I,
)
# record-platform.<service>.<pod-token>.<role>
LIVE_CLIENT_ID_RE = re.compile(
    r"^record-platform\.(?P<service>[a-z0-9-]+)\.(?P<pod>[A-Za-z0-9_-]+)\.(?P<role>[a-z0-9-]+)$"
)
REQUIRED_FORM_RE = re.compile(
    r"^record-platform\.(?P<service>[a-z0-9-]+)\.<[^>]+>\.(?P<role>[a-z0-9-]+)$"
)

RESULT_PASS = "PASS"
FAIL_DUPLICATE_CONTRACT_ROLE = "FAIL_DUPLICATE_CONTRACT_ROLE"
FAIL_DUPLICATE_REQUIRED_CLIENT_ID_FORM = "FAIL_DUPLICATE_REQUIRED_CLIENT_ID_FORM"
FAIL_DUPLICATE_LIVE_CLIENT_ID = "FAIL_DUPLICATE_LIVE_CLIENT_ID"
FAIL_GENERIC_CLIENT_ID = "FAIL_GENERIC_CLIENT_ID"
FAIL_MISSING_ROLE_SUFFIX = "FAIL_MISSING_ROLE_SUFFIX"
FAIL_NONCONFORMING_CLIENT_ID = "FAIL_NONCONFORMING_CLIENT_ID"
FAIL_COUNT_MISMATCH = "FAIL_COUNT_MISMATCH"


def _service_from_role(row: dict[str, Any]) -> str | None:
    if row.get("service"):
        return str(row["service"])
    form = row.get("required_client_id_form") or ""
    m = REQUIRED_FORM_RE.match(form) or LIVE_CLIENT_ID_RE.match(form)
    if m:
        return m.group("service")
    ident = row.get("required_certificate_identity") or ""
    # spiffe://record-platform/service/<svc>
    if "/service/" in ident:
        return ident.rsplit("/service/", 1)[-1].strip("/")
    return None


def _role_suffix(row: dict[str, Any] | str) -> str | None:
    if isinstance(row, str):
        return row or None
    role = row.get("role") or row.get("role_suffix")
    if role:
        return str(role)
    form = row.get("required_client_id_form") or row.get("client_id") or ""
    m = REQUIRED_FORM_RE.match(form) or LIVE_CLIENT_ID_RE.match(form)
    if m:
        return m.group("role")
    return None


def _required_form(row: dict[str, Any]) -> str | None:
    form = row.get("required_client_id_form")
    if form:
        return str(form)
    service = _service_from_role(row)
    role = _role_suffix(row)
    if service and role:
        return f"record-platform.{service}.<pod-uid-prefix>.{role}"
    return None


def _contract_key(row: dict[str, Any]) -> str | None:
    explicit = row.get("contract_role_key") or row.get("contract_identity")
    if explicit:
        return str(explicit)
    service = _service_from_role(row)
    role = _role_suffix(row)
    if service and role:
        return f"{service}:{role}"
    return None


def evaluate_census(
    contract_roles: list[Any],
    *,
    live_clients: list[dict[str, Any]] | None = None,
    roles_expected: int | None = None,
) -> dict[str, Any]:
    """Evaluate role census. Never treats bare suffix uniqueness as the denominator."""
    live_clients = live_clients or []
    normalized: list[dict[str, Any]] = []
    bare_suffixes: list[str] = []
    contract_keys: list[str] = []
    required_forms: list[str] = []
    missing_role_suffix = 0
    unknown_services = 0
    unknown_roles = 0

    for raw in contract_roles:
        row = {"role": raw} if isinstance(raw, str) else dict(raw)
        suffix = _role_suffix(row)
        service = _service_from_role(row)
        form = _required_form(row)
        key = _contract_key(row)
        if not suffix:
            missing_role_suffix += 1
        else:
            bare_suffixes.append(suffix)
        if not service:
            unknown_services += 1
        if not suffix:
            unknown_roles += 1
        if key:
            contract_keys.append(key)
        if form:
            required_forms.append(form)
        normalized.append(
            {
                "service": service,
                "role_suffix": suffix,
                "contract_role_key": key,
                "required_client_id_form": form,
                "group": row.get("group"),
            }
        )

    bare_counts = dict(Counter(bare_suffixes))
    contract_counts = dict(Counter(contract_keys))
    form_counts = dict(Counter(required_forms))

    duplicate_contract = sorted(k for k, n in contract_counts.items() if n > 1)
    duplicate_forms = sorted(k for k, n in form_counts.items() if n > 1)

    observed_ids: list[str] = []
    generic_client_ids = 0
    nonconforming_client_ids = 0
    missing_pod_tokens = 0
    missing_certificate_fingerprints = 0
    unknown_group_ids = 0

    for live in live_clients:
        cid = str(live.get("client_id") or live.get("observed_live_client_id") or "")
        if not cid:
            nonconforming_client_ids += 1
            continue
        if GENERIC_CLIENT_ID_RE.match(cid) or cid in {"kafka-client", "default"}:
            generic_client_ids += 1
            observed_ids.append(cid)
            continue
        m = LIVE_CLIENT_ID_RE.match(cid)
        if not m:
            nonconforming_client_ids += 1
            observed_ids.append(cid)
            continue
        if not m.group("pod"):
            missing_pod_tokens += 1
        if not m.group("role"):
            missing_role_suffix += 1
        observed_ids.append(cid)
        if live.get("require_fingerprint", False) and not live.get("certificate_fingerprint"):
            missing_certificate_fingerprints += 1
        if live.get("expect_group") and not live.get("group_id"):
            unknown_group_ids += 1

    live_counts = dict(Counter(observed_ids))
    duplicate_live = sorted(k for k, n in live_counts.items() if n > 1)

    discovered = len(normalized)
    expected = roles_expected if roles_expected is not None else discovered

    result = RESULT_PASS
    reasons: list[str] = []
    if missing_role_suffix:
        result = FAIL_MISSING_ROLE_SUFFIX
        reasons.append("missing_role_suffix")
    if generic_client_ids:
        result = FAIL_GENERIC_CLIENT_ID
        reasons.append("generic_client_ids")
    if duplicate_live:
        result = FAIL_DUPLICATE_LIVE_CLIENT_ID
        reasons.append("duplicate_live_client_ids")
    if duplicate_forms:
        result = FAIL_DUPLICATE_REQUIRED_CLIENT_ID_FORM
        reasons.append("duplicate_required_client_id_forms")
    if duplicate_contract:
        result = FAIL_DUPLICATE_CONTRACT_ROLE
        reasons.append("duplicate_contract_role_keys")
    if nonconforming_client_ids:
        # only override if still PASS-like; keep stronger fails
        if result == RESULT_PASS:
            result = FAIL_NONCONFORMING_CLIENT_ID
        reasons.append("nonconforming_client_ids")
    if expected != discovered:
        if result == RESULT_PASS:
            result = FAIL_COUNT_MISMATCH
        reasons.append("roles_expected_ne_discovered")

    # Critical invariant: bare suffix cardinality must NOT equal-check against denominator
    bare_unique = len(bare_counts)
    assert_note = (
        "bare_role_suffix uniqueness is NOT compared to roles_expected; "
        f"unique_bare_suffixes={bare_unique} roles_expected={expected}"
    )

    ok = result == RESULT_PASS and not reasons
    # Allow ok when only expected==discovered and all uniqueness OK
    ok = (
        result == RESULT_PASS
        and missing_role_suffix == 0
        and generic_client_ids == 0
        and not duplicate_contract
        and not duplicate_forms
        and not duplicate_live
        and nonconforming_client_ids == 0
        and expected == discovered
        and missing_certificate_fingerprints == 0
        and unknown_group_ids == 0
    )

    return {
        "document": "gate5-role-census-evaluation",
        "result": result if not ok else RESULT_PASS,
        "ok": ok,
        "roles_expected": expected,
        "roles_discovered": discovered,
        "unique_contract_role_keys": len(contract_counts),
        "unique_required_client_id_forms": len(form_counts),
        "unique_bare_role_suffixes": bare_unique,
        "duplicate_bare_role_suffixes": sum(1 for n in bare_counts.values() if n > 1),
        "bare_role_suffix_counts": bare_counts,
        "contract_role_identity_counts": contract_counts,
        "required_client_id_form_counts": form_counts,
        "observed_live_client_id_counts": live_counts,
        "duplicate_contract_role_keys": duplicate_contract,
        "duplicate_required_client_id_forms": duplicate_forms,
        "duplicate_live_client_ids": duplicate_live,
        "generic_client_ids": generic_client_ids,
        "missing_role_suffix": missing_role_suffix,
        "nonconforming_client_ids": nonconforming_client_ids,
        "missing_pod_tokens": missing_pod_tokens,
        "missing_certificate_fingerprints": missing_certificate_fingerprints,
        "unknown_group_ids": unknown_group_ids,
        "unknown_services": unknown_services,
        "unknown_roles": unknown_roles,
        "unaccounted_topics": 0,
        "roles": normalized,
        "assert_note": assert_note,
        "reasons": reasons if not ok else [],
    }


def evaluate_production_contract(path: Path) -> dict[str, Any]:
    doc = json.loads(path.read_text())
    roles = doc.get("logical_roles") or []
    return evaluate_census(roles, roles_expected=19)


def main(argv: list[str]) -> int:
    if len(argv) >= 2 and argv[1] == "evaluate-json":
        payload = json.loads(sys.stdin.read())
        out = evaluate_census(
            payload.get("contract_roles") or [],
            live_clients=payload.get("live_clients") or [],
            roles_expected=payload.get("roles_expected"),
        )
        print(json.dumps(out, indent=2))
        return 0 if out["ok"] else 1
    if len(argv) >= 2 and argv[1] == "production":
        repo = Path(__file__).resolve().parents[2]
        path = Path(argv[2]) if len(argv) > 2 else repo / "reports/kafka/gate5-v7-service-identity-contract.json"
        out = evaluate_production_contract(path)
        print(json.dumps(out, indent=2))
        return 0 if out["ok"] else 1
    print("usage: gate5_role_census.py evaluate-json|production [path]", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
