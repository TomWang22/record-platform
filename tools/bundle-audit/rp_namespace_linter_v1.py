#!/usr/bin/env python3
"""
RP namespace / OCH residue linter for the monorepo (CI-friendly).

Skips path prefixes in `tools/bundle-audit/rp_namespace_linter_allowlist.txt`.
Writes docs/bundles/RP_NAMESPACE_LINT_REPORT.json and exits 1 on violations.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

# Case-sensitive: avoids flagging prose like "OCH-style" while still catching secret-style `och-*` tokens.
OCH_TOKEN = re.compile(r"\boch-[a-z][a-z0-9-]*\b")

# Legacy secret material / uppercase hyphenated OCH TLS names (CI must reject).
OCH_SECRET_LITERAL = re.compile(
    r"(?i)(och-kafka-ssl-secret|och-service-tls|och-[a-z0-9-]*-tls\b|"
    r"\bsecretName:\s*[^\n#]*och[-_]|\bsecretKeyRef:\s*[^\n#]*och[-_])"
)
OCH_UPPER_HYPHEN = re.compile(r"\bOCH-[A-Z0-9-]+\b")

# secretRef / env-style OCH secret identifiers (infra/scripts/services/Makefile only via mode_for_path).
OCH_SECRET_REF = re.compile(
    r"(?i)(\bsecretRef\b|\bsecretKeyRef\b|\bsecretName\b)\s*:\s*[^\n#]*\boch[-_]"
)
OCH_UPPER_UNDERSCORE_SECRETISH = re.compile(
    r"\bOCH_[A-Z0-9_]*(?:SECRET|TLS|SSL|CERT|MTLS|JKS|KEYSTORE|TRUSTSTORE)[A-Z0-9_]*\b"
)

SKIP_DIR_NAMES = frozenset(
    {
        ".git",
        "node_modules",
        "dist",
        "__pycache__",
        ".venv",
        "coverage",
        "generated",
        ".next",
        "build",
    }
)

TEXT_SUFFIXES = frozenset(
    {
        ".yaml",
        ".yml",
        ".json",
        ".ts",
        ".tsx",
        ".js",
        ".mjs",
        ".cjs",
        ".sh",
        ".md",
        ".toml",
        ".mod",
        ".sum",
        ".proto",
    }
)


@dataclass
class Violation:
    path: str
    rule: str
    line: int
    snippet: str


def load_allow_rules(repo: Path) -> tuple[list[str], list[str]]:
    """Return (directory prefixes ending with /, path glob patterns)."""
    p = repo / "tools" / "bundle-audit" / "rp_namespace_linter_allowlist.txt"
    if not p.is_file():
        return (["docs/", "tools/bundle-audit/", "staging/"], [])
    prefixes: list[str] = []
    globs: list[str] = []
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "*" in line or "?" in line or "[" in line:
            globs.append(line)
        elif line.endswith("/"):
            prefixes.append(line)
        else:
            prefixes.append(line + "/")
    return (
        prefixes or ["docs/", "tools/bundle-audit/", "staging/"],
        globs,
    )


def is_allowlisted(rel_posix: str, prefixes: list[str], globs: list[str]) -> bool:
    if any(rel_posix == p.rstrip("/") or rel_posix.startswith(p) for p in prefixes):
        return True
    return any(fnmatch.fnmatch(rel_posix, g) for g in globs)


def is_probably_text(p: Path) -> bool:
    suf = p.suffix.lower()
    if suf in TEXT_SUFFIXES:
        return True
    if p.name in ("Makefile", "Dockerfile", "Caddyfile", "package.json", "pnpm-workspace.yaml"):
        return True
    return False


def mode_for_path(rel: str) -> str:
    """full = forbidden substrings + och-* tokens; hosts = forbidden substrings only."""
    if "node_modules" in rel:
        return "hosts"
    if rel.startswith(("infra/", "scripts/", "services/")):
        return "full"
    if rel in ("Makefile", "package.json", "Caddyfile"):
        return "full"
    if rel.endswith("/Makefile") or rel.endswith("/package.json"):
        return "full"
    return "hosts"


def scan_lines(rel: str, text: str, mode: str) -> list[Violation]:
    viol: list[Violation] = []
    for i, line in enumerate(text.splitlines(), start=1):
        ll = line.lower()
        if "off-campus-housing-tracker" in ll:
            viol.append(Violation(rel, "forbidden_namespace_tracker", i, line.strip()[:240]))
        if "off-campus-housing.test" in ll:
            viol.append(Violation(rel, "forbidden_sni_test", i, line.strip()[:240]))
        if "off-campus-housing.local" in ll:
            viol.append(Violation(rel, "forbidden_sni_local", i, line.strip()[:240]))
        if mode == "full":
            if OCH_TOKEN.search(line):
                viol.append(Violation(rel, "och_prefix_token", i, line.strip()[:240]))
            if OCH_SECRET_LITERAL.search(line):
                viol.append(Violation(rel, "och_secret_literal", i, line.strip()[:240]))
            if OCH_UPPER_HYPHEN.search(line):
                viol.append(Violation(rel, "och_upper_hyphen_token", i, line.strip()[:240]))
            if OCH_SECRET_REF.search(line):
                viol.append(Violation(rel, "och_secret_ref", i, line.strip()[:240]))
            if OCH_UPPER_UNDERSCORE_SECRETISH.search(line):
                viol.append(Violation(rel, "och_upper_underscore_secretish", i, line.strip()[:240]))
    return viol


def k8s_namespace_off_campus(path: Path, rel: str) -> list[Violation]:
    if not rel.startswith("infra/k8s/") or path.suffix.lower() not in (".yaml", ".yml"):
        return []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out: list[Violation] = []
    for i, line in enumerate(lines, start=1):
        if "namespace:" in line and "off-campus" in line.lower():
            out.append(Violation(rel, "k8s_namespace_off_campus", i, line.strip()[:240]))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repo-root", type=Path, default=Path.cwd())
    ap.add_argument("--report", type=Path, default=None)
    args = ap.parse_args()
    repo = args.repo_root.resolve()
    report_path = args.report or (repo / "docs" / "bundles" / "RP_NAMESPACE_LINT_REPORT.json")
    prefixes, glob_patterns = load_allow_rules(repo)

    violations: list[Violation] = []
    for root, dirs, files in os.walk(repo, topdown=True):
        dirs[:] = [d for d in dirs if d not in SKIP_DIR_NAMES]
        for fn in files:
            fp = Path(root) / fn
            try:
                rel = fp.relative_to(repo).as_posix()
            except ValueError:
                continue
            if "node_modules" in rel or "/dist/" in f"/{rel}/":
                continue
            if rel.endswith("docs/bundles/RP_NAMESPACE_LINT_REPORT.json"):
                continue
            if is_allowlisted(rel, prefixes, glob_patterns):
                continue
            if not is_probably_text(fp):
                continue
            try:
                raw = fp.read_bytes()
            except OSError:
                continue
            if len(raw) > 2_000_000 or b"\x00" in raw[:4096]:
                continue
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError:
                text = raw.decode("utf-8", errors="replace")
            mode = mode_for_path(rel)
            violations.extend(scan_lines(rel, text, mode))
            violations.extend(k8s_namespace_off_campus(fp, rel))

    seen: set[tuple[str, str, int, str]] = set()
    deduped: list[Violation] = []
    for v in violations:
        key = (v.path, v.rule, v.line, v.snippet)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(v)

    report = {
        "repo_root": str(repo),
        "allow_prefixes": prefixes,
        "allow_globs": glob_patterns,
        "violation_count": len(deduped),
        "violations": [asdict(v) for v in deduped[:5000]],
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Wrote {report_path} violations={len(deduped)}")
    if deduped:
        for v in deduped[:40]:
            print(f"{v.rule}\t{v.path}:{v.line}", file=sys.stderr)
        if len(deduped) > 40:
            print(f"... and {len(deduped) - 40} more", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
