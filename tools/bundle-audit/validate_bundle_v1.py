#!/usr/bin/env python3
"""Pre-extract structural validation for Bundle Extraction Protocol v1 (tar index only).

Enforces: no traversal, no absolute paths, no device nodes, no hardlinks,
symlinks only if resolved target stays inside the archive root (single top-level dir or flat).
"""

from __future__ import annotations

import argparse
import json
import posixpath
import re
import sys
import tarfile
from pathlib import Path, PurePosixPath

from bundle_audit_lib import normalize_member, skip_manifest_noise, tar_regular_files_sorted


def path_traversal(parts: list[str]) -> bool:
    """True if '..' would escape when walking from an empty anchor (unsafe)."""
    depth = 0
    for p in parts:
        if p in ("", "."):
            continue
        if p == "..":
            depth -= 1
            if depth < 0:
                return True
        else:
            depth += 1
    return False


def skip_metadata_name(name: str) -> bool:
    n = name.replace("\\", "/")
    if re.search(r"(^|/)(__MACOSX|PaxHeaders)(/|$)", n):
        return True
    if n == "pax_global_header" or n.startswith("PaxHeader/") or n.startswith("./PaxHeader/"):
        return True
    if n.endswith(".DS_Store"):
        return True
    return False


def symlink_resolves_safely(member_name: str, linkname: str, archive_roots: frozenset[str]) -> bool:
    """Symlink target must not be absolute; normalized path must stay under the single archive root."""
    if not linkname or linkname.startswith("/"):
        return False
    if not archive_roots:
        return False
    parent = posixpath.dirname(member_name)
    combined = posixpath.normpath(parent + "/" + linkname)
    if posixpath.isabs(combined) or combined.startswith("../"):
        return False
    return any(combined == r or combined.startswith(r + "/") for r in archive_roots)


def collect_top_level_roots(members: list[tarfile.TarInfo]) -> set[str]:
    roots: set[str] = set()
    for m in members:
        if not m.isfile() and not m.isdir() and not m.issym():
            continue
        n = normalize_member(m.name)
        if skip_metadata_name(n) or skip_manifest_noise(n) or not n:
            continue
        parts = PurePosixPath(n).parts
        if parts:
            roots.add(parts[0])
    # AppleDouble / metadata peers (e.g. `_record-platform-…` next to real root)
    filtered = {r for r in roots if not r.startswith("_")}
    return filtered if filtered else roots


def symlink_anchor_roots(roots: set[str]) -> frozenset[str]:
    """Only single-root bundles may contain symlinks (targets stay under that root)."""
    if len(roots) == 1:
        return frozenset(roots)
    return frozenset()


def iter_non_skip_members(tf: tarfile.TarFile) -> list[tarfile.TarInfo]:
    out: list[tarfile.TarInfo] = []
    for m in tf.getmembers():
        n = normalize_member(m.name)
        if skip_metadata_name(n):
            continue
        out.append(m)
    return out


def validate_archive(path: Path) -> dict:
    report: dict = {
        "archive": str(path),
        "safe": True,
        "issues": [],
        "warnings": [],
        "file_members": [],
        "root_layout": None,
    }
    with tarfile.open(path, "r:*") as tf:
        members = iter_non_skip_members(tf)
        top_roots = collect_top_level_roots(members)
        roots = symlink_anchor_roots(top_roots)
        if len(top_roots) == 1:
            report["root_layout"] = {"type": "single_top_level", "root": next(iter(top_roots))}
        elif len(top_roots) > 1:
            report["root_layout"] = {"type": "mixed_top_level", "roots_sample": sorted(top_roots)[:20]}
        else:
            report["root_layout"] = {"type": "empty_or_metadata_only"}

        for m in members:
            name = normalize_member(m.name)
            if not name:
                continue
            parts = PurePosixPath(name).parts
            if path_traversal(parts):
                report["safe"] = False
                report["issues"].append(f"path_traversal:{name}")
            if name.startswith("/") or m.name.startswith("/"):
                report["safe"] = False
                report["issues"].append(f"absolute_path:{name}")
            if m.issym():
                if not roots:
                    report["safe"] = False
                    report["issues"].append(f"symlink_disallowed_mixed_layout:{name}->{m.linkname!r}")
                elif not symlink_resolves_safely(name, m.linkname or "", roots):
                    report["safe"] = False
                    report["issues"].append(f"unsafe_symlink:{name}->{m.linkname!r}")
                else:
                    report["warnings"].append(f"symlink_allowed:{name}->{m.linkname!r}")
            if m.isdev() or getattr(m, "ischr", lambda: False)() or getattr(m, "isblk", lambda: False)():
                report["safe"] = False
                report["issues"].append(f"device_node:{name}")
            if m.islnk():
                report["safe"] = False
                report["issues"].append(f"hardlink:{name}")

    report["file_members"] = tar_regular_files_sorted(path)
    return report


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("archive", type=Path)
    ap.add_argument("--json-out", type=Path, default=None, help="Write full JSON report")
    ap.add_argument("--emit-manifest-files", type=Path, default=None, help="Sorted tar file index (normalized paths)")
    args = ap.parse_args()
    path = args.archive.expanduser().resolve()
    if not path.is_file():
        print(json.dumps({"safe": False, "issues": [f"not_found:{path}"]}), file=sys.stderr)
        return 2
    report = validate_archive(path)
    if args.emit_manifest_files:
        args.emit_manifest_files.parent.mkdir(parents=True, exist_ok=True)
        args.emit_manifest_files.write_text(
            "\n".join(report["file_members"]) + ("\n" if report["file_members"] else ""),
            encoding="utf-8",
        )
    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        # file_members can be large — optional strip for summary copy
        slim = {k: v for k, v in report.items() if k != "file_members"}
        slim["file_member_count"] = len(report["file_members"])
        args.json_out.write_text(json.dumps(slim, indent=2), encoding="utf-8")
    stdout_view = {k: v for k, v in report.items() if k != "file_members"}
    stdout_view["file_member_count"] = len(report["file_members"])
    print(json.dumps(stdout_view, indent=2))
    return 0 if report["safe"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
