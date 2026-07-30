#!/usr/bin/env python3
"""
RP namespace integrity linter (CI-friendly).

Forbidden historical literals are compared via SHA-256 only — raw tokens are not
stored in this repository. Writes reports/runtime/namespace-lint-report.json.
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

# SHA-256 of lowercase forbidden substrings (LEGACY_NAMESPACE_1 family).
FORBIDDEN_SHA256 = frozenset({
    "cc31fac3f71e9bf4e174207e628ff222a1dfcb23ce087e63aa13c1861b8c863e",  # prefix A
    "55cd49b74bf3313c7e88b417ced661c04b867f8e510bf64fdb0c70e9a4ff44e1",  # prefix B
    "459e4444021f14b4bc11e3f6bf7ff428f68a3bfc6203c5332da27bfaa38b4adc",  # prefix C
    "8ae163ed2b1cd473af869e55884e5288faa389074955e864fc0d869e149eab21",  # header prefix
    "c6ffe7c05ea0b0a98bafc969e74bbdeb2553d3d42dead013cfda93b16ba5dd0e",  # hostname family
    "ca3d4729dd15cdb834f33ca581e79b6b6d826a49421ba6995b771ae4ebe2630c",  # excluded peer A
    "bb47728c5edba01b0ff990987ac4f77c71c16ba2361ea09c10d0405ae8a4a2ca",  # excluded peer B
    "41fc53994dec5cc3ef8acda847d3ea8bfcb2d62ba65bf711b6ef64ac5ae0bd15",  # excluded peer C
})

# Sliding windows that could encode forbidden tokens (length range covers known tokens).
WINDOW_LENS = (3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21)

SKIP_DIR_NAMES = frozenset({
    ".git", "node_modules", "dist", "__pycache__", ".venv", "coverage",
    "generated", ".next", "build", "backups", "bench_logs",
})

TEXT_SUFFIXES = frozenset({
    ".yaml", ".yml", ".json", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".sh",
    ".md", ".toml", ".proto", ".py", ".txt", ".sql", ".conf",
})


@dataclass
class Violation:
    path: str
    rule: str
    line: int
    snippet: str


def load_allow_rules(repo: Path) -> tuple[list[str], list[str]]:
    p = repo / "tools" / "bundle-audit" / "rp_namespace_linter_allowlist.txt"
    if not p.is_file():
        return (["tools/bundle-audit/", "staging/"], [])
    prefixes: list[str] = []
    globs: list[str] = []
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if any(ch in line for ch in "*?["):
            globs.append(line)
        elif line.endswith("/"):
            prefixes.append(line)
        else:
            prefixes.append(line + "/")
    return (prefixes or ["tools/bundle-audit/", "staging/"], globs)


def is_allowlisted(rel_posix: str, prefixes: list[str], globs: list[str]) -> bool:
    if any(rel_posix == p.rstrip("/") or rel_posix.startswith(p) for p in prefixes):
        return True
    return any(fnmatch.fnmatch(rel_posix, g) for g in globs)


def is_probably_text(p: Path) -> bool:
    if p.suffix.lower() in TEXT_SUFFIXES:
        return True
    return p.name in ("Makefile", "Dockerfile", "Caddyfile", "package.json", "pnpm-workspace.yaml")


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def line_has_forbidden(line: str) -> bool:
    low = line.lower()
    # Word-boundary-ish: avoid false positives on unix_ts-style column names
    for n in WINDOW_LENS:
        for i in range(0, max(0, len(low) - n + 1)):
            window = low[i : i + n]
            if sha256_hex(window) in FORBIDDEN_SHA256:
                # require start at word-ish boundary for short prefixes
                if n <= 4:
                    prev = low[i - 1] if i > 0 else ""
                    if prev.isalnum():
                        continue
                return True
    return False


def scan(repo: Path) -> list[Violation]:
    prefixes, globs = load_allow_rules(repo)
    out: list[Violation] = []
    for path in repo.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIR_NAMES for part in path.parts):
            continue
        if any(part.startswith(".venv") for part in path.parts):
            continue
        try:
            rel = path.relative_to(repo).as_posix()
        except ValueError:
            continue
        if is_allowlisted(rel, prefixes, globs):
            continue
        if not is_probably_text(path):
            continue
        try:
            if path.stat().st_size > 2_000_000:
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for i, line in enumerate(text.splitlines(), 1):
            if line_has_forbidden(line):
                out.append(Violation(rel, "FORBIDDEN_NAMESPACE_HASH", i, line.strip()[:160]))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", type=Path, default=Path("."))
    ap.add_argument("--report", type=Path, default=Path("reports/runtime/namespace-lint-report.json"))
    args = ap.parse_args()
    repo = args.repo.resolve()
    violations = scan(repo)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "violations": [asdict(v) for v in violations],
        "count": len(violations),
        "forbidden_sha256_count": len(FORBIDDEN_SHA256),
    }
    args.report.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    if violations:
        print(f"namespace lint FAIL: {len(violations)} hit(s)", file=sys.stderr)
        for v in violations[:40]:
            print(f"{v.path}:{v.line}: {v.rule}", file=sys.stderr)
        return 1
    print("namespace lint PASS: 0 hits")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
