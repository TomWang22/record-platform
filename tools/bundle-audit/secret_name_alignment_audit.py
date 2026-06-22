#!/usr/bin/env python3
"""
Static secret / TLS name alignment audit (no kubectl, no cluster).

Scans the repo for legacy OCH secret identifiers, compares `secretName` /
`secretKeyRef` references under `infra/k8s` against `kind: Secret` manifests,
and writes `docs/bundles/SECRET_NAME_ALIGNMENT_REPORT.md` with columns:

  | File | OCH Secret | RP Equivalent Exists? | Needs Rewrite? |

Exit 1 when: OCH literals in infra/scripts/services/Makefile; mixed OCH+RP
secret refs in one YAML; any ref containing `och` that is not a static Secret;
any declared Secret name containing `och` but never referenced; any
`secretName` ref not covered by a static Secret or DYNAMIC_SECRET_ALLOWLIST.
"""

from __future__ import annotations

import argparse
import fnmatch
import os
import re
import sys
from pathlib import Path

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
    {".yaml", ".yml", ".json", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".sh", ".md", ".proto", ".toml"}
)

OCH_LINE_SCANNERS: list[tuple[str, re.Pattern]] = [
    ("och-kafka-ssl-secret", re.compile(r"(?i)\boch-kafka-ssl-secret\b")),
    ("och-service-tls", re.compile(r"(?i)\boch-service-tls\b")),
    ("och-*-tls", re.compile(r"(?i)\boch-[a-z0-9-]+-tls\b")),
    ("secretName/KeyRef + och", re.compile(r"(?i)\b(secretName|secretKeyRef)\s*:.*och[-_]")),
]

HARD_FAIL_PREFIXES = ("infra/", "scripts/", "services/", "Makefile")

DYNAMIC_SECRET_ALLOWLIST = frozenset(
    {
        "kafka-ssl-secret",
        "service-tls",
        "edge-service-tls",
        "dev-root-ca",
        "kafka-0-tls",
        "kafka-1-tls",
        "kafka-2-tls",
        "envoy-client-tls",
        "record-local-tls",
        "record-local-tls-b",
        "record-platform-local-tls",
        "record-platform-local-tls-b",
        "regcred",
        "docker-registry",
        "redis-auth",
        "postgres-postinit-sql",
        "rp-mtls-test-ca",
        "webapp-runtime-secrets",
    }
)


def is_allowed_secret_ref(name: str) -> bool:
    if name in DYNAMIC_SECRET_ALLOWLIST:
        return True
    if name.startswith("service-tls-"):
        return True
    return False


def load_allow_rules(repo: Path) -> tuple[list[str], list[str]]:
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
    return prefixes or ["docs/", "tools/bundle-audit/", "staging/"], globs


def is_allowlisted(rel: str, prefixes: list[str], globs: list[str]) -> bool:
    if any(rel == p.rstrip("/") or rel.startswith(p) for p in prefixes):
        return True
    return any(fnmatch.fnmatch(rel, g) for g in globs)


def is_text_file(p: Path) -> bool:
    if p.name in ("Makefile", "Dockerfile", "Caddyfile", "package.json"):
        return True
    return p.suffix.lower() in TEXT_SUFFIXES


def extract_och_token(line: str) -> str:
    for _label, rx in OCH_LINE_SCANNERS:
        m = rx.search(line)
        if m:
            return m.group(0).strip()[:120]
    return "—"


def rp_target_for_och_line(line: str) -> str | None:
    ll = line.lower()
    if "och-kafka-ssl-secret" in ll:
        return "kafka-ssl-secret"
    if "och-service-tls" in ll:
        return "edge-service-tls"
    if re.search(r"(?i)\boch-[a-z0-9-]+-tls\b", line):
        return "edge-service-tls"
    if "och" in ll and ("secretname" in ll or "secretkeyref" in ll):
        return "kafka-ssl-secret"
    return None


def rp_equivalent_exists_in_repo(repo: Path, prefixes: list[str], globs: list[str], target: str | None) -> bool:
    if not target:
        return True
    needle = target.split()[0]
    if needle not in ("kafka-ssl-secret", "edge-service-tls", "service-tls"):
        return True
    rx = re.compile(rf"(?i)\b{re.escape(needle)}\b")
    for root, dirs, files in os.walk(repo, topdown=True):
        dirs[:] = [d for d in dirs if d not in SKIP_DIR_NAMES]
        for fn in files:
            fp = Path(root) / fn
            try:
                rel = fp.relative_to(repo).as_posix()
            except ValueError:
                continue
            if is_allowlisted(rel, prefixes, globs):
                continue
            if not is_text_file(fp):
                continue
            try:
                t = fp.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if len(t) > 2_000_000:
                continue
            if rx.search(t):
                return True
    return False


def extract_k8s_secret_definitions(text: str) -> set[str]:
    names: set[str] = set()
    for doc in re.split(r"^---\s*$", text, flags=re.MULTILINE):
        if not re.search(r"^kind:\s*Secret\s*$", doc, re.MULTILINE):
            continue
        pos = doc.find("metadata:")
        if pos == -1:
            continue
        head = doc[pos : pos + 1200]
        m = re.search(r"(?m)^\s+name:\s*(\S+)\s*$", head)
        if m:
            names.add(m.group(1).strip("'\""))
    return names


def extract_secret_refs(text: str) -> set[str]:
    refs: set[str] = set()
    for m in re.finditer(r"secretName:\s*(\S+)", text):
        s = m.group(1).strip("'\"")
        if "{{" not in s and "${" not in s:
            refs.add(s)
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if re.search(r"\bsecretKeyRef\s*:", line):
            window = "\n".join(lines[i : min(len(lines), i + 12)])
            m = re.search(r"(?m)^\s+name:\s*(\S+)\s*$", window)
            if m:
                s = m.group(1).strip("'\"")
                if "{{" not in s and "${" not in s:
                    refs.add(s)
    # Do not parse generic `resourceNames:` (RBAC often names Services, not Secrets).
    return refs


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repo-root", type=Path, default=Path.cwd())
    ap.add_argument("--output", type=Path, default=None)
    args = ap.parse_args()
    repo = args.repo_root.resolve()
    prefixes, globs = load_allow_rules(repo)
    out = args.output or (repo / "docs" / "bundles" / "SECRET_NAME_ALIGNMENT_REPORT.md")

    rows: list[tuple[str, str, str, str]] = []
    hard_fail: list[str] = []

    for root, dirs, files in os.walk(repo, topdown=True):
        dirs[:] = [d for d in dirs if d not in SKIP_DIR_NAMES]
        for fn in files:
            fp = Path(root) / fn
            try:
                rel = fp.relative_to(repo).as_posix()
            except ValueError:
                continue
            if is_allowlisted(rel, prefixes, globs):
                continue
            if not is_text_file(fp):
                continue
            try:
                raw = fp.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            if len(raw) > 2_000_000:
                continue
            for i, line in enumerate(raw.splitlines(), start=1):
                if not any(rx.search(line) for _, rx in OCH_LINE_SCANNERS):
                    continue
                token = extract_och_token(line)
                tgt = rp_target_for_och_line(line)
                exists = "Yes" if rp_equivalent_exists_in_repo(repo, prefixes, globs, tgt) else "No"
                needs = "Yes" if exists == "No" and not rel.startswith("docs/") else ("Maybe" if rel.startswith("docs/") else "No")
                rows.append((f"`{rel}`:{i}", token, exists, needs))
                if rel.startswith(HARD_FAIL_PREFIXES) or rel == "Makefile":
                    hard_fail.append(f"OCH secret token in {rel}:{i}: {line.strip()[:200]}")

    defined: set[str] = set()
    per_file_refs: dict[str, set[str]] = {}
    k8s_root = repo / "infra" / "k8s"
    if k8s_root.is_dir():
        for root, dirs, files in os.walk(k8s_root, topdown=True):
            dirs[:] = [d for d in dirs if d not in SKIP_DIR_NAMES]
            for fn in files:
                if not fn.endswith((".yaml", ".yml")):
                    continue
                fp = Path(root) / fn
                rel = fp.relative_to(repo).as_posix()
                try:
                    text = fp.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    continue
                defined |= extract_k8s_secret_definitions(text)
                r = extract_secret_refs(text)
                if r:
                    per_file_refs[rel] = r

    all_refs: set[str] = set()
    for s in per_file_refs.values():
        all_refs |= s

    undefined_report: list[tuple[str, str]] = []
    for fpath, refs in sorted(per_file_refs.items()):
        for r in sorted(refs):
            if r in defined or is_allowed_secret_ref(r):
                continue
            undefined_report.append((fpath, r))
            hard_fail.append(f"Referenced secret `{r}` not in static Secret manifests nor allowlist ({fpath})")
            if "och" in r.lower():
                hard_fail.append(f"OCH-named ref `{r}` unresolved ({fpath})")

    mixed: list[str] = []
    for fpath, refs in per_file_refs.items():
        low = {x.lower() for x in refs}
        has_och = any("och" in x for x in low)
        has_rp = any(x in low for x in ("kafka-ssl-secret", "edge-service-tls", "service-tls"))
        if has_och and has_rp:
            msg = f"{fpath}: mixes OCH-style and RP TLS names: {sorted(refs)}"
            mixed.append(msg)
            hard_fail.append(msg)

    unused_defined = sorted(defined - all_refs)
    for name in unused_defined:
        if "och" in name.lower():
            hard_fail.append(f"OCH-named Secret `{name}` declared but never referenced")

    kafka_yaml = list(k8s_root.rglob("kafka-ssl-secret.yaml")) if k8s_root.is_dir() else []
    edge_yaml = list(k8s_root.rglob("edge-service-tls.yaml")) if k8s_root.is_dir() else []

    lines = [
        "# Secret name alignment audit",
        "",
        f"**Repo:** `{repo}`",
        "",
        "## Canonical filenames (informational)",
        "",
        f"- `infra/k8s/**/kafka-ssl-secret.yaml`: **{len(kafka_yaml)}** (`{', '.join(str(p.relative_to(repo)) for p in kafka_yaml[:6]) or '—'}`)",
        f"- `infra/k8s/**/edge-service-tls.yaml`: **{len(edge_yaml)}** (`{', '.join(str(p.relative_to(repo)) for p in edge_yaml[:6]) or '—'}`)",
        "",
        "## Matrix: OCH secret traces",
        "",
        "| File | OCH Secret | RP Equivalent Exists? | Needs Rewrite? |",
        "|------|------------|-------------------------|----------------|",
    ]
    for file_cell, token, exists, needs in sorted(rows, key=lambda x: x[0])[:2500]:
        tok = token.replace("|", "\\|")
        lines.append(f"| {file_cell} | `{tok}` | {exists} | {needs} |")
    if len(rows) > 2500:
        lines.append(f"\n_(Truncated; {len(rows)} rows.)_")

    lines += [
        "",
        "## Deployment / volume secret refs vs static `kind: Secret`",
        "",
        f"- **Declared Secret names:** {len(defined)}",
        f"- **Referenced secret names:** {len(all_refs)}",
        "",
        "### Referenced but not defined (and not on dynamic allowlist)",
    ]
    if undefined_report:
        lines += [f"- `{fp}` → `{r}`" for fp, r in undefined_report[:400]]
        if len(undefined_report) > 400:
            lines.append(f"- _…{len(undefined_report) - 400} more_")
    else:
        lines.append("- _(none)_")

    lines += ["", "### Declared Secret names never referenced (informational)"]
    if unused_defined:
        lines += [f"- `{n}`" for n in unused_defined[:200]]
    else:
        lines.append("- _(none)_")

    lines += ["", "## Hard failures (deduped)"]
    if hard_fail:
        for h in sorted(set(hard_fail))[:300]:
            lines.append(f"- {h}")
    else:
        lines.append("- _(none)_")

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {out} matrix_rows={len(rows)} hard_fail={len(set(hard_fail))}")
    return 1 if hard_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
