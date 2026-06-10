#!/usr/bin/env python3
"""
Structural integrity checks for preflight wiring (no cluster, no kubectl).

- Collects `scripts/...sh` references from the preflight driver + Makefile
- Verifies files exist
- Flags legacy OCH script path tokens
- Spot-checks trace-validators, observability / TLS / transport / secret-audit tools
- Informational: lists `PREFLIGHT_*`-style vars expanded in the body but absent from the
  contiguous leading `#` banner (for doc drift review; not a hard failure)
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

PREFLIGHT_DEFAULT = "scripts/run-preflight-scale-and-all-suites.sh"

DOC_VAR_PREFIXES = ("PREFLIGHT_", "CLUSTER_GUARD_", "PHASE_BARRIER_", "TRANSPORT_STUDY_", "JAEGER_")


def extract_script_refs_from_shell(text: str) -> set[str]:
    refs = set(re.findall(r"\bscripts/[a-zA-Z0-9_./-]+\.sh\b", text))
    for m in re.finditer(r"\b(?:bash|source)\s+[\"']?([^\"'\s]+\.sh)[\"']?", text):
        p = m.group(1).strip('"').lstrip("./")
        if p.startswith("scripts/"):
            refs.add(p)
    return refs


def makefile_script_refs(makefile_text: str) -> set[str]:
    refs: set[str] = set()
    for m in re.finditer(r"\$\(SCRIPTS\)/([a-zA-Z0-9_./-]+\.sh)", makefile_text):
        refs.add(f"scripts/{m.group(1)}")
    for m in re.finditer(r"bash\s+\$\(SCRIPTS\)/([a-zA-Z0-9_./-]+\.sh)", makefile_text):
        refs.add(f"scripts/{m.group(1)}")
    return refs


def makefile_target_script_refs(makefile_text: str) -> set[str]:
    """Recipes that invoke bash on a path under scripts/."""
    refs: set[str] = set()
    for m in re.finditer(r"bash\s+[^\n]*?(scripts/[a-zA-Z0-9_./-]+\.sh)", makefile_text):
        refs.add(m.group(1))
    return refs


def leading_comment_banner(text: str, max_lines: int = 400) -> str:
    lines = text.splitlines()[:max_lines]
    out: list[str] = []
    for ln in lines:
        if ln.strip().startswith("#") or not ln.strip():
            out.append(ln)
        else:
            break
    return "\n".join(out)


def undocumented_preflight_vars(preflight_text: str) -> list[str]:
    banner = leading_comment_banner(preflight_text)
    used: set[str] = set()
    for m in re.finditer(r"\$\{([A-Z][A-Z0-9_]+)", preflight_text):
        name = m.group(1)
        if name.startswith(DOC_VAR_PREFIXES):
            used.add(name)
    missing: list[str] = []
    for v in sorted(used):
        if v not in banner:
            missing.append(v)
    return missing


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repo-root", type=Path, default=Path.cwd())
    ap.add_argument("--preflight-script", type=Path, default=None)
    ap.add_argument("--output", type=Path, default=None)
    args = ap.parse_args()
    repo = args.repo_root.resolve()
    pre = args.preflight_script or (repo / PREFLIGHT_DEFAULT)
    out = args.output or (repo / "docs" / "bundles" / "PREFLIGHT_STATIC_CONTRACT_REPORT.md")
    if not pre.is_file():
        print(f"Missing {pre}", file=sys.stderr)
        return 2

    pf = pre.read_text(encoding="utf-8", errors="replace")
    mk = (repo / "Makefile").read_text(encoding="utf-8", errors="replace") if (repo / "Makefile").is_file() else ""

    all_refs = extract_script_refs_from_shell(pf) | makefile_script_refs(mk) | makefile_target_script_refs(mk)

    issues: list[str] = []
    for rel in sorted(all_refs):
        if "och-" in rel.lower() or "/och" in rel.lower():
            issues.append(f"Legacy OCH path still referenced: `{rel}`")
            continue
        p = repo / rel
        if not p.is_file():
            issues.append(f"Missing script: `{rel}`")

    trace_dir = repo / "scripts" / "trace-validators"
    trace_ok = trace_dir.is_dir() and any(trace_dir.glob("*.mjs"))

    obs_scripts = [
        repo / "scripts" / "trace-validators" / "run-step7-observability-gates.mjs",
        repo / "scripts" / "service-tls-alias-guard.sh",
        repo / "scripts" / "preflight-controlled-transport-otel-prove.sh",
        repo / "scripts" / "verify-jaeger-trace-flows.mjs",
    ]
    obs_missing = [str(s.relative_to(repo)) for s in obs_scripts if not s.is_file()]

    audit_tool = repo / "tools" / "bundle-audit" / "secret_name_alignment_audit.py"
    if not audit_tool.is_file():
        issues.append("Missing `tools/bundle-audit/secret_name_alignment_audit.py`")

    och_path_hits = sorted(set(re.findall(r"scripts/[a-zA-Z0-9_./-]*och[a-zA-Z0-9_./-]*\.sh", pf, re.I)))

    undoc = undocumented_preflight_vars(pf)
    env_info = [f"`{v}` — used as `${{…}}` in body; not spelled in contiguous leading `#` block" for v in undoc[:40]]
    if len(undoc) > 40:
        env_info.append(f"_…{len(undoc) - 40} more (informational only; not a hard failure)_")

    lines = [
        "# Preflight static contract report",
        "",
        f"**Preflight:** `{pre.relative_to(repo)}`",
        "",
        "## Referenced scripts (heuristic union)",
        "",
        f"- Count: **{len(all_refs)}** (preflight + `$(SCRIPTS)/` + Makefile `bash scripts/...`)",
        "",
        "## Missing files / legacy OCH paths",
    ]
    if issues:
        lines += [f"- {m}" for m in issues]
    else:
        lines.append("- _(none)_")

    lines += [
        "",
        "## Environment documentation (leading banner)",
        "",
        "Informational heuristic: `${VAR` expansions for "
        + ", ".join(f"`{p}*`" for p in DOC_VAR_PREFIXES)
        + " that do not appear in the contiguous leading `#` block (often OK when documented later in-file).",
        "",
    ]
    if env_info and undoc:
        lines += [f"- {m}" for m in env_info]
    else:
        lines.append("- _(none — or no matching `${VAR` expansions in body)_")

    lines += [
        "",
        "## Trace validators",
        "",
        f"- `scripts/trace-validators/` with `.mjs`: **{'yes' if trace_ok else 'no'}**",
        "",
        "## Observability / TLS / transport (spot checks)",
    ]
    if obs_missing:
        lines += [f"- **MISSING:** `{m}`" for m in obs_missing]
    else:
        lines.append("- _(all spot-check paths present)_")

    lines += [
        "",
        "## Secret alignment audit tool",
        "",
        f"- `tools/bundle-audit/secret_name_alignment_audit.py`: **{'present' if audit_tool.is_file() else 'MISSING'}**",
        "",
        "## OCH path tokens inside preflight body",
    ]
    lines += [f"- `{h}`" for h in och_path_hits] or ["- _(none)_"]
    lines.append("")

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    n_issues = len(issues) + len(obs_missing) + len(och_path_hits) + (0 if audit_tool.is_file() else 1)
    print(f"Wrote {out} issues={n_issues} undocumented_vars_info={len(undoc)}")
    return 1 if n_issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
