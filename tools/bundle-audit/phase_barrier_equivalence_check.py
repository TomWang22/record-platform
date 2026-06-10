#!/usr/bin/env python3
"""
Static check that the RP preflight driver encodes cluster / phase / transport /
observability invariants (no cluster required).

Scans the preflight driver plus `cluster-stability-guard.sh`, `phase-barrier.sh`,
`run-transport-study-experiments.sh`, and `preflight-controlled-transport-otel-prove.sh`
when present.

Writes docs/bundles/PREFLIGHT_PHASE_BARRIER_EQUIVALENCE.md with PASS/FAIL rows.
Exit 1 if any invariant fails.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

INVARIANTS: list[tuple[str, str, str]] = [
    ("preflight_invokes_cluster_guard", r"cluster-stability-guard\.sh|PREFLIGHT_CLUSTER_STABILITY_GUARD", "Preflight wires cluster stability guard"),
    ("cpu_idle_min_logic", r"CPU_IDLE_MIN|CLUSTER_GUARD_CPU_IDLE", "CPU idle threshold logic"),
    ("mem_free_guard", r"MEM_FREE_MIN|CLUSTER_GUARD_MEM_FREE|mem_free", "Memory free / headroom guard"),
    ("node_readiness", r"kubectl.*top\s+nodes|kubectl.*get\s+nodes|node_count|nodes=", "Node readiness / node set discovery"),
    ("phase_barrier_script", r"phase-barrier\.sh", "Phase barrier script invocation"),
    ("kafka_alignment", r"kafka-alignment-suite|kafka.?alignment", "Kafka alignment suite"),
    ("jaeger_gate", r"jaeger|JAEGER|trace.?overlap|step.?7", "Jaeger / trace / Step7 wiring"),
    ("quic_transport", r"QUIC|http3|transport.?proof|PREFLIGHT_RUN_TRANSPORT", "QUIC / transport proof hooks"),
    ("strict_errexit", r"set\s+-euo\s+pipefail", "Strict `set -euo pipefail` on preflight entry"),
    ("strict_exit_flag", r"PREFLIGHT_STRICT_EXIT", "Strict exit flag documented / used"),
    ("chaos_optional", r"chaos|stochastic|CHAOS", "Optional chaos / stochastic hooks"),
    ("adaptive_single_multi", r"SINGLE|MULTI|CLUSTER_GUARD_CPU_IDLE_MIN_SINGLE|CLUSTER_GUARD_CPU_IDLE_MIN_MULTI", "Adaptive single- vs multi-node thresholds"),
]


def transport_study_set_plus_e_scoped(transport_script: str) -> bool:
    """
    `set +e` is allowed only when immediately followed by a subshell that re-enables errexit
    (scoped relax, not a silent bypass of the whole transport study).
    """
    if not transport_script.strip():
        return True
    for m in re.finditer(r"set\s*\+e", transport_script, flags=re.I):
        tail = transport_script[m.start() : m.start() + 800]
        if not re.search(r"\(\s*\n\s*set\s+-euo\s+pipefail", tail, re.I):
            return False
    return True


def load_scan_text(repo: Path, main: Path) -> str:
    parts: list[str] = []
    parts.append(main.read_text(encoding="utf-8", errors="replace"))
    for name in (
        "cluster-stability-guard.sh",
        "phase-barrier.sh",
        "run-transport-study-experiments.sh",
        "preflight-controlled-transport-otel-prove.sh",
    ):
        p = repo / "scripts" / name
        if p.is_file():
            parts.append(p.read_text(encoding="utf-8", errors="replace"))
    return "\n".join(parts)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--preflight-script", type=Path, default=None)
    ap.add_argument("--repo-root", type=Path, default=Path.cwd())
    ap.add_argument("--output", type=Path, default=None)
    args = ap.parse_args()
    repo = args.repo_root.resolve()
    script = args.preflight_script or (repo / "scripts" / "run-preflight-scale-and-all-suites.sh")
    out = args.output or (repo / "docs" / "bundles" / "PREFLIGHT_PHASE_BARRIER_EQUIVALENCE.md")
    if not script.is_file():
        print(f"Missing preflight script: {script}", file=sys.stderr)
        return 2

    text = load_scan_text(repo, script)
    transport_path = repo / "scripts" / "run-transport-study-experiments.sh"
    transport_body = transport_path.read_text(encoding="utf-8", errors="replace") if transport_path.is_file() else ""

    rows: list[tuple[str, str, str]] = []
    fails = 0
    for key, pat, title in INVARIANTS:
        ok = bool(re.search(pat, text, re.I))
        status = "PASS" if ok else "FAIL"
        if not ok:
            fails += 1
        rows.append((key, title, status))

    s7_ok = bool(re.search(r"(?i)\bstep\s*7\b", text)) and bool(re.search(r"PREFLIGHT_STRICT_EXIT", text))
    rows.append(("step7_strict_docs", "Step 7 and `PREFLIGHT_STRICT_EXIT` both present in scan bundle", "PASS" if s7_ok else "FAIL"))
    if not s7_ok:
        fails += 1

    ts_key = "transport_study_set_plus_e_scoped"
    ts_title = "`set +e` around transport study only with inner `set -euo pipefail` subshell"
    ts_ok = transport_study_set_plus_e_scoped(transport_body)
    rows.append((ts_key, ts_title, "PASS" if ts_ok else "FAIL"))
    if not ts_ok:
        fails += 1

    lines = [
        "# Preflight phase / barrier equivalence (static)",
        "",
        f"**Primary script:** `{script.relative_to(repo)}`",
        "",
        "_Scan bundle includes:_ `scripts/cluster-stability-guard.sh`, `scripts/phase-barrier.sh`, "
        "`scripts/run-transport-study-experiments.sh`, `scripts/preflight-controlled-transport-otel-prove.sh` when present.",
        "",
        "| Invariant | Description | Result |",
        "|-------------|-------------|--------|",
    ]
    for key, title, status in rows:
        lines.append(f"| `{key}` | {title} | **{status}** |")
    lines += ["", f"**Summary:** {len(rows) - fails}/{len(rows)} passed; **{fails}** failed (heuristic)."]

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {out} fail={fails}")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
