#!/usr/bin/env python3
"""T20.13V — API longform RAG session runner (optional Mode B)."""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "webapp" / "e2e" / "helpers"))  # noqa: E402

TURNS = [
    ("catalog_health", "I'm selling records from my catalog. Give me a grounded health check: weak listings, buyer interest, revisions, and pricing risks. Do not invent data."),
    ("prioritized_action_list", "Assume I only have 30 minutes today. Turn that into a prioritized action list. Focus on actions that could improve conversion or avoid losing an offer."),
    ("negotiation_strategy", "For active OBO or offer activity, what should I accept, counter, or review? Explain the negotiation logic conservatively using only offer summaries and listing context."),
    ("buyer_psychology", "What can I infer about buyer intent or negotiation posture? Are buyers testing the floor, responding to counters, or showing serious intent? Use cautious language and cite evidence."),
    ("auction_pressure", "Now focus on auction or bidding signals. Is there urgency, thin demand, bid risk, or anything I should watch? If auction evidence is sparse, say so clearly."),
    ("collector_metadata", "Think like a serious vinyl collector. Which listing details are missing or weak: pressing, condition, title, price, scarcity, seller notes, or provenance?"),
    ("listing_rewrite", "Pick one listing from the retrieved evidence and draft a better collector-facing listing title and description. Do not add facts that are not in the records."),
    ("pricing_plan", "Give me a raise / hold / review pricing plan. Use listing prices, offer amounts, revision context, and valuation signals if present."),
    ("user_tradeoff_rerank", "Additional seller context: I care more about moving stale inventory than maximizing top dollar. I also want to avoid underselling rare jazz records. Re-rank your advice with that tradeoff."),
    ("final_action_plan_long", "Using everything above, produce a final seller action plan for today. Include:\n1. urgent offer actions\n2. listings to revise\n3. pricing moves\n4. collector metadata improvements\n5. auction/bid watch items\n6. what evidence is missing\n7. what you are not allowed to infer\n\nKeep it grounded and conservative."),
    ("red_team_overclaim", "Review your own advice. Identify any place where you may have overclaimed buyer psychology, rarity, auction urgency, or condition. Rewrite those parts more conservatively."),
    ("executive_summary", "Give me a final 10-bullet seller plan I can act on today, with each bullet tagged as [grounded], [missing evidence], or [needs manual review]."),
]


def login(base: str, email: str, password: str, ca: str | None) -> str:
    req = urllib.request.Request(
        f"{base.rstrip('/')}/api/auth/login",
        data=json.dumps({"email": email, "password": password}).encode(),
        headers={"Content-Type": "application/json", "X-RP-E2E-Contract": "1"},
        method="POST",
    )
    ctx = None
    if ca:
        import ssl

        ctx = ssl.create_default_context(cafile=ca)
    with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
        return json.loads(resp.read())["token"]


def rag_query(base: str, token: str, question: str, ca: str | None) -> tuple[int, dict, float]:
    req = urllib.request.Request(
        f"{base.rstrip('/')}/api/ai/rag/query",
        data=json.dumps({"question": question}).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    ctx = None
    if ca:
        import ssl

        ctx = ssl.create_default_context(cafile=ca)
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=120) as resp:
            body = json.loads(resp.read())
            return resp.status, body, (time.perf_counter() - start) * 1000
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode()}, (time.perf_counter() - start) * 1000


def build_accumulated(prior: list[dict], max_chars: int = 6000) -> str:
    blocks = [
        f"Turn {p['turn']}: {p.get('summary', '')[:400]}"
        for p in prior
    ]
    text = "\n\n".join(blocks)
    return text[:max_chars] + ("\n…[truncated]" if len(text) > max_chars else "")


def main() -> int:
    parser = argparse.ArgumentParser(description="T20.13V API longform RAG session")
    parser.add_argument("--base-url", default="https://record-platform.test")
    parser.add_argument("--user", default="e2e-contract@record-platform.local")
    parser.add_argument("--password", default="ContractPass123!")
    parser.add_argument("--ca", default=str(REPO_ROOT / "certs" / "dev-chain.pem"))
    args = parser.parse_args()

    token = login(args.base_url, args.user, args.password, args.ca if os.path.isfile(args.ca) else None)
    prior: list[dict] = []
    results = []

    for idx, (turn_id, base_prompt) in enumerate(TURNS, start=1):
        if idx >= 10:
            acc = build_accumulated(prior)
            prefs = "\n\nUSER PREFERENCES: Move stale inventory; avoid underselling rare jazz. 30 minutes today.\n\n"
            prompt = f"ACCUMULATED SESSION CONTEXT:\n{acc}{prefs}{base_prompt}"
        else:
            prompt = base_prompt
        status, body, ms = rag_query(args.base_url, token, prompt, args.ca if os.path.isfile(args.ca) else None)
        summary = body.get("summary", "") if isinstance(body, dict) else ""
        prior.append({"turn": idx, "summary": summary})
        results.append({
            "turn": idx,
            "turn_id": turn_id,
            "prompt_chars": len(prompt),
            "estimated_tokens": math.ceil(len(prompt) / 4),
            "http_status": status,
            "api_ms": round(ms),
            "retrieval_mode": (body.get("details") or {}).get("retrieval_mode") if isinstance(body, dict) else None,
            "model_used": body.get("model_used") if isinstance(body, dict) else None,
            "answer_chars": len(summary),
            "summary_excerpt": summary[:500],
        })
        print(f"Turn {idx} {turn_id}: HTTP {status} api={ms:.0f}ms prompt={len(prompt)}chars answer={len(summary)}chars")

    ts = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    out_dir = REPO_ROOT / "bench_logs" / "ai-platform" / "longform-rag-session" / f"api-{ts}"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"api-{ts}.json"
    out_path.write_text(json.dumps({"mode": "api", "results": results}, indent=2))
    print(f"\nWrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
