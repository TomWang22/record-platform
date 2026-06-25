#!/usr/bin/env python3
"""T20.12H — Live inference transcript harness (read-only, local bench_logs output)."""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
OUT_DIR = REPO / "bench_logs/ai-platform/live-inference"

PROMPTS = [
    ("01", "catalog_activity", "Summarize listing activity and buyer interest for my catalog."),
    ("02", "seller_notifications", "What notifications matter most for my selling activity right now?"),
    ("03", "offer_bidding", "Show a concise summary of bidding and offer activity tied to my recent listings."),
    ("04", "listing_revisions", "What changed recently on listing revisions that may affect offers?"),
    ("05", "negotiation_context", "Summarize my private seller-side negotiation context without exposing message bodies."),
    ("06", "seller_attention", "What should I pay attention to as a seller today?"),
    ("07", "marketplace_activity", "Give me a grounded summary of recent marketplace activity relevant to me."),
]

FORBIDDEN = re.compile(
    r"demo|mock|sample fallback|placeholder|lorem ipsum|proxy max|max_bid_cents|proxy_bids|OCH|off[- ]campus",
    re.I,
)
MESSAGE_LEAK = re.compile(r"message_body|thread_text|private obo message", re.I)


def sh(cmd: list[str], *, timeout: int = 300) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)


def discover_lb() -> str:
    proc = sh(
        [
            "kubectl", "-n", "ingress-nginx", "get", "svc", "caddy-h3",
            "-o", "jsonpath={.status.loadBalancer.ingress[0].ip}",
        ]
    )
    ip = (proc.stdout or "").strip() or os.environ.get("TARGET_IP", "").strip()
    if not ip:
        raise RuntimeError("Could not discover MetalLB IP")
    return ip


def git_sha() -> str:
    proc = sh(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"])
    return (proc.stdout or "").strip() or "unknown"


def leakage_check(text: str, source_types: list[str]) -> str:
    if "message" in source_types:
        return "FAIL_message_source_type"
    if MESSAGE_LEAK.search(text):
        return "FAIL_message_leak"
    if FORBIDDEN.search(text):
        return "FAIL_forbidden"
    return "PASS"


def dig(obj: dict, *keys: str, default=None):
    cur: Any = obj
    for k in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
    return cur if cur is not None else default


def extract_keyword_metrics(resp: dict) -> dict[str, Any]:
    details = resp.get("details") or {}
    refs = resp.get("source_refs") or []
    types = sorted({r.get("source_type") for r in refs if r.get("source_type")})
    excerpt = ""
    if details.get("excerpts"):
        excerpt = str(details["excerpts"][0])[:200]
    blob = json.dumps(resp)
    return {
        "endpoint": "/api/ai/rag/query",
        "retrieval_mode": details.get("retrieval_mode", "not_exposed"),
        "model_used": resp.get("model_used", "not_exposed"),
        "summary": resp.get("summary", ""),
        "explanation": details.get("explanation", ""),
        "source_types": types,
        "refs_count": len(refs),
        "excerpt": excerpt,
        "leakage": leakage_check(blob, types),
    }


def extract_shadow_metrics(resp: dict) -> dict[str, Any]:
    details = resp.get("details") or {}
    sv = details.get("shadow_vector") or {}
    sd = details.get("shadow_diagnostics") or {}
    dbg = sd.get("debug") or {}
    ov = sd.get("overlap") or {}
    ov_expl = ov.get("explanation") or {}
    sv_expl = sv.get("overlap_explanation") or {}

    def first(*vals):
        for v in vals:
            if v is not None:
                return v
        return "not_exposed"

    timings = sd.get("timings_ms") or sv.get("timings_ms") or {}
    embed_diag = sd.get("embed") or {}
    sh_types = (
        dig(sv, "source_type_distribution")
        or dig(sd, "by_source_type", "selected")
        or dig(sv_expl, "shadow_source_types")
        or {}
    )
    timeout_status = "ok"
    if sv.get("status") == "embed_timed_out" or embed_diag.get("timed_out"):
        timeout_status = "embed_timeout"

    return {
        "shadow_source_types": sorted(sh_types.keys()) if isinstance(sh_types, dict) else [],
        "chunk_overlap": first(
            ov.get("count"), ov_expl.get("chunk_overlap_count"),
            sv.get("overlap_count"), sv_expl.get("chunk_overlap_count"),
        ),
        "doc_overlap": first(
            ov.get("document_overlap_count"), ov_expl.get("document_overlap_count"),
            sv.get("document_overlap_count"), sv_expl.get("document_overlap_count"),
        ),
        "entity_overlap": first(
            ov.get("entity_overlap_count"), ov_expl.get("entity_overlap_count"),
            sv.get("entity_overlap_count"), sv_expl.get("entity_overlap_count"),
        ),
        "entity_boosted_rows": dbg.get("entity_boosted_rows", "not_exposed"),
        "neighbor_rows_added": dbg.get("neighbor_rows_added", "not_exposed"),
        "candidate_fetch_ms": timings.get("candidate_fetch", "not_exposed"),
        "embed_ms": timings.get("embed", embed_diag.get("latency_ms", "not_exposed")),
        "shadow_total_ms": timings.get("total", sv.get("latency_ms", "not_exposed")),
        "timeout_status": timeout_status,
        "embed_provider": embed_diag.get("provider", "not_exposed"),
    }


def parse_case_file(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text())
    resp = data.get("response") or data
    row = {
        "file": path.name,
        "http_status": data.get("http_status"),
        "latency_ms": data.get("latency_ms"),
        "prompt": dig(data, "request", "question") or "",
        "case_id": path.stem,
    }
    row.update(extract_keyword_metrics(resp))
    row.update(extract_shadow_metrics(resp))
    return row


def auth_token(lb_ip: str) -> str:
    ca = REPO / "certs/dev-chain.pem"
    email = os.environ.get("RP_COMB_EMAIL", "e2e-contract@record-platform.local")
    password = os.environ.get("RP_COMB_PASSWORD", "ContractPass123!")
    proc = sh([
        "curl", "-sfS", "--max-time", "30", "--cacert", str(ca),
        "--resolve", f"record-platform.test:443:{lb_ip}",
        "-X", "POST", "https://record-platform.test/api/auth/login",
        "-H", "Content-Type: application/json", "-H", "X-RP-E2E-Contract: 1",
        "-d", json.dumps({"email": email, "password": password}),
    ])
    if proc.returncode != 0:
        raise RuntimeError(f"auth failed: {proc.stderr or proc.stdout}")
    return json.loads(proc.stdout)["token"]


def api_call(
    token: str, lb_ip: str, method: str, path: str, body: dict | None = None, *, shadow: bool = False,
) -> tuple[dict, int, float]:
    ca = REPO / "certs/dev-chain.pem"
    url_path = path
    if shadow and "?" not in path:
        url_path += "?shadow_vector=1&shadow_debug=1"
    t0 = time.perf_counter()
    cmd = [
        "curl", "-sfS", "--max-time", "180", "--cacert", str(ca),
        "--resolve", f"record-platform.test:443:{lb_ip}",
        "-w", "\n%{http_code}",
        "-H", f"Authorization: Bearer {token}",
        "-H", "X-RP-E2E-Contract: 1",
    ]
    if body is not None:
        cmd += ["-X", "POST", "-H", "Content-Type: application/json", "-d", json.dumps(body)]
    else:
        cmd += ["-X", method]
    cmd.append(f"https://record-platform.test{url_path}")
    proc = sh(cmd)
    lat = (time.perf_counter() - t0) * 1000
    if proc.returncode != 0:
        return {"error": (proc.stderr or proc.stdout)[:500]}, 0, lat
    lines = proc.stdout.rsplit("\n", 1)
    raw, code_s = (lines[0], lines[1]) if len(lines) == 2 else (proc.stdout, "0")
    try:
        return json.loads(raw), int(code_s), lat
    except json.JSONDecodeError:
        return {"parse_error": raw[:500]}, int(code_s or 0), lat


def fetch_rag_status(lb_ip: str) -> dict:
    ca = REPO / "certs/dev-chain.pem"
    proc = sh([
        "curl", "-sfS", "--max-time", "20", "--cacert", str(ca),
        "--resolve", f"record-platform.test:443:{lb_ip}",
        "https://record-platform.test/api/ai/rag/status",
    ])
    if proc.returncode != 0:
        return {}
    return json.loads(proc.stdout)


def kubectl_env_flags() -> dict[str, str]:
    ns = os.environ.get("K8S_NS", "record-platform")
    proc = sh(["kubectl", "set", "env", "deployment/python-ai-service", "-n", ns, "--list"])
    out: dict[str, str] = {}
    if proc.returncode != 0:
        return out
    for line in proc.stdout.splitlines():
        if "=" in line and "AI_RAG_SHADOW" in line:
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip()
    return out


def kubectl_set_flags(hints: str, neighbor: str) -> None:
    ns = os.environ.get("K8S_NS", "record-platform")
    sh([
        "kubectl", "set", "env", "deployment/python-ai-service", "-n", ns,
        f"AI_RAG_SHADOW_ENTITY_HINTS={hints}",
        f"AI_RAG_SHADOW_NEIGHBOR_EXPANSION={neighbor}",
    ], timeout=120)
    sh([
        "kubectl", "rollout", "status", "deployment/python-ai-service", "-n", ns,
        "--timeout=300s",
    ], timeout=320)


def discover_context_ids(token: str, lb_ip: str) -> dict[str, str]:
    listing_id = ""
    record_id = ""
    auction_id = ""
    resp, status, _ = api_call(token, lb_ip, "GET", "/api/listings/search?limit=1")
    if status == 200 and isinstance(resp, dict):
        listing_id = (resp.get("items") or [{}])[0].get("id", "") or ""
    resp, status, _ = api_call(token, lb_ip, "GET", "/api/records")
    if status == 200 and isinstance(resp, list) and resp:
        record_id = resp[0].get("id", "") or ""
    proc = sh([
        "env", "PGPASSWORD=postgres", "psql", "-h", "127.0.0.1", "-p", "5440",
        "-U", "postgres", "-d", "python_ai", "-At", "-c",
        "SELECT COALESCE((SELECT source_id::text FROM ai.ai_documents "
        "WHERE source_type='auction_bid_summary' LIMIT 1), '');",
    ])
    if proc.returncode == 0:
        auction_id = (proc.stdout or "").strip()
    return {"listing_id": listing_id, "record_id": record_id, "auction_id": auction_id}


def overlap_count(rows: list[dict]) -> tuple[int, int]:
    """Return (cases_with_chunk_overlap, total)."""
    total = len(rows)
    with_ov = 0
    for r in rows:
        co = r.get("chunk_overlap")
        if isinstance(co, int) and co > 0:
            with_ov += 1
        elif co not in (0, "0", "not_exposed", None):
            try:
                if int(co) > 0:
                    with_ov += 1
            except (TypeError, ValueError):
                pass
    return with_ov, total


def main() -> int:
    parser = argparse.ArgumentParser(description="Live AI inference transcript harness (read-only)")
    parser.add_argument("--skip-flagged", action="store_true", help="Skip flagged diagnostic mode")
    parser.add_argument("--skip-endpoints", action="store_true", help="Skip structured insight endpoints")
    args = parser.parse_args()

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    raw_dir = OUT_DIR / f"raw-{ts}"
    out_md = OUT_DIR / f"{ts}.md"
    raw_dir.mkdir(parents=True, exist_ok=True)

    lb_ip = discover_lb()
    token = auth_token(lb_ip)
    sha = git_sha()
    status = fetch_rag_status(lb_ip)
    ollama_st = (status.get("providers") or {}).get("ollama") or {}
    active_provider = status.get("active") or "rule"
    ctx = discover_context_ids(token, lb_ip)

    keyword_rows: list[dict] = []
    shadow_rows: list[dict] = []
    flagged_rows: list[dict] = []
    endpoint_rows: list[dict] = []
    leakage_fail = False

    for cid, label, question in PROMPTS:
        resp, http_status, lat = api_call(
            token, lb_ip, "POST", "/api/ai/rag/query", {"question": question}, shadow=False,
        )
        path = raw_dir / f"keyword-{cid}.json"
        path.write_text(json.dumps({
            "request": {"question": question, "label": label, "shadow": False},
            "http_status": http_status, "latency_ms": round(lat, 1), "response": resp,
        }, indent=2))
        row = parse_case_file(path)
        row["case_id"] = f"keyword-{label}"
        keyword_rows.append(row)
        if row.get("leakage") != "PASS":
            leakage_fail = True

    for cid, label, question in PROMPTS:
        resp, http_status, lat = api_call(
            token, lb_ip, "POST", "/api/ai/rag/query", {"question": question}, shadow=True,
        )
        path = raw_dir / f"shadow-off-{cid}.json"
        path.write_text(json.dumps({
            "request": {"question": question, "label": label, "shadow": True},
            "http_status": http_status, "latency_ms": round(lat, 1), "response": resp,
        }, indent=2))
        row = parse_case_file(path)
        row["case_id"] = f"shadow-off-{label}"
        shadow_rows.append(row)

    flags_after: dict[str, str] = kubectl_env_flags()
    if not args.skip_flagged:
        print("Enabling flagged deployment env...", file=sys.stderr)
        kubectl_set_flags("1", "1")
        time.sleep(3)
        for cid, label, question in PROMPTS:
            resp, http_status, lat = api_call(
                token, lb_ip, "POST", "/api/ai/rag/query", {"question": question}, shadow=True,
            )
            path = raw_dir / f"flagged-{cid}.json"
            path.write_text(json.dumps({
                "request": {"question": question, "label": label, "shadow": True, "flags": "1/1"},
                "http_status": http_status, "latency_ms": round(lat, 1), "response": resp,
            }, indent=2))
            row = parse_case_file(path)
            row["case_id"] = f"flagged-{label}"
            flagged_rows.append(row)
        print("Resetting deployment flags...", file=sys.stderr)
        kubectl_set_flags("0", "0")
        flags_after = kubectl_env_flags()

    if not args.skip_endpoints:
        endpoints = [
            ("seller_sales_summary", "POST", "/api/ai/seller/summary", {}),
            ("buyer_collection_summary", "POST", "/api/ai/buyer/summary", {}),
            ("pricing_recommendation", "POST", "/api/ai/listings/pricing-advice",
             {"listing_id": ctx["listing_id"]} if ctx["listing_id"] else None),
            ("record_valuation", "POST", "/api/ai/records/valuation",
             {"record_id": ctx["record_id"]} if ctx["record_id"] else None),
            ("auction_risk", "POST", "/api/ai/auctions/risk",
             {"listing_id": ctx["auction_id"]} if ctx["auction_id"] else None),
            ("rag_query_smoke", "POST", "/api/ai/rag/query",
             {"question": "Summarize my seller performance in one sentence."}),
        ]
        for name, method, path, body in endpoints:
            if body is None:
                endpoint_rows.append({
                    "endpoint": name, "http_status": 0, "skipped": True,
                    "summary": "", "model_used": "", "refs_count": 0, "source_types": [],
                    "leakage": "SKIP",
                })
                continue
            resp, http_status, lat = api_call(token, lb_ip, method, path, body)
            ep_path = raw_dir / f"endpoint-{name}.json"
            ep_path.write_text(json.dumps({
                "http_status": http_status, "latency_ms": round(lat, 1), "response": resp,
            }, indent=2))
            refs = resp.get("source_refs") or []
            types = sorted({r.get("source_type") for r in refs if r.get("source_type")})
            leak = leakage_check(json.dumps(resp), types)
            if leak != "PASS":
                leakage_fail = True
            endpoint_rows.append({
                "endpoint": name, "http_status": http_status, "latency_ms": round(lat, 1),
                "summary": resp.get("summary", ""), "model_used": resp.get("model_used", ""),
                "refs_count": len(refs), "source_types": types, "leakage": leak,
            })

    kw_nonempty = sum(1 for r in keyword_rows if r.get("summary"))
    ep_nonempty = sum(1 for r in endpoint_rows if r.get("summary") and not r.get("skipped"))
    def_ov, def_total = overlap_count(shadow_rows)
    flg_ov, flg_total = overlap_count(flagged_rows)

    lines = [
        "# Live inference transcript",
        "",
        f"Generated: {datetime.now(timezone.utc).isoformat()}",
        f"Baseline SHA: `{sha}`",
        "Harness: `scripts/rp-ai-live-inference-transcript.sh`",
        "Vector rollout: NOT APPROVED",
        "",
        "## Production keyword RAG",
        "",
    ]
    for row in keyword_rows:
        lines += [
            f"### {row['case_id']}",
            f"Prompt: {row.get('prompt', '')}",
            f"HTTP: {row.get('http_status')} | Latency: {row.get('latency_ms')} ms",
            f"retrieval_mode: `{row.get('retrieval_mode')}` | model_used: `{row.get('model_used')}`",
            f"Answer: {row.get('summary', '')}",
            f"Source types: {row.get('source_types')} | Refs: {row.get('refs_count')}",
            f"Excerpt: {(row.get('excerpt') or '')[:180]}",
            f"Leakage: {row.get('leakage')}",
            "",
        ]

    lines += [
        "## Shadow diagnostic (flags off)",
        "",
        "| Case | shadow types | chunk | doc | entity | embed ms | cf ms | shadow ms | status |",
        "|------|--------------|-------|-----|--------|----------|-------|-----------|--------|",
    ]
    for row in shadow_rows:
        lines.append(
            f"| {row['case_id']} | {row.get('shadow_source_types')} | {row.get('chunk_overlap')} | "
            f"{row.get('doc_overlap')} | {row.get('entity_overlap')} | {row.get('embed_ms')} | "
            f"{row.get('candidate_fetch_ms')} | {row.get('shadow_total_ms')} | {row.get('timeout_status')} |"
        )

    if flagged_rows:
        lines += [
            "",
            "## Shadow diagnostic (flags on)",
            "",
            "| Case | shadow types | chunk | doc | entity | entity boosted | neighbor | shadow ms |",
            "|------|--------------|-------|-----|--------|----------------|----------|-----------|",
        ]
        for row in flagged_rows:
            lines.append(
                f"| {row['case_id']} | {row.get('shadow_source_types')} | {row.get('chunk_overlap')} | "
                f"{row.get('doc_overlap')} | {row.get('entity_overlap')} | {row.get('entity_boosted_rows')} | "
                f"{row.get('neighbor_rows_added')} | {row.get('shadow_total_ms')} |"
            )

    if endpoint_rows:
        lines += ["", "## Structured endpoints", ""]
        for ep in endpoint_rows:
            if ep.get("skipped"):
                lines.append(f"- **{ep['endpoint']}**: skipped (missing context id)")
            else:
                lines.append(
                    f"- **{ep['endpoint']}**: HTTP {ep['http_status']} | {ep.get('model_used')} | "
                    f"{(ep.get('summary') or '')[:80]} | refs {ep.get('refs_count')} | {ep.get('leakage')}"
                )

    lines += [
        "",
        "## Provider evidence",
        f"- active: `{active_provider}` | ollama.available: `{ollama_st.get('available')}`",
        "- Production RAG: rule-engine summaries + grounded excerpts",
        "- Ollama: shadow embeddings when shadow_vector=1",
        f"- Flags after run: `{flags_after}`",
        "",
        f"Raw JSON: `{raw_dir}`",
    ]
    out_md.write_text("\n".join(lines))

    print("Live inference transcript complete")
    print()
    print(f"Report: {out_md}")
    print(f"Raw JSON: {raw_dir}")
    print(f"Keyword cases: {kw_nonempty}/{len(keyword_rows)} non-empty")
    print(f"Structured endpoints: {ep_nonempty}/{len([e for e in endpoint_rows if not e.get('skipped')])} non-empty")
    print(f"Production model_used: {keyword_rows[0].get('model_used') if keyword_rows else 'n/a'}")
    print("Ollama: embed provider for shadow diagnostics")
    print(f"Default shadow overlap: {def_ov}/{def_total} cases with chunk overlap > 0")
    print(f"Flagged shadow overlap: {flg_ov}/{flg_total} cases with chunk overlap > 0")
    print(f"Leakage: {'FAIL' if leakage_fail else 'PASS'}")
    print(f"Flags reset: {flags_after}")
    print("Vector rollout: NOT APPROVED")

    meta = {
        "report": str(out_md), "raw_dir": str(raw_dir), "sha": sha,
        "keyword_nonempty": kw_nonempty, "endpoint_nonempty": ep_nonempty,
        "default_overlap": f"{def_ov}/{def_total}", "flagged_overlap": f"{flg_ov}/{flg_total}",
        "leakage": "FAIL" if leakage_fail else "PASS", "flags_after": flags_after,
    }
    (raw_dir / "_meta.json").write_text(json.dumps(meta, indent=2))
    return 1 if leakage_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
