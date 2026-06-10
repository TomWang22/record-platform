#!/usr/bin/env python3
"""
Read-only scan of a frozen staging tree for OCH identifiers vs Record Platform naming.

Does NOT modify staging, tarballs, or repo — emits docs/bundles/OCH_TO_RP_REWRITE_<stem>.md only.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

# Text-ish extensions (skip obvious binaries; still sniff small unknown as text)
TEXT_SUFFIXES = frozenset(
    {
        ".sh",
        ".bash",
        ".yaml",
        ".yml",
        ".md",
        ".txt",
        ".json",
        ".toml",
        ".env",
        ".properties",
        ".ts",
        ".tsx",
        ".js",
        ".mjs",
        ".cjs",
        ".mts",
        ".cts",
        ".proto",
        ".tf",
        ".hcl",
        ".Makefile",
        ".mk",
        ".mod",
        ".sum",
        ".html",
        ".css",
        ".graphql",
        ".sql",
        ".xml",
        ".cnf",
        ".conf",
        ".cfg",
        ".ini",
        ".tpl",
        ".gotmpl",
        ".dockerfile",
    }
)

SKIP_NAMES = frozenset(
    {
        "MANIFEST.sha256.txt",
        "MANIFEST.bundle-audit.txt",
    }
)


@dataclass
class Hit:
    path: str
    line_no: int
    snippet: str


@dataclass
class Section:
    title: str
    hits: list[Hit] = field(default_factory=list)


def is_probably_text(p: Path) -> bool:
    suf = p.suffix.lower()
    if suf in TEXT_SUFFIXES:
        return True
    name = p.name.lower()
    if name in ("makefile", "dockerfile", "caddyfile", "gemfile", "rakefile"):
        return True
    if not suf and p.stat().st_size < 256_000:
        return True
    return False


def read_lines(path: Path) -> list[str] | None:
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    if b"\x00" in raw[:4096]:
        return None
    if len(raw) > 4_000_000:
        return None
    try:
        return raw.decode("utf-8").splitlines()
    except UnicodeDecodeError:
        try:
            return raw.decode("utf-8", errors="replace").splitlines()
        except Exception:
            return None


# (section_key, title, regex, description)
RULES: list[tuple[str, str, re.Pattern[str], str]] = [
    (
        "namespace",
        "Namespace references",
        re.compile(
            r"(off-campus-housing-tracker|off-campus-housing\b|"
            r"namespace:\s*off-campus-housing[^\s#]*|"
            r"\"namespace\"\s*:\s*\"off-campus-housing[^\"]*\")",
            re.I,
        ),
        "Kubernetes / config namespace strings",
    ),
    (
        "sni_host",
        "SNI / hostnames",
        re.compile(
            r"(off-campus-housing\.test|off-campus-housing\.local|"
            r"\.off-campus-housing\.|"
            r"https?://[^\s'\"]*off-campus-housing[^\s'\"]*)",
            re.I,
        ),
        "Hosts, URLs, and dotted domains",
    ),
    (
        "och_tokens",
        "OCH-prefixed identifiers",
        re.compile(
            r"\b(och-kafka-ssl-secret|och-preflight|och-gateway|och_[a-z0-9_]+|och-[a-z0-9][a-z0-9-]*)\b",
            re.I,
        ),
        "Secrets, services, env keys with och- / och_",
    ),
    (
        "k8s_namespace_line",
        "K8s `namespace:` lines (YAML)",
        re.compile(r"^\s*namespace:\s*off-campus-housing[^\n#]*", re.I | re.M),
        "Raw namespace: declarations",
    ),
    (
        "cert_san",
        "Cert / SAN hints",
        re.compile(
            r"(dns:off-campus-housing|DNS:off-campus-housing|CN\s*=\s*[^\n]*off-campus-housing|"
            r"subjectAltName[^\n]*off-campus-housing)",
            re.I,
        ),
        "x509-ish strings mentioning OCH hosts",
    ),
    (
        "ports",
        "Hardcoded gateway / legacy ports",
        re.compile(
            r"(api-gateway\s*:\s*402[0-9]|:\s*402[0-9]\b|"
            r"\b4020\b|\"4020\"|'4020'|PORT[=:]\s*4020)",
            re.I,
        ),
        "4020-style ports (RP api-gateway default is :4000)",
    ),
    (
        "housing_env",
        "HOUSING / legacy env",
        re.compile(
            r"\b(HOUSING_NS|HOUSING_HOST|housing\.off-campus|"
            r"off-campus-housing\.test)\s*[=:]",
            re.I,
        ),
        "Environment variables and assignments",
    ),
]


def scan_file(rel: str, lines: list[str], sections: dict[str, Section], max_per_file: int = 25) -> None:
    for key, title, rx, _desc in RULES:
        sec = sections[key]
        if len([h for h in sec.hits if h.path == rel]) >= max_per_file:
            continue
        for i, line in enumerate(lines, start=1):
            if len(sec.hits) >= 2500:
                break
            if rx.search(line):
                snip = line.strip()
                if len(snip) > 200:
                    snip = snip[:197] + "…"
                sec.hits.append(Hit(rel, i, snip))
                if sum(1 for h in sec.hits if h.path == rel) >= max_per_file:
                    break


def scan_staging(staging: Path) -> dict[str, Section]:
    sections: dict[str, Section] = {r[0]: Section(title=r[1]) for r in RULES}
    for p in sorted(staging.rglob("*")):
        if not p.is_file() or p.is_symlink():
            continue
        if p.name in SKIP_NAMES:
            continue
        rel = str(p.relative_to(staging)).replace("\\", "/")
        if "__pycache__" in rel or rel.startswith(".git/"):
            continue
        if not is_probably_text(p):
            continue
        lines = read_lines(p)
        if not lines:
            continue
        scan_file(rel, lines, sections)
    return sections


def render_md(stem: str, staging: Path, sections: dict[str, Section]) -> str:
    lines_out: list[str] = [
        f"# OCH → RP rewrite scan: `{stem}`",
        "",
        f"**Staging (read-only scan):** `{staging.resolve()}`",
        "",
        "This report lists **detected** OCH-era strings. It does **not** apply edits.",
        "",
        "---",
        "",
    ]
    any_hits = False
    for key, title, _rx, desc in RULES:
        sec = sections[key]
        lines_out.append(f"## {sec.title}")
        lines_out.append("")
        lines_out.append(f"*{desc}*")
        lines_out.append("")
        if not sec.hits:
            lines_out.append("*None found in scanned text files.*")
            lines_out.append("")
            continue
        any_hits = True
        lines_out.append(f"**Hits:** {len(sec.hits)} (capped per file in scanner)")
        lines_out.append("")
        by_path: dict[str, list[Hit]] = defaultdict(list)
        for h in sec.hits:
            by_path[h.path].append(h)
        for path in sorted(by_path.keys())[:120]:
            hs = by_path[path][:15]
            lines_out.append(f"- `{path}`")
            for h in hs:
                lines_out.append(f"  - L{h.line_no}: `{h.snippet}`")
            if len(by_path[path]) > 15:
                lines_out.append(f"  - … *{len(by_path[path]) - 15} more in this file*")
        if len(by_path) > 120:
            lines_out.append(f"- … *{len(by_path) - 120} more paths*")
        lines_out.append("")

    lines_out.append("---")
    lines_out.append("")
    if not any_hits:
        lines_out.append("## Summary")
        lines_out.append("")
        lines_out.append("**No OCH-specific rewrite signals detected** in scanned text files under this staging tree.")
        lines_out.append("")
    else:
        lines_out.append("## Summary")
        lines_out.append("")
        lines_out.append("Apply **`docs/bundles/OCH_TO_RP_CONVERSION_MATRIX.md`** when porting; prefer surgical patches over bulk replace.")
        lines_out.append("")
    return "\n".join(lines_out)


def classify_bundle(stem: str, total_hits: int) -> str:
    s = stem.lower()
    if "final-vitest" in s and "chaos-golden" in s:
        return "Golden snapshot"
    if "makefile-golden" in s and "kafka-chaos" in s:
        return "Packaging-heavy / golden Makefile tree"
    if total_hits == 0:
        return "RP-native (no OCH strings in scanned text)"
    if total_hits < 8:
        return "Mostly RP-native (few OCH remnants)"
    return "OCH-configured (substantial rewrites likely)"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--staging", type=Path, required=True)
    ap.add_argument("--stem", type=str, required=True, help="Archive stem (output filename)")
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--print-classification", action="store_true", help="Print one-line classification to stdout")
    args = ap.parse_args()
    staging = args.staging.expanduser().resolve()
    if not staging.is_dir():
        print(f"Not a directory: {staging}", file=sys.stderr)
        return 2
    sections = scan_staging(staging)
    total = sum(len(s.hits) for s in sections.values())
    md = render_md(args.stem, staging, sections)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(md, encoding="utf-8")
    print(f"Wrote {args.output}")
    if args.print_classification:
        print(f"CLASSIFICATION\t{args.stem}\t{classify_bundle(args.stem, total)}\t{total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
