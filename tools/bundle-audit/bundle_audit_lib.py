"""Shared helpers for tarball staging vs repo analysis (bundle ingestion policy)."""

from __future__ import annotations

import os
import re
import tarfile
from pathlib import Path, PurePosixPath

# If every member shares one first path segment and it is not a normal repo root, strip it.
_REPO_TOP_LEVEL = frozenset(
    {
        "scripts",
        "infra",
        "services",
        "docs",
        "webapp",
        "tests",
        "testd",
        "tools",
        "schemas",
        "monitoring",
        "proto",
        "docker",
        "certs",
        "packages",
        "apps",
        "e2e",
        "load",
        "Makefile",
        "package.json",
        "pnpm-workspace.yaml",
        "Caddyfile",
        "README.md",
        "AGENTS.md",
        "ENGINEERING.md",
    }
)

_SKIP_NAME_PARTS = re.compile(
    r"(^|/)(__MACOSX|PaxHeaders)(/|$)|\.DS_Store$|/__pycache__/|\.pyc$"
)

# Tarballs sometimes place these at repo root; canonical in-tree paths differ.
REPO_PATH_ALIASES: dict[str, str] = {
    "PREFLIGHT_CLUSTER_QUIC_BUNDLE.txt": "docs/bundles/PREFLIGHT_CLUSTER_QUIC_BUNDLE.txt",
    "RECORD_PLATFORM_PREFLIGHT_KAFKA_OPS_SETUP.md": "docs/bundles/RECORD_PLATFORM_PREFLIGHT_KAFKA_OPS_SETUP.md",
    "docs/preflight-quic-step-grep.txt": "docs/bundles/preflight-quic-step-grep.txt",
}


def resolve_repo_relative(logical: str) -> str:
    return REPO_PATH_ALIASES.get(logical, logical)


def normalize_member(name: str) -> str:
    """Strip only a leading `./` prefix — never strip `.` from hidden files (`.nvmrc`)."""
    p = name.replace("\\", "/")
    if p.startswith("./"):
        p = p[2:]
    while p.endswith("/") and len(p) > 1:
        p = p[:-1]
    return p


def should_skip_member(norm: str) -> bool:
    if not norm or norm == ".":
        return True
    if _SKIP_NAME_PARTS.search(norm):
        return True
    return False


_APPLEDOUBLE_FILE = re.compile(r"(^|/)\._[^/]+$")


def skip_manifest_noise(norm: str) -> bool:
    """AppleDouble / macOS resource peers — often absent on disk after extract; omit from lossless manifests."""
    if should_skip_member(norm):
        return True
    n = norm.replace("\\", "/")
    if n.startswith("_record-platform"):
        return True
    if _APPLEDOUBLE_FILE.search(n):
        return True
    # Root AppleDouble `._.nvmrc`, `._Makefile`, etc.
    if n.startswith("._") and len(n) > 2:
        return True
    # Flat-bundle resource-fork peers: `_Makefile`, `_.nvmrc`, etc. (single path segment, leading `_`, not `._`)
    parts = PurePosixPath(n).parts
    if len(parts) == 1 and parts[0].startswith("_") and not parts[0].startswith("._"):
        return True
    return False


def disk_regular_files_sorted(staging: Path) -> list[str]:
    """Sorted relpaths of regular files under staging (noise filtered)."""
    out: list[str] = []
    for dirpath, dirnames, filenames in os.walk(staging):
        dirnames[:] = [d for d in dirnames if d not in ("__MACOSX", ".git") and not d.startswith("PaxHeaders")]
        for fn in filenames:
            if fn == "MANIFEST.sha256.txt":
                continue
            fp = Path(dirpath) / fn
            if not fp.is_file() or fp.is_symlink():
                continue
            rel = str(fp.relative_to(staging)).replace("\\", "/")
            n = normalize_member(rel)
            if skip_manifest_noise(n):
                continue
            out.append(n)
    return sorted(set(out))


def tar_regular_files_sorted(archive: Path) -> list[str]:
    """Sorted paths of regular-file tar members (AppleDouble-neutral manifest contract)."""
    out: list[str] = []
    with tarfile.open(archive, "r:*") as tf:
        for m in tf.getmembers():
            n = normalize_member(m.name)
            if skip_manifest_noise(n):
                continue
            if m.isfile() or m.type in (tarfile.REGTYPE, tarfile.AREGTYPE):
                out.append(n)
    return sorted(set(out))


def detect_strip_prefix(paths: list[str]) -> str:
    """Return prefix like 'folder/' to strip from bundle-relative paths, or ''."""
    if not paths:
        return ""
    firsts: set[str] = set()
    for p in paths:
        parts = PurePosixPath(p).parts
        if not parts:
            continue
        firsts.add(parts[0])
    if len(firsts) != 1:
        return ""
    (top,) = tuple(firsts)
    if top in _REPO_TOP_LEVEL:
        return ""
    # Single synthetic root folder (snapshot layout)
    return f"{top}/"


def strip_prefix(path: str, prefix: str) -> str:
    if not prefix:
        return path
    if path == prefix.rstrip("/"):
        return "."
    if path.startswith(prefix):
        return path[len(prefix) :].lstrip("/") or "."
    return path


def classify_path(rel: str) -> str:
    """Policy bucket for triage (see docs/bundles/BUNDLE_INGESTION_POLICY.md)."""
    r = rel.lower()
    if any(
        x in r
        for x in (
            "__macosx",
            "paxheaders",
            ".ds_store",
            "manifest.txt",
            "readme_bundle",
            "make-fragments/",
            "readme-bundle",
        )
    ):
        return "bundle_only_scaffolding"
    if r.startswith("manifold") or "bundle.txt" in r:
        return "bundle_only_scaffolding"
    if re.search(r"(^|/)package-.*-bundle\.sh$", r) or "rebuild-all-record-platform" in r:
        return "packaging_helper"
    if r.startswith("monitoring/") or "/grafana" in r or "prometheus" in r or "otel" in r or "/observability" in r:
        return "observability"
    if r.startswith("services/") or r.startswith("webapp/"):
        return "service_or_app"
    if r.startswith("scripts/") or r.startswith("infra/") or r.startswith("tools/"):
        return "infra_script"
    if r.startswith("docs/") or r.endswith(".md"):
        return "infra_script" if "runbook" in r or "kafka" in r or "preflight" in r else "optional_docs"
    if r.startswith("docker/") or r.startswith("certs/") or "caddy" in r or "kafka" in r or "kustomization" in r:
        return "runtime_critical"
    return "optional_other"
