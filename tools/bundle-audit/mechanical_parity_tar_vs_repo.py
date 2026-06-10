#!/usr/bin/env python3
"""Stage-1 forensic index: tar member paths vs repo existence (no extraction)."""

from __future__ import annotations

import argparse
import sys
import tarfile
from pathlib import Path

from bundle_audit_lib import (
    detect_strip_prefix,
    normalize_member,
    resolve_repo_relative,
    should_skip_member,
    strip_prefix,
)


def iter_tar_members(tar_path: Path) -> list[str]:
    out: list[str] = []
    with tarfile.open(tar_path, "r:*") as tf:
        for m in tf.getmembers():
            if not m.isfile() and not m.isdir():
                continue
            n = normalize_member(m.name)
            if should_skip_member(n):
                continue
            out.append(n)
    return out


def repo_has(repo: Path, rel: str) -> bool:
    if rel in (".", ""):
        return True
    mapped = resolve_repo_relative(rel)
    p = repo / mapped
    return p.exists()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("tarball", type=Path, help="Path to .tar.gz")
    ap.add_argument("--repo", type=Path, default=Path.cwd(), help="Repo root")
    ap.add_argument("--json", action="store_true", help="Print JSON summary to stdout")
    args = ap.parse_args()
    tar_path = args.tarball.expanduser().resolve()
    repo = args.repo.expanduser().resolve()
    if not tar_path.is_file():
        print(f"Not a file: {tar_path}", file=sys.stderr)
        return 2
    members = iter_tar_members(tar_path)
    prefix = detect_strip_prefix(members)
    checked: list[str] = []
    missing: list[str] = []
    for m in members:
        rel = strip_prefix(m, prefix)
        if rel == ".":
            continue
        checked.append(rel)
        if not repo_has(repo, rel):
            missing.append(rel)

    stem = tar_path.name
    if args.json:
        import json

        print(
            json.dumps(
                {
                    "tarball": str(tar_path),
                    "stripped_prefix": prefix.rstrip("/") or None,
                    "checked": len(checked),
                    "missing": len(missing),
                },
                indent=2,
            )
        )
        return 0

    print(f"# mechanical_parity: {stem}")
    print(f"repo: {repo}")
    print(f"stripped_prefix: {prefix!r}")
    print(f"checked_paths: {len(checked)}")
    print(f"missing_in_repo: {len(missing)}")
    for p in sorted(missing)[:200]:
        print(f"  MISSING {p}")
    if len(missing) > 200:
        print(f"  ... and {len(missing) - 200} more")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
