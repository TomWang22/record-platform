#!/usr/bin/env python3
"""T20.13E — Live inference transcript harness with embed warmup/retry telemetry."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
REPO = SCRIPT_DIR.parent
OUT_DIR = REPO / "bench_logs/ai-platform/live-inference"

_TELEMETRY_PATH = SCRIPT_DIR / "rp-ai-live-inference-telemetry.py"
_spec = importlib.util.spec_from_file_location("rp_ai_live_inference_telemetry", _TELEMETRY_PATH)
assert _spec and _spec.loader
_telemetry = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_telemetry)

build_summary = _telemetry.build_summary
parse_case = _telemetry.parse_case
print_console_summary = _telemetry.print_console_summary
percentile = _telemetry.percentile

RAG_PROMPTS = [
    ("01", "catalog_activity", "Summarize listing activity and buyer interest for my catalog."),
    ("02", "seller_notifications", "What notifications matter most for my selling activity right now?"),
    ("03", "offer_bidding_activity", "Show a concise summary of bidding and offer activity tied to my recent listings."),
    ("04", "listing_revision_changes", "What changed recently on listing revisions that may affect offers?"),
    ("05", "private_negotiation_no_messages", "Summarize my private seller-side negotiation context without exposing message bodies."),
    ("06", "seller_attention_today", "What should I pay attention to as a seller today?"),
    ("07", "marketplace_activity_summary", "Give me a grounded summary of recent marketplace activity relevant to me."),
]


@dataclass
class EmbedHarnessConfig:
    warmup_enabled: bool = True
    warmup_runs: int = 3
    warmup_threshold_ms: int = 2000
    retry_on_timeout: int = 1
    embed_timeout_ms: int = 5000
    warmup_passed: bool = False
    warmup_latencies_ms: list[int] = field(default_factory=list)
    retry_attempted: int = 0
    retry_succeeded: int = 0


def response_embed_timed_out(resp: dict) -> bool:
    if not isinstance(resp, dict):
        return False
    details = resp.get("details") if isinstance(resp.get("details"), dict) else {}
    sd = details.get("shadow_diagnostics") if isinstance(details.get("shadow_diagnostics"), dict) else {}
    sv = details.get("shadow_vector") if isinstance(details.get("shadow_vector"), dict) else {}
    embed = sd.get("embed") if isinstance(sd.get("embed"), dict) else {}
    return bool(sv.get("status") == "embed_timed_out" or embed.get("timed_out"))


def run_embed_warmup_gate(cfg: EmbedHarnessConfig, *, consecutive: int | None = None) -> bool:
    if not cfg.warmup_enabled:
        cfg.warmup_passed = True
        return True
    need = consecutive if consecutive is not None else cfg.warmup_runs
    env = os.environ.copy()
    env["OLLAMA_WARMUP_CONSECUTIVE"] = str(need)
    env["OLLAMA_WARMUP_TARGET_MS"] = str(cfg.warmup_threshold_ms)
    env["OLLAMA_WARMUP_MAX_ATTEMPTS"] = str(max(12, need * 4))
    proc = subprocess.run(
        ["bash", str(SCRIPT_DIR / "rp-ai-ollama-embed-warmup.sh")],
        capture_output=True,
        text=True,
        timeout=600,
        check=False,
        env=env,
    )
    latencies: list[int] = []
    for line in (proc.stdout or "").splitlines():
        m = re.search(r"elapsed_ms=(\d+)", line)
        if m:
            latencies.append(int(m.group(1)))
    cfg.warmup_latencies_ms.extend(latencies)
    passed = proc.returncode == 0 and "WARMUP_PASS" in (proc.stdout or "")
    if consecutive is None:
        cfg.warmup_passed = passed
    return passed


def warmup_stats_dict(cfg: EmbedHarnessConfig) -> dict[str, Any]:
    lats = cfg.warmup_latencies_ms
    return {
        "embed_warmup_enabled": cfg.warmup_enabled,
        "embed_warmup_passed": cfg.warmup_passed,
        "embed_warmup_runs_requested": cfg.warmup_runs,
        "embed_warmup_runs_passed": cfg.warmup_runs if cfg.warmup_passed else 0,
        "embed_warmup_threshold_ms": cfg.warmup_threshold_ms,
        "embed_warmup_p50_ms": percentile([float(x) for x in lats], 50) if lats else None,
        "embed_warmup_p95_ms": percentile([float(x) for x in lats], 95) if lats else None,
        "embed_retry_on_timeout": cfg.retry_on_timeout,
        "embed_retry_attempted": cfg.retry_attempted,
        "embed_retry_succeeded": cfg.retry_succeeded,
        "embed_timeout_ms": cfg.embed_timeout_ms,
    }


def sh(cmd: list[str], *, timeout: int = 300) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)


def discover_lb() -> str:
    proc = sh([
        "kubectl", "-n", "ingress-nginx", "get", "svc", "caddy-h3",
        "-o", "jsonpath={.status.loadBalancer.ingress[0].ip}",
    ])
    ip = (proc.stdout or "").strip() or os.environ.get("TARGET_IP", "").strip()
    if not ip:
        raise RuntimeError("Could not discover MetalLB IP")
    return ip


def git_sha() -> str:
    proc = sh(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"])
    return (proc.stdout or "").strip() or "unknown"


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


def write_raw(raw_dir: Path, name: str, payload: dict) -> Path:
    path = raw_dir / name
    path.write_text(json.dumps(payload, indent=2))
    return path


def run_rag_cases(
    token: str,
    lb_ip: str,
    raw_dir: Path,
    *,
    prefix: str,
    shadow: bool,
    flags_label: str | None = None,
    embed_cfg: EmbedHarnessConfig | None = None,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    cfg = embed_cfg or EmbedHarnessConfig(warmup_enabled=False, warmup_passed=True)

    if shadow and cfg.warmup_enabled and not cfg.warmup_passed:
        for cid, label, _question in RAG_PROMPTS:
            path = write_raw(raw_dir, f"{prefix}-{cid}.json", {
                "request": {"label": label, "shadow": True, "embed_warmup_failed": True},
                "http_status": 0,
                "latency_ms": 0,
                "response": {"error": "embed_warmup_failed"},
            })
            row = parse_case(path)
            row["case_id"] = f"{prefix}-{label}"
            row["failure_class"] = "embed_warmup_failed"
            rows.append(row)
        return rows

    for cid, label, question in RAG_PROMPTS:
        embed_retry_attempted = False
        embed_retry_succeeded = False
        resp: dict = {}
        http_status = 0
        lat = 0.0
        attempts = 0
        max_attempts = 1 + (cfg.retry_on_timeout if shadow else 0)

        while attempts < max_attempts:
            attempts += 1
            if shadow and attempts > 1:
                embed_retry_attempted = True
                cfg.retry_attempted += 1
                run_embed_warmup_gate(cfg, consecutive=1)
                time.sleep(0.5)
            resp, http_status, lat = api_call(
                token, lb_ip, "POST", "/api/ai/rag/query", {"question": question}, shadow=shadow,
            )
            if not shadow or not response_embed_timed_out(resp):
                if shadow and embed_retry_attempted:
                    embed_retry_succeeded = True
                    cfg.retry_succeeded += 1
                break

        req: dict[str, Any] = {"question": question, "label": label, "shadow": shadow}
        if flags_label:
            req["flags"] = flags_label
        if shadow:
            req["embed_timeout_ms"] = cfg.embed_timeout_ms
        if embed_retry_attempted:
            req["embed_retry_attempted"] = True
        if embed_retry_succeeded:
            req["embed_retry_succeeded"] = True
        path = write_raw(raw_dir, f"{prefix}-{cid}.json", {
            "request": req,
            "http_status": http_status,
            "latency_ms": round(lat, 1),
            "response": resp,
            "attempts": attempts,
        })
        row = parse_case(path)
        row["case_id"] = f"{prefix}-{label}" if prefix != "keyword" else label
        rows.append(row)
    return rows


def run_endpoints(token: str, lb_ip: str, raw_dir: Path, ctx: dict[str, str]) -> list[dict[str, Any]]:
    endpoints = [
        ("seller_sales_summary", "POST", "/api/ai/seller/summary", {}),
        ("buyer_collection_summary", "POST", "/api/ai/buyer/summary", {}),
        ("pricing_recommendation", "POST", "/api/ai/listings/pricing-advice",
         {"listing_id": ctx["listing_id"]} if ctx["listing_id"] else None),
        ("record_valuation", "POST", "/api/ai/records/valuation",
         {"record_id": ctx["record_id"]} if ctx["record_id"] else None),
        ("auction_risk", "POST", "/api/ai/auctions/risk",
         {"listing_id": ctx["auction_id"]} if ctx["auction_id"] else None),
    ]
    rows: list[dict[str, Any]] = []
    for name, method, path, body in endpoints:
        if body is None:
            rows.append({
                "case_id": name, "mode": "endpoint", "endpoint": name,
                "http_status": 0, "skipped": True, "summary": "",
                "model_used": "", "refs_count": 0, "source_types": [],
                "leakage": "SKIP", "failure_class": "unknown",
            })
            continue
        resp, http_status, lat = api_call(token, lb_ip, method, path, body)
        ep_path = write_raw(raw_dir, f"endpoint-{name}.json", {
            "request": {"endpoint": name, "label": name},
            "http_status": http_status,
            "latency_ms": round(lat, 1),
            "response": resp,
        })
        row = parse_case(ep_path)
        row["case_id"] = name
        row["endpoint"] = name
        rows.append(row)
    return rows


def render_markdown(
    *,
    sha: str,
    keyword_rows: list[dict],
    shadow_off_rows: list[dict],
    shadow_on_rows: list[dict],
    endpoint_rows: list[dict],
    flags_after: dict[str, str],
    active_provider: str,
    ollama_st: dict,
    summary: dict,
) -> str:
    lines = [
        "# Live inference telemetry report",
        "",
        f"Generated: {datetime.now(timezone.utc).isoformat()}",
        f"Baseline SHA: `{sha}`",
        "Harness: `scripts/rp-ai-live-inference-transcript.sh`",
        "Telemetry: `scripts/rp-ai-live-inference-telemetry.py`",
        "Vector rollout: NOT APPROVED",
        "",
        "## Production keyword RAG",
        "",
        "| case_id | HTTP | latency_ms | model_used | refs | source_types | leakage | failure_class | excerpt |",
        "|---------|-----:|-----------:|------------|-----:|--------------|---------|---------------|---------|",
    ]
    for row in keyword_rows:
        lines.append(
            f"| {row['case_id']} | {row.get('http_status')} | {row.get('latency_ms')} | "
            f"{row.get('model_used')} | {row.get('refs_count')} | {row.get('source_types')} | "
            f"{row.get('leakage')} | {row.get('failure_class')} | "
            f"{(row.get('answer_excerpt') or row.get('summary') or '')[:80]} |"
        )

    lines += [
        "",
        "## Shadow diagnostic (flags off)",
        "",
        "| case_id | selected | chunk | doc | entity | embed_ms | cf_ms | shadow_ms | failure_class | status |",
        "|---------|--------:|------:|----:|-------:|---------:|------:|----------:|---------------|--------|",
    ]
    for row in shadow_off_rows:
        lines.append(
            f"| {row['case_id']} | {row.get('shadow_selected_count')} | {row.get('chunk_overlap')} | "
            f"{row.get('document_overlap')} | {row.get('entity_overlap')} | {row.get('embed_ms')} | "
            f"{row.get('candidate_fetch_ms')} | {row.get('shadow_total_ms')} | {row.get('failure_class')} | "
            f"{row.get('timeout_status')} |"
        )

    if shadow_on_rows:
        lines += [
            "",
            "## Shadow diagnostic (flags on)",
            "",
            "| case_id | selected | chunk | doc | entity | entity_boosted | neighbor | failure_class | shadow_ms |",
            "|---------|--------:|------:|----:|-------:|---------------:|---------:|---------------|----------:|",
        ]
        for row in shadow_on_rows:
            lines.append(
                f"| {row['case_id']} | {row.get('shadow_selected_count')} | {row.get('chunk_overlap')} | "
                f"{row.get('document_overlap')} | {row.get('entity_overlap')} | {row.get('entity_boosted_rows')} | "
                f"{row.get('neighbor_rows_added')} | {row.get('failure_class')} | {row.get('shadow_total_ms')} |"
            )

    lines += ["", "## Structured endpoints", ""]
    for ep in endpoint_rows:
        if ep.get("skipped"):
            lines.append(f"- **{ep['case_id']}**: skipped (missing context id)")
        else:
            lines.append(
                f"- **{ep['case_id']}**: HTTP {ep.get('http_status')} | {ep.get('model_used')} | "
                f"{(ep.get('summary') or '')[:80]} | refs {ep.get('refs_count')} | {ep.get('leakage')} | "
                f"{ep.get('failure_class')}"
            )

    lines += [
        "",
        "## Telemetry summary",
        "",
        f"```json\n{json.dumps(summary, indent=2)}\n```",
        "",
        "## Provider evidence",
        f"- active: `{active_provider}` | ollama.available: `{ollama_st.get('available')}`",
        f"- Flags after run: `{flags_after}`",
    ]
    return "\n".join(lines) + "\n"


def pick_excerpts(keyword_rows: list[dict], endpoint_rows: list[dict]) -> list[tuple[str, str]]:
    wanted = [
        "catalog_activity",
        "seller_notifications",
        "private_negotiation_no_messages",
        "pricing_recommendation",
    ]
    out: list[tuple[str, str]] = []
    by_id = {r["case_id"]: r for r in keyword_rows}
    by_id.update({r["case_id"]: r for r in endpoint_rows})
    for key in wanted:
        row = by_id.get(key, {})
        text = row.get("summary") or row.get("answer_excerpt") or "not_exposed"
        out.append((key, str(text)))
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Live AI inference telemetry harness (read-only)")
    parser.add_argument("--skip-flagged", action="store_true", help="Skip flagged diagnostic mode")
    parser.add_argument("--skip-endpoints", action="store_true", help="Skip structured insight endpoints")
    parser.add_argument("--embed-warmup-runs", type=int, default=3, help="Consecutive embed probes under threshold")
    parser.add_argument("--embed-warmup-threshold-ms", type=int, default=2000, help="Warmup latency target ms")
    parser.add_argument("--embed-retry-on-timeout", type=int, default=1, help="Shadow embed retries after warmup probe")
    parser.add_argument("--embed-timeout-ms", type=int, default=5000, help="Observed app embed timeout for classification")
    parser.add_argument("--no-embed-warmup", action="store_true", help="Skip pre-shadow embed warmup gate")
    args = parser.parse_args()

    embed_cfg = EmbedHarnessConfig(
        warmup_enabled=not args.no_embed_warmup,
        warmup_runs=args.embed_warmup_runs,
        warmup_threshold_ms=args.embed_warmup_threshold_ms,
        retry_on_timeout=max(0, args.embed_retry_on_timeout),
        embed_timeout_ms=args.embed_timeout_ms,
    )

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    raw_dir = OUT_DIR / f"raw-{ts}"
    out_md = OUT_DIR / f"{ts}.md"
    out_json = OUT_DIR / f"{ts}.summary.json"
    raw_dir.mkdir(parents=True, exist_ok=True)

    lb_ip = discover_lb()
    token = auth_token(lb_ip)
    sha = git_sha()
    status = fetch_rag_status(lb_ip)
    ollama_st = (status.get("providers") or {}).get("ollama") or {}
    active_provider = status.get("active") or "rule"
    ctx = discover_context_ids(token, lb_ip)

    keyword_rows = run_rag_cases(token, lb_ip, raw_dir, prefix="keyword", shadow=False)

    if embed_cfg.warmup_enabled:
        print("Running embed warmup gate before shadow diagnostics...", file=sys.stderr)
        run_embed_warmup_gate(embed_cfg)
        if not embed_cfg.warmup_passed:
            print("Embed warmup gate failed — shadow cases will be marked embed_warmup_failed", file=sys.stderr)

    shadow_off_rows = run_rag_cases(
        token, lb_ip, raw_dir, prefix="shadow-off", shadow=True, embed_cfg=embed_cfg,
    )

    flagged_rows: list[dict[str, Any]] = []
    if not args.skip_flagged:
        if embed_cfg.warmup_enabled and embed_cfg.warmup_passed:
            run_embed_warmup_gate(embed_cfg, consecutive=1)
        print("Enabling flagged deployment env...", file=sys.stderr)
        kubectl_set_flags("1", "1")
        time.sleep(3)
        flagged_rows = run_rag_cases(
            token, lb_ip, raw_dir, prefix="flagged", shadow=True,
            flags_label="1/1", embed_cfg=embed_cfg,
        )
        print("Resetting deployment flags...", file=sys.stderr)
        kubectl_set_flags("0", "0")

    flags_after = kubectl_env_flags()
    endpoint_rows: list[dict[str, Any]] = []
    if not args.skip_endpoints:
        endpoint_rows = run_endpoints(token, lb_ip, raw_dir, ctx)

    leakage_fail = any(r.get("leakage") not in ("PASS", "SKIP", "not_exposed") for r in keyword_rows + endpoint_rows)

    summary = build_summary(
        report_md=out_md,
        summary_json=out_json,
        raw_dir=raw_dir,
        sha=sha,
        keyword_rows=keyword_rows,
        shadow_off_rows=shadow_off_rows,
        shadow_on_rows=flagged_rows,
        endpoint_rows=endpoint_rows,
        flags_after=flags_after,
        leakage_fail=leakage_fail,
        warmup_stats=warmup_stats_dict(embed_cfg),
    )
    out_json.write_text(json.dumps(summary, indent=2))
    out_md.write_text(render_markdown(
        sha=sha,
        keyword_rows=keyword_rows,
        shadow_off_rows=shadow_off_rows,
        shadow_on_rows=flagged_rows,
        endpoint_rows=endpoint_rows,
        flags_after=flags_after,
        active_provider=active_provider,
        ollama_st=ollama_st,
        summary=summary,
    ))

    excerpts = pick_excerpts(keyword_rows, endpoint_rows)
    print_console_summary(summary, excerpts)

    return 1 if leakage_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
