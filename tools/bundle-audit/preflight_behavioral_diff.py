#!/usr/bin/env python3
"""
Semantic preflight diff: OCH staging script vs RP repo script (read-only).

Normalizes both bodies (strip leading doc banner, comments, namespace strings,
hostnames, whitespace) then compares structured *presence* signals — not a raw
unified line diff.

Output: docs/bundles/PREFLIGHT_BEHAVIORAL_DIFF_<stem>.md with the sections
requested in the bundle-ingestion spec.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
from pathlib import Path

STRUCTURED_SIGNALS: list[tuple[str, str]] = [
    ("phase_block:phase_1", r"(?i)\bphase\s*1[a-z0-9.]*\b"),
    ("phase_block:phase_2", r"(?i)\bphase\s*2[a-z0-9.]*\b"),
    ("phase_block:step_7", r"(?i)\bstep\s*7\b"),
    ("step7_strict_coupling", r"(?i)PREFLIGHT_STRICT_EXIT.*step\s*7|step\s*7.*PREFLIGHT_STRICT_EXIT"),
    ("phase_barrier", r"(?i)phase-barrier\.sh|phase.?barrier|post-kafka-alignment|post-integration"),
    ("transport_proof", r"(?i)transport.?proof|preflight-controlled-transport|PREFLIGHT_RUN_TRANSPORT|QUIC|http3"),
    ("jaeger_gates", r"(?i)jaeger|JAEGER|trace.?overlap|run-step7-observability"),
    ("kafka_alignment", r"(?i)kafka-alignment-suite|verify-kafka-cluster|kafka.?alignment"),
    ("observability_gates", r"(?i)observability|otel|step7"),
    ("strict_exit_rules", r"(?i)PREFLIGHT_STRICT_EXIT|strict.?exit|\bfail\s*\("),
    ("cluster_stability_guard", r"(?i)cluster-stability-guard\.sh|CLUSTER_GUARD_|CPU_IDLE"),
]


def strip_doc_header(text: str) -> str:
    """Drop leading comment banner until first non-# substantive line (max 200 lines)."""
    lines = text.splitlines()
    i = 0
    while i < len(lines) and i < 200:
        s = lines[i].strip()
        if s and not s.startswith("#"):
            break
        i += 1
    return "\n".join(lines[i:])


def normalize(text: str) -> str:
    t = strip_doc_header(text)
    out: list[str] = []
    for line in t.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        s = re.sub(r"(?i)off-campus-housing-tracker|record-platform", "NS", s)
        s = re.sub(r"(?i)off-campus-housing\.test|record\.test|record\.local", "HOST", s)
        s = re.sub(r"\s+", " ", s)
        out.append(s.lower())
    return "\n".join(out)


def fingerprint(text: str) -> str:
    return hashlib.sha256(normalize(text).encode("utf-8")).hexdigest()[:16]


def extract_signals(labelled_text: str) -> set[str]:
    found: set[str] = set()
    for key, pat in STRUCTURED_SIGNALS:
        if re.search(pat, labelled_text, re.I):
            found.add(key)
    return found


def count_matches(pat: str, text: str) -> int:
    return len(re.findall(pat, text, flags=re.I))


def has_errexit_early(text: str) -> str:
    head = text[:12000]
    return "yes" if re.search(r"set\s+-euo\s+pipefail", head, re.I) else "no"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--och-script", type=Path, required=True)
    ap.add_argument("--rp-script", type=Path, required=True)
    ap.add_argument("--stem", type=str, default="preflight")
    ap.add_argument("--output", type=Path, default=None)
    args = ap.parse_args()
    och = args.och_script.expanduser().resolve()
    rp = args.rp_script.expanduser().resolve()
    if not och.is_file() or not rp.is_file():
        print("Both --och-script and --rp-script must exist.", file=sys.stderr)
        return 2
    out = args.output or (Path.cwd() / "docs" / "bundles" / f"PREFLIGHT_BEHAVIORAL_DIFF_{args.stem}.md")

    o_raw = och.read_text(encoding="utf-8", errors="replace")
    r_raw = rp.read_text(encoding="utf-8", errors="replace")

    o_sig = extract_signals(o_raw)
    r_sig = extract_signals(r_raw)
    missing_blocks = sorted(x for x in o_sig - r_sig if x.startswith("phase_block:"))
    missing_other = sorted(x for x in o_sig - r_sig if not x.startswith("phase_block:"))
    added = sorted(r_sig - o_sig)

    lines = [
        f"# Preflight behavioral diff — `{args.stem}`",
        "",
        f"- **OCH (staging):** `{och}`",
        f"- **RP (repo):** `{rp}`",
        f"- **Fingerprint (normalized body, OCH):** `{fingerprint(o_raw)}`",
        f"- **Fingerprint (normalized body, RP):** `{fingerprint(r_raw)}`",
        "",
        "## Missing Phase Blocks",
    ]
    lines += [f"- `{m}`" for m in missing_blocks] or ["- _(none by signal heuristics)_"]

    lines += ["", "## Missing Barrier Conditions"]
    mb = [x for x in missing_other if "barrier" in x or "transport" in x or "kafka" in x or "jaeger" in x]
    lines += [f"- `{m}`" for m in mb] or ["- _(none beyond phase blocks)_"]
    if not mb and missing_other:
        lines += [f"- _(other missing signals: {', '.join(f'`{x}`' for x in missing_other)})_"]

    lines += ["", "## Missing Strict Gates"]
    strict_miss = [x for x in missing_other if "strict" in x]
    lines += [f"- `{m}`" for m in strict_miss] or ["- _(none)_"]

    lines += ["", "## Changed Exit Semantics"]
    _exit_pat = r"\bexit\s+1\b"
    _pluse_pat = r"set\s*\+e"
    o_exit1 = count_matches(_exit_pat, o_raw)
    r_exit1 = count_matches(_exit_pat, r_raw)
    o_pluse = count_matches(_pluse_pat, o_raw)
    r_pluse = count_matches(_pluse_pat, r_raw)
    lines.append(f"- **`exit 1` occurrences:** OCH={o_exit1} vs RP={r_exit1}")
    lines.append(
        f"- **`set +e` occurrences:** OCH={o_pluse} vs RP={r_pluse} "
        "(lower is stricter unless intentionally scoped)"
    )
    lines.append(
        f"- **`set -euo pipefail` in driver head:** OCH={has_errexit_early(o_raw)} vs RP={has_errexit_early(r_raw)}"
    )

    lines += ["", "## Added Logic in RP (signals present in RP, not in OCH)"]
    lines += [f"- `{a}`" for a in added] or ["- _(none)_"]

    lines += ["", "## Removed Logic in RP (signals present in OCH, not in RP)"]
    removed = sorted(o_sig - r_sig)
    lines += [f"- `{m}`" for m in removed] or ["- _(none)_"]

    lines += [
        "",
        "_Heuristic diff only — review both scripts for true behavioral parity._",
        "",
    ]

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
