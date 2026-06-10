#!/usr/bin/env python3
"""
Emit a unified diff patch from a frozen staging tree (OCH → RP string rewrites).

Does NOT apply the patch or modify staging on disk — stdout / --output only.
Paths in the patch are relative to repository root (bundle top-level stripped when present).
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
from pathlib import Path

from bundle_audit_lib import detect_strip_prefix, disk_regular_files_sorted, strip_prefix
from conversion_matrix import load_replacements

MAX_FILE_BYTES = 1_000_000
MAX_REPLACEMENTS_PER_FILE = 200
BASE64_LINE_RE = re.compile(rb"^[A-Za-z0-9+/=\s]{200,}$")

DEFAULT_TEXT_SUFFIXES = frozenset(
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
        ".bash",
        ".mk",
    }
)


def is_probably_binary(raw: bytes) -> bool:
    if b"\x00" in raw[:8192]:
        return True
    return False


def line_looks_base64(line: str) -> bool:
    if len(line) < 200:
        return False
    return bool(BASE64_LINE_RE.match(line.encode("utf-8", errors="ignore")))


def forbidden_in_base64_line(line: str, needles: tuple[str, ...]) -> bool:
    if not line_looks_base64(line):
        return False
    return any(n in line for n in needles)


def apply_replacements(
    text: str,
    pairs: list[tuple[str, str]],
    needles_for_b64: tuple[str, ...],
) -> tuple[str, int] | tuple[None, int]:
    """Return (new_text, count) or (None, 0) if skipped (safety)."""
    for line in text.splitlines(keepends=True):
        if forbidden_in_base64_line(line.rstrip("\n"), needles_for_b64):
            return None, 0
    total = 0
    for old, new in pairs:
        if not old or old == new:
            continue
        total += text.count(old)
    if total > MAX_REPLACEMENTS_PER_FILE:
        return None, total
    out = text
    for old, new in pairs:
        if not old or old == new:
            continue
        out = out.replace(old, new)
    return out, total


def logical_repo_path(staging_rel: str, strip_p: str) -> str:
    logical = strip_prefix(staging_rel, strip_p)
    if logical in (".", ""):
        return ""
    return logical


def should_process_file(rel: str, include_md: bool) -> bool:
    p = Path(rel)
    suf = p.suffix.lower()
    name = p.name
    if "/certs/" in f"/{rel}/" or rel.startswith("certs/"):
        return False
    if suf in (".pem", ".crt", ".key", ".csr", ".jks", ".p12", ".pfx", ".der"):
        return False
    if "MANIFEST" in name.upper():
        return False
    if name in ("MANIFEST.sha256.txt", "MANIFEST.bundle-audit.txt"):
        return False
    if suf in DEFAULT_TEXT_SUFFIXES or name in ("Makefile", "makefile"):
        return True
    if include_md and suf == ".md":
        return True
    if not suf and name == "Makefile":
        return True
    return False


def generate_patch(
    staging: Path,
    matrix: Path,
    include_md: bool,
) -> str:
    rels = disk_regular_files_sorted(staging)
    strip_p = detect_strip_prefix(rels)
    pairs = load_replacements(matrix)
    needles = tuple({a for a, _ in pairs if "off-campus" in a or "och" in a.lower()})

    hunks: list[str] = []
    for rel in rels:
        if not should_process_file(rel, include_md):
            continue
        logical = logical_repo_path(rel, strip_p)
        if not logical:
            continue
        fp = staging / rel
        try:
            raw = fp.read_bytes()
        except OSError:
            continue
        if len(raw) > MAX_FILE_BYTES or is_probably_binary(raw):
            continue
        try:
            original = raw.decode("utf-8")
        except UnicodeDecodeError:
            original = raw.decode("utf-8", errors="replace")

        new_text, _n = apply_replacements(original, pairs, needles)
        if new_text is None or new_text == original:
            continue
        if logical.endswith(".json"):
            try:
                json.loads(new_text)
            except json.JSONDecodeError:
                continue
        diff_lines = list(
            difflib.unified_diff(
                original.splitlines(keepends=True),
                new_text.splitlines(keepends=True),
                fromfile=f"a/{logical}",
                tofile=f"b/{logical}",
                lineterm="",
            )
        )
        if not diff_lines:
            continue
        # difflib may omit final newline; ensure patch ends with newline between files
        body = "".join(diff_lines)
        if not body.endswith("\n"):
            body += "\n"
        hunks.append(body)
    header = (
        "# OCH → RP namespace patch (generated; NOT applied)\n"
        f"# Matrix: {matrix}\n"
        f"# Staging: {staging.resolve()}\n"
        "# Review with: git apply --check <this-file>\n"
        "\n"
    )
    return header + "\n".join(hunks)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--staging-dir", type=Path, required=True)
    ap.add_argument("--conversion-matrix", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--include-md", action="store_true", help="Include .md files (noisy)")
    args = ap.parse_args()
    staging = args.staging_dir.expanduser().resolve()
    matrix = args.conversion_matrix.expanduser().resolve()
    if not staging.is_dir():
        print(f"Not a directory: {staging}", file=sys.stderr)
        return 2
    if not matrix.is_file():
        print(f"Matrix not found: {matrix}", file=sys.stderr)
        return 2
    patch = generate_patch(staging, matrix, args.include_md)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(patch, encoding="utf-8")
    print(f"Wrote {args.output} ({len(patch)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
