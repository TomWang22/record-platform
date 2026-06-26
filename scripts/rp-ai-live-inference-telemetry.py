#!/usr/bin/env python3
"""T20.13E — Live inference telemetry parser and aggregator (read-only)."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

FORBIDDEN = re.compile(
    r"demo|mock|sample fallback|placeholder|lorem ipsum|proxy max|max_bid_cents|proxy_bids|OCH|off[- ]campus",
    re.I,
)
MESSAGE_LEAK = re.compile(r"message_body|thread_text|private obo message", re.I)


def normalize_path(path: str | Path) -> Path:
    if isinstance(path, Path):
        return path
    return Path(str(path))


def safe_get(obj: Any, *dotted_paths: str, default: Any = "not_exposed") -> Any:
    for dotted in dotted_paths:
        cur: Any = obj
        ok = True
        for part in dotted.split("."):
            if isinstance(cur, dict):
                cur = cur.get(part)
            elif isinstance(cur, list):
                try:
                    idx = int(part)
                    cur = cur[idx]
                except (ValueError, IndexError, TypeError):
                    ok = False
                    break
            else:
                ok = False
                break
            if cur is None:
                ok = False
                break
        if ok and cur is not None:
            return cur
    return default


def _as_int(val: Any) -> int | None:
    if val is None or val == "not_exposed":
        return None
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


def leakage_check(text: str, source_types: list[str]) -> str:
    if "message" in source_types:
        return "FAIL_message_source_type"
    if MESSAGE_LEAK.search(text):
        return "FAIL_message_leak"
    if FORBIDDEN.search(text):
        return "FAIL_forbidden"
    return "PASS"


def classify_failure(row: dict[str, Any]) -> str:
    if row.get("failure_class") == "embed_warmup_failed":
        return "embed_warmup_failed"
    if row.get("request_error"):
        return "request_error"
    if row.get("malformed_response"):
        return "malformed_response"
    embed_limit = _as_int(row.get("embed_timeout_ms")) or 5000
    if row.get("timed_out") or row.get("timeout_status") == "embed_timeout":
        sel = _as_int(row.get("shadow_selected_count"))
        if sel == 0:
            return "embed_timeout_before_fetch"
    sel = _as_int(row.get("shadow_selected_count"))
    if sel == 0 and row.get("mode", "").startswith("shadow"):
        cf = _as_int(row.get("candidate_fetch_ms"))
        embed = _as_int(row.get("embed_ms"))
        if embed is not None and embed >= embed_limit:
            return "embed_timeout_before_fetch"
        if cf == 0 and (embed is None or embed > 0):
            return "embed_timeout_before_fetch"
        if cf is not None and cf > 0:
            return "candidate_fetch_returned_zero"
        return "unknown"
    if sel is not None and sel > 0:
        return "not_zero_result"
    if row.get("mode") == "keyword" or row.get("mode") == "endpoint":
        if row.get("http_status") in (0, None) or row.get("malformed_response"):
            return "request_error"
        return "not_zero_result"
    return "unknown"


def parse_case(raw_json_path: str | Path) -> dict[str, Any]:
    path = normalize_path(raw_json_path)
    row: dict[str, Any] = {
        "file": path.name,
        "case_id": path.stem,
        "prompt": "not_exposed",
        "mode": "unknown",
        "profile": "not_exposed",
        "http_status": 0,
        "retrieval_mode": "not_exposed",
        "model_used": "not_exposed",
        "provider": "not_exposed",
        "summary": "",
        "answer_excerpt": "",
        "source_types": [],
        "refs_count": 0,
        "shadow_selected_count": "not_exposed",
        "chunk_overlap": "not_exposed",
        "document_overlap": "not_exposed",
        "entity_overlap": "not_exposed",
        "zero_overlap_reason": "not_exposed",
        "embed_ms": "not_exposed",
        "candidate_fetch_ms": "not_exposed",
        "rerank_select_ms": "not_exposed",
        "shadow_total_ms": "not_exposed",
        "latency_ms": "not_exposed",
        "request_error": False,
        "timed_out": False,
        "malformed_response": False,
        "leakage": "not_exposed",
        "entity_boosted_rows": "not_exposed",
        "neighbor_rows_added": "not_exposed",
        "timeout_status": "not_exposed",
        "failure_class": "unknown",
    }

    try:
        payload = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        row["malformed_response"] = True
        row["failure_class"] = "malformed_response"
        row["summary"] = str(exc)[:200]
        return row

    if not isinstance(payload, dict):
        row["malformed_response"] = True
        row["failure_class"] = "malformed_response"
        return row

    req = payload.get("request") if isinstance(payload.get("request"), dict) else {}
    row["prompt"] = safe_get(req, "question", default=safe_get(payload, "prompt", default="not_exposed"))
    row["http_status"] = payload.get("http_status", 0)
    row["latency_ms"] = payload.get("latency_ms", "not_exposed")

    label = safe_get(req, "label", default="")
    if label and label != "not_exposed":
        row["case_id"] = str(label)

    fname = path.name
    if fname.startswith("keyword-"):
        row["mode"] = "keyword"
    elif fname.startswith("shadow-off-"):
        row["mode"] = "shadow_off"
    elif fname.startswith("flagged-"):
        row["mode"] = "shadow_on"
    elif fname.startswith("endpoint-"):
        row["mode"] = "endpoint"

    resp = payload.get("response")
    if resp is None:
        row["request_error"] = True
        row["failure_class"] = "request_error"
        return row
    if not isinstance(resp, dict):
        row["malformed_response"] = True
        row["failure_class"] = "malformed_response"
        return row

    if resp.get("error") or resp.get("parse_error"):
        if resp.get("error") == "embed_warmup_failed" or req.get("embed_warmup_failed"):
            row["failure_class"] = "embed_warmup_failed"
            row["mode"] = row["mode"] if row["mode"] != "unknown" else "shadow_off"
            return row
        row["request_error"] = True

    details = resp.get("details") if isinstance(resp.get("details"), dict) else {}
    refs = resp.get("source_refs") if isinstance(resp.get("source_refs"), list) else []
    types = sorted({r.get("source_type") for r in refs if isinstance(r, dict) and r.get("source_type")})

    row["retrieval_mode"] = details.get("retrieval_mode", "not_exposed")
    row["model_used"] = resp.get("model_used", "not_exposed")
    row["summary"] = str(resp.get("summary") or "")
    row["source_types"] = types
    row["refs_count"] = len(refs)

    excerpt = ""
    excerpts = details.get("excerpts") if isinstance(details.get("excerpts"), list) else []
    if excerpts:
        excerpt = str(excerpts[0])[:200]
    row["answer_excerpt"] = excerpt

    blob = json.dumps(resp)
    row["leakage"] = leakage_check(blob, types)

    sv = details.get("shadow_vector") if isinstance(details.get("shadow_vector"), dict) else {}
    sd = details.get("shadow_diagnostics") if isinstance(details.get("shadow_diagnostics"), dict) else {}
    dbg = sd.get("debug") if isinstance(sd.get("debug"), dict) else {}
    ov = sd.get("overlap") if isinstance(sd.get("overlap"), dict) else {}
    ov_expl = ov.get("explanation") if isinstance(ov.get("explanation"), dict) else {}
    sv_expl = sv.get("overlap_explanation") if isinstance(sv.get("overlap_explanation"), dict) else {}
    timings = sd.get("timings_ms") if isinstance(sd.get("timings_ms"), dict) else (
        sv.get("timings_ms") if isinstance(sv.get("timings_ms"), dict) else {}
    )
    embed_diag = sd.get("embed") if isinstance(sd.get("embed"), dict) else {}

    row["profile"] = safe_get(
        sd, "profile", default=safe_get(req, "profile", default=safe_get(sv, "profile", default="not_exposed")),
    )
    row["shadow_selected_count"] = safe_get(
        sd, "counts.selected_count", default=safe_get(sv, "selected_count", default="not_exposed"),
    )
    row["chunk_overlap"] = safe_get(
        ov, "count", default=safe_get(ov_expl, "chunk_overlap_count", default=safe_get(sv, "overlap_count", default="not_exposed")),
    )
    row["document_overlap"] = safe_get(
        ov, "document_overlap_count", default=safe_get(ov_expl, "document_overlap_count", default="not_exposed"),
    )
    row["entity_overlap"] = safe_get(
        ov, "entity_overlap_count", default=safe_get(ov_expl, "entity_overlap_count", default="not_exposed"),
    )
    row["zero_overlap_reason"] = safe_get(ov_expl, "zero_overlap_reason", default="not_exposed")
    row["embed_ms"] = safe_get(timings, "embed", default=safe_get(embed_diag, "latency_ms", default="not_exposed"))
    row["candidate_fetch_ms"] = safe_get(timings, "candidate_fetch", default="not_exposed")
    row["rerank_select_ms"] = safe_get(timings, "rerank_select", default="not_exposed")
    row["shadow_total_ms"] = safe_get(timings, "total", default=safe_get(sv, "latency_ms", default="not_exposed"))
    row["entity_boosted_rows"] = dbg.get("entity_boosted_rows", "not_exposed")
    row["neighbor_rows_added"] = dbg.get("neighbor_rows_added", "not_exposed")

    timed_out = bool(
        sv.get("status") == "embed_timed_out"
        or embed_diag.get("timed_out")
        or row.get("timeout_status") == "embed_timeout"
    )
    row["timed_out"] = timed_out
    row["timeout_status"] = "embed_timeout" if timed_out else "ok"
    row["provider"] = embed_diag.get("provider", "not_exposed")

    if row["http_status"] in (0, None) and row["mode"].startswith("shadow"):
        row["request_error"] = True

    row["failure_class"] = classify_failure(row)

    cf = _as_int(row.get("candidate_fetch_ms"))
    sel = _as_int(row.get("shadow_selected_count"))
    row["shadow_fetch_attempted"] = bool(
        (cf is not None and cf > 0) or (sel is not None and sel > 0)
    )
    row["embed_retry_attempted"] = bool(req.get("embed_retry_attempted"))
    row["embed_retry_succeeded"] = bool(req.get("embed_retry_succeeded"))
    harness_timeout = _as_int(req.get("embed_timeout_ms"))
    row["embed_timeout_ms"] = harness_timeout if harness_timeout is not None else safe_get(
        embed_diag, "timeout_ms", default="not_exposed",
    )
    return row


def analyze(path: str | Path) -> dict[str, Any]:
    return parse_case(path)


def percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    idx = max(0, min(len(ordered) - 1, int(round((pct / 100.0) * (len(ordered) - 1)))))
    return ordered[idx]


def _numeric_ms(row: dict[str, Any], key: str) -> float | None:
    val = row.get(key)
    if val is None or val == "not_exposed":
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def overlap_stats(rows: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(rows)
    chunk_gt0 = doc_gt0 = entity_gt0 = 0
    for r in rows:
        for field, counter in (
            ("chunk_overlap", "chunk"),
            ("document_overlap", "doc"),
            ("entity_overlap", "entity"),
        ):
            val = _as_int(r.get(field))
            if val is not None and val > 0:
                if counter == "chunk":
                    chunk_gt0 += 1
                elif counter == "doc":
                    doc_gt0 += 1
                else:
                    entity_gt0 += 1
    return {
        "cases": total,
        "chunk_overlap_gt0": chunk_gt0,
        "document_overlap_gt0": doc_gt0,
        "entity_overlap_gt0": entity_gt0,
    }


def mode_stats(rows: list[dict[str, Any]]) -> dict[str, Any]:
    request_errors = sum(1 for r in rows if r.get("failure_class") == "request_error")
    embed_timeouts = sum(
        1 for r in rows if r.get("failure_class") == "embed_timeout_before_fetch"
    )
    warmup_failed = sum(1 for r in rows if r.get("failure_class") == "embed_warmup_failed")
    true_zero = sum(
        1 for r in rows
        if r.get("failure_class") in ("candidate_fetch_returned_zero", "privacy_filter_removed_all", "rerank_filtered_all")
    )
    shadow_ms = [_numeric_ms(r, "shadow_total_ms") for r in rows]
    cf_ms = [_numeric_ms(r, "candidate_fetch_ms") for r in rows]
    shadow_ms = [v for v in shadow_ms if v is not None]
    cf_ms = [v for v in cf_ms if v is not None]
    ov = overlap_stats(rows)
    entity_boosted = sum(
        1 for r in rows if isinstance(r.get("entity_boosted_rows"), int) and r["entity_boosted_rows"] > 0
    )
    neighbor_added = sum(
        1 for r in rows if isinstance(r.get("neighbor_rows_added"), int) and r["neighbor_rows_added"] > 0
    )
    fetch_attempted = sum(1 for r in rows if r.get("shadow_fetch_attempted"))
    return {
        **ov,
        "request_errors": request_errors,
        "embed_timeouts": embed_timeouts,
        "embed_timeout_before_fetch": embed_timeouts,
        "embed_warmup_failed": warmup_failed,
        "true_zero_results": true_zero,
        "shadow_fetch_attempted": fetch_attempted,
        "shadow_p50_ms": percentile(shadow_ms, 50),
        "shadow_p95_ms": percentile(shadow_ms, 95),
        "candidate_fetch_p50_ms": percentile(cf_ms, 50),
        "candidate_fetch_p95_ms": percentile(cf_ms, 95),
        "entity_boosted_rows_gt0": entity_boosted,
        "neighbor_rows_added_gt0": neighbor_added,
    }


def build_summary(
    *,
    report_md: Path,
    summary_json: Path,
    raw_dir: Path,
    sha: str,
    keyword_rows: list[dict[str, Any]],
    shadow_off_rows: list[dict[str, Any]],
    shadow_on_rows: list[dict[str, Any]],
    endpoint_rows: list[dict[str, Any]],
    flags_after: dict[str, str],
    leakage_fail: bool,
    warmup_stats: dict[str, Any] | None = None,
) -> dict[str, Any]:
    kw_lat = [float(r["latency_ms"]) for r in keyword_rows if isinstance(r.get("latency_ms"), (int, float))]
    all_types: set[str] = set()
    for r in keyword_rows:
        all_types.update(r.get("source_types") or [])

    ep_total = len([e for e in endpoint_rows if not e.get("skipped")])
    ep_nonempty = sum(1 for e in endpoint_rows if e.get("summary") and not e.get("skipped"))
    ep_degraded = sum(
        1 for e in endpoint_rows
        if not e.get("skipped") and (e.get("http_status") not in (200, 201) or not e.get("summary"))
    )

    summary = {
        "ticket": "T20.13E",
        "baseline_sha": sha,
        "report_md": str(report_md),
        "summary_json": str(summary_json),
        "raw_dir": str(raw_dir),
        "embed_warmup": warmup_stats or {},
        "production_keyword": {
            "cases": len(keyword_rows),
            "non_empty": sum(1 for r in keyword_rows if r.get("summary")),
            "model_used": keyword_rows[0].get("model_used") if keyword_rows else "n/a",
            "source_types": sorted(all_types),
            "latency_p50_ms": percentile(kw_lat, 50),
            "latency_p95_ms": percentile(kw_lat, 95),
            "leakage": "FAIL" if leakage_fail else "PASS",
        },
        "shadow_flags_off": mode_stats(shadow_off_rows),
        "shadow_flags_on": mode_stats(shadow_on_rows),
        "structured_endpoints": {
            "endpoints": len(endpoint_rows),
            "non_empty": ep_nonempty,
            "degraded": ep_degraded,
            "missing_404": sum(1 for e in endpoint_rows if e.get("http_status") in (0, 404)),
        },
        "flags_after": flags_after,
        "verdict": {
            "vector_rollout": "NOT APPROVED",
            "phase_21": "not started",
            "production_retrieval": "keyword",
        },
    }
    return summary


def print_console_summary(summary: dict[str, Any], excerpts: list[tuple[str, str]]) -> None:
    print("Live inference telemetry complete")
    print()
    print(f"Report:\n  {summary['report_md']}")
    print(f"Summary JSON:\n  {summary['summary_json']}")
    print(f"Raw JSON dir:\n  {summary['raw_dir']}")
    print()
    wu = summary.get("embed_warmup") or {}
    if wu:
        print("Embed warmup:")
        print(f"- enabled: {wu.get('embed_warmup_enabled')}")
        print(f"- passed: {wu.get('embed_warmup_passed')}")
        print(f"- runs requested/passed: {wu.get('embed_warmup_runs_requested')} / {wu.get('embed_warmup_runs_passed')}")
        print(f"- threshold_ms: {wu.get('embed_warmup_threshold_ms')}")
        print(f"- p50/p95 ms: {wu.get('embed_warmup_p50_ms')} / {wu.get('embed_warmup_p95_ms')}")
        print(f"- retry on timeout: {wu.get('embed_retry_on_timeout')}")
        print(f"- retry attempted/succeeded: {wu.get('embed_retry_attempted')} / {wu.get('embed_retry_succeeded')}")
        print()
    pk = summary["production_keyword"]
    print("Production keyword:")
    print(f"- cases: {pk['cases']}")
    print(f"- non-empty: {pk['non_empty']}")
    print(f"- model_used: {pk['model_used']}")
    print(f"- source types: {pk['source_types']}")
    print(f"- latency p50/p95: {pk['latency_p50_ms']} / {pk['latency_p95_ms']} ms")
    print(f"- leakage: {pk['leakage']}")
    print()
    so = summary["shadow_flags_off"]
    print("Shadow flags off:")
    print(f"- cases: {so['cases']}")
    print(f"- request_errors: {so['request_errors']}")
    print(f"- embed_timeouts: {so['embed_timeouts']}")
    print(f"- embed_timeout_before_fetch: {so.get('embed_timeout_before_fetch', so['embed_timeouts'])}")
    print(f"- true zero-results: {so['true_zero_results']}")
    print(f"- shadow_fetch_attempted: {so.get('shadow_fetch_attempted', 0)}")
    print(f"- chunk/doc/entity overlap: {so['chunk_overlap_gt0']}/{so['document_overlap_gt0']}/{so['entity_overlap_gt0']}")
    print(f"- shadow p50/p95: {so['shadow_p50_ms']} / {so['shadow_p95_ms']} ms")
    print(f"- candidate_fetch p50/p95: {so['candidate_fetch_p50_ms']} / {so['candidate_fetch_p95_ms']} ms")
    print()
    sn = summary["shadow_flags_on"]
    print("Shadow flags on:")
    print(f"- cases: {sn['cases']}")
    print(f"- request_errors: {sn['request_errors']}")
    print(f"- embed_timeouts: {sn['embed_timeouts']}")
    print(f"- embed_timeout_before_fetch: {sn.get('embed_timeout_before_fetch', sn['embed_timeouts'])}")
    print(f"- true zero-results: {sn['true_zero_results']}")
    print(f"- shadow_fetch_attempted: {sn.get('shadow_fetch_attempted', 0)}")
    print(f"- chunk/doc/entity overlap: {sn['chunk_overlap_gt0']}/{sn['document_overlap_gt0']}/{sn['entity_overlap_gt0']}")
    print(f"- shadow p50/p95: {sn['shadow_p50_ms']} / {sn['shadow_p95_ms']} ms")
    print(f"- candidate_fetch p50/p95: {sn['candidate_fetch_p50_ms']} / {sn['candidate_fetch_p95_ms']} ms")
    print(f"- entity_boosted rows: {sn['entity_boosted_rows_gt0']}")
    print(f"- neighbor rows added: {sn['neighbor_rows_added_gt0']}")
    print()
    se = summary["structured_endpoints"]
    print("Structured endpoints:")
    print(f"- endpoints: {se['endpoints']}")
    print(f"- non-empty: {se['non_empty']}")
    print(f"- degraded: {se['degraded']}")
    print(f"- missing/404: {se['missing_404']}")
    print()
    print("Sanitized excerpts:")
    for idx, (label, text) in enumerate(excerpts, 1):
        print(f"{idx}. {label}:")
        print(f"   {text[:160]}")
    print()
    print("Final verdict:")
    print("Vector rollout: NOT APPROVED")
    print("Phase 21: not started")
    print("Production retrieval remains keyword")


def _self_test() -> int:
    import tempfile

    failures: list[str] = []

    def check(name: str, cond: bool) -> None:
        if not cond:
            failures.append(name)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        valid = tmp_path / "keyword-01-catalog_activity.json"
        valid.write_text(json.dumps({
            "request": {"question": "catalog?", "label": "catalog_activity"},
            "http_status": 200,
            "latency_ms": 1200.5,
            "response": {
                "summary": "Retrieved 8 grounded excerpts.",
                "model_used": "rule-engine",
                "source_refs": [{"source_type": "listing"}],
                "details": {"retrieval_mode": "keyword", "excerpts": ["Listing revision for E2E"]},
            },
        }))
        row = analyze(str(valid))
        check("analyze(str_path)", row["case_id"] == "catalog_activity")
        row2 = analyze(valid)
        check("analyze(Path_path)", row2["file"] == valid.name)

        missing_sd = tmp_path / "shadow-off-02-test.json"
        missing_sd.write_text(json.dumps({
            "request": {"question": "q", "label": "test"},
            "http_status": 200,
            "latency_ms": 900,
            "response": {"summary": "ok", "model_used": "rule-engine", "details": {}},
        }))
        row3 = analyze(missing_sd)
        check("missing shadow_diagnostics", row3["chunk_overlap"] == "not_exposed")

        bad_shape = tmp_path / "keyword-bad.json"
        bad_shape.write_text(json.dumps({
            "http_status": 200,
            "response": {"details": "not-a-dict", "source_refs": "not-a-list"},
        }))
        row4 = analyze(bad_shape)
        check("string where object expected", row4.get("failure_class") != "")

        timeout_case = tmp_path / "shadow-off-timeout.json"
        timeout_case.write_text(json.dumps({
            "request": {"label": "timeout_case"},
            "http_status": 200,
            "response": {
                "summary": "x",
                "details": {
                    "shadow_diagnostics": {
                        "counts": {"selected_count": 0},
                        "embed": {"timed_out": True, "latency_ms": 6000},
                        "timings_ms": {"embed": 6000, "candidate_fetch": 0, "total": 6100},
                    },
                },
            },
        }))
        row5 = analyze(timeout_case)
        check("embed timeout class", row5["failure_class"] == "embed_timeout_before_fetch")

        req_err = tmp_path / "shadow-off-err.json"
        req_err.write_text(json.dumps({
            "request": {"label": "err"},
            "http_status": 0,
            "response": {"error": "curl failed"},
        }))
        row6 = analyze(req_err)
        check("request error class", row6["failure_class"] == "request_error")

        flagged = tmp_path / "flagged-overlap.json"
        flagged.write_text(json.dumps({
            "request": {"label": "flagged_case"},
            "http_status": 200,
            "response": {
                "summary": "x",
                "details": {
                    "shadow_diagnostics": {
                        "counts": {"selected_count": 8},
                        "overlap": {"count": 2, "document_overlap_count": 2, "entity_overlap_count": 5},
                        "debug": {"entity_boosted_rows": 3, "neighbor_rows_added": 0},
                        "timings_ms": {"total": 4000, "embed": 1000, "candidate_fetch": 2500},
                    },
                },
            },
        }))
        row7 = analyze(flagged)
        check("flagged overlap extract", _as_int(row7["chunk_overlap"]) == 2)
        check("leakage pass", row7["leakage"] == "PASS")
        check("shadow_fetch_attempted", row7.get("shadow_fetch_attempted") is True)

        warmup_fail = tmp_path / "shadow-off-warmup-fail.json"
        warmup_fail.write_text(json.dumps({
            "request": {"label": "warmup_fail", "embed_warmup_failed": True},
            "http_status": 0,
            "response": {"error": "embed_warmup_failed"},
        }))
        row8 = analyze(warmup_fail)
        check("embed warmup failed class", row8["failure_class"] == "embed_warmup_failed")

    if failures:
        print("SELF-TEST FAIL:", ", ".join(failures), file=sys.stderr)
        return 1
    print("SELF-TEST PASS (10 checks)")
    return 0


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "--self-test":
        return _self_test()
    if len(sys.argv) < 2:
        print("Usage: rp-ai-live-inference-telemetry.py --self-test | <raw.json>...", file=sys.stderr)
        return 2
    for arg in sys.argv[1:]:
        row = analyze(arg)
        print(json.dumps(row, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
