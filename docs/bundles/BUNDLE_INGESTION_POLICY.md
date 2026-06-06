# Bundle ingestion policy (v1)

Tarballs dated **2026-04-09 through 2026-04-18** (and future lab bundles) are **immutable historical artifacts**. The git repo is the **evolving source of truth**. Bundles may **suggest** imports; they must **not** redefine repository layout.

## Bundle Extraction Protocol v1 (deterministic)

**Do not** hand-roll `tar x` into the repo. Use:

1. **`tools/bundle-audit/extract_bundle_v1.sh`** — single-archive pipeline: **Phase 0** SHA256 + `docs/bundles/CHECKSUM_RECORD_<stem>.txt` → **Phase 1** `validate_bundle_v1.py` (index-only; traversal / symlink / hardlink / device rules) + raw `tar -tz` grep guard → **Phase 2** `tar -xzf … -C staging` (`--no-same-owner --no-same-permissions`, never `-P`, never repo root) → **Phase 3** **lossless manifest**: sorted tar regular-file index (AppleDouble-neutral) **must equal** sorted on-disk regular files → **Phase 4** `MANIFEST.sha256.txt` in staging → **Phase 5** case-insensitive collision check → **Phase 6** `chmod -R a-w` freeze → **`docs/bundles/INTEGRITY_<stem>.json`**.
2. **`tools/bundle-audit/extract_and_analyze.sh`** — discovery + `extract_bundle_v1.sh` per archive + mechanical parity + `bundle_ingestion_analyze.py` + `BUNDLE_ANALYSIS_<stem>.md`.

**Explicit prohibitions:** never mutate the tarball; never normalize line endings or shebangs; never strip a top-level folder on disk; never auto-`git add`; never bulk `cp -r` into the repo; do not delete prior staging without **versioning** (existing `$HOME/bundle-staging/<stem>` is moved to `*.bak.<timestamp>` before re-extract).

**AppleDouble-neutral manifest:** macOS may not materialize every `._*` member; Phase 3 compares **payload file** paths only (see `skip_manifest_noise` in `bundle_audit_lib.py`).

Shipper expectations: **`docs/bundles/OCH_RP_ARTIFACT_CONTRACT.md`**.

## Three-zone model

| Zone | Purpose |
|------|---------|
| `~/bundles-archive/` (optional) | Long-term storage of original `.tar.gz` + sidecar `.sha256` / `MANIFEST.txt` (human workflow). |
| `~/bundle-staging/<bundle-stem>/` | **Only** extraction target for inspection. Never the repo root. |
| `~/record-platform/` (or clone path) | Canonical working tree. Changes happen here via **reviewed** commits / `git apply`, not blind `cp -r`. |

## Required handling rules

1. **Do not** extract tarballs into the repo root or merge tar streams into tracked paths automatically.
2. **Do not** modify or rewrite bytes inside the original archive.
3. **Do not** treat the tarball as canonical for structure, namespaces, or SNI — **Record** defaults apply in-repo (`record-platform`, `record.test`, `kafka-ssl-secret`, api-gateway **:4000**, MetalLB `record-platform-pool`, etc.).
4. **Do** verify checksum when a sidecar `.sha256` exists (before and after extraction is optional; at minimum **before** extract).
5. **Do** extract only under `~/bundle-staging/<bundle-stem>/`.
6. **Do** produce machine-readable analysis under `docs/bundles/BUNDLE_ANALYSIS_<bundle-stem>.md`.
7. **Do** prefer **cherry-picks** and **patches** (`git apply`, focused `git checkout -- path`) over wholesale copies.
8. **Do not** overwrite `scripts/run-preflight-scale-and-all-suites.sh` unless there is an explicit, reviewed decision (QUIC bundles align with repo today; OCH-era deltas must be merged deliberately).

## Pipeline stages

| Stage | Tool / output |
|-------|----------------|
| 0. **Protocol v1 extract** | `extract_bundle_v1.sh` → `CHECKSUM_RECORD_*`, `INTEGRITY_*`, frozen `~/bundle-staging/<stem>/`. |
| 1. Forensic index (optional) | `mechanical_parity_tar_vs_repo.py` — “does path exist?” without trusting extract alone. |
| 2. **Analysis** | `extract_and_analyze.sh` wraps protocol + `bundle_ingestion_analyze.py` → `BUNDLE_ANALYSIS_*.md`. |
| 3. Human / PR | Import selected files; fix namespace/SNI drift; commit. |

## Classification buckets (analysis output)

Files are grouped for triage:

- **runtime_critical** — e.g. Kafka KRaft manifests, core preflight gates, edge TLS/Caddy paths that affect cluster bring-up.
- **infra_script** — `scripts/**` clearly tied to Kafka, QUIC, transport, MetalLB, preflight, Colima/k3d.
- **observability** — monitoring rules, Prometheus/Jaeger wiring, OTEL configs.
- **bundle_only_scaffolding** — `MANIFEST.txt`, `README_BUNDLE.txt`, `make-fragments/`, `PaxHeaders`, `__MACOSX`.
- **packaging_helper** — one-off packagers (e.g. `package-*-bundle.sh`), legacy shims not required at runtime.
- **service_or_app** — `services/*`, `webapp/*`, product tests (typically **not** bulk-imported from OCH golden tarballs).

## Namespace / SNI drift

Any text asset staged from OCH-era bundles must be checked for:

- `off-campus-housing-tracker` (namespace)
- `off-campus-housing.test` (host/SNI)
- `och-` naming where it implies cluster identity

Imports must align with **Record** naming unless intentionally dual-stacked with env overrides (`HOUSING_NS`, etc.).

## Re-running

From the repo root:

```bash
./tools/bundle-audit/extract_and_analyze.sh
```

**Discovery (no `BUNDLE_TARBALLS`):** scans `BUNDLE_ARCHIVE_DIR` (default `$HOME`) for `record-platform*.tar.gz`, `preflight-cluster-quic*.tar.gz`, `kafka-kraft*.tar.gz`, `och-preflight*.tar.gz`, and `record.test*.tar.gz` whose basename contains `20260409` or `20260410`–`20260418`.

**Environment:**

| Variable | Default | Meaning |
|----------|---------|---------|
| `BUNDLE_STAGING_ROOT` | `$HOME/bundle-staging` | Extraction target (never the repo). |
| `BUNDLE_ARCHIVE_DIR` | `$HOME` | Directory scanned for lab tarballs. |
| `BUNDLE_TARBALLS` | *(unset)* | Space-separated paths; skips discovery. |
| `RP_REPO_ROOT` | repo containing `tools/bundle-audit/` | Canonical tree for diffs. |

Override tarball list:

```bash
BUNDLE_TARBALLS="/path/a.tar.gz /path/b.tar.gz" ./tools/bundle-audit/extract_and_analyze.sh
```

**Outputs:** `docs/bundles/CHECKSUM_RECORD_<stem>.txt`, `docs/bundles/INTEGRITY_<stem>.json`, `docs/bundles/BUNDLE_ANALYSIS_<stem>.md`, plus `MANIFEST.sha256.txt` inside each frozen staging directory (under `~/bundle-staging/`).

**Controlled OCH → RP conversion sweep (explicit list):** `tools/bundle-audit/run_och_conversion_sweep.sh` — reruns Protocol v1 + analysis for the fixed 20 lab archives, then `och_to_rp_rewrite_scan.py` → `docs/bundles/OCH_TO_RP_REWRITE_<stem>.md` and regenerates `docs/bundles/BUNDLE_CLASSIFICATION_SUMMARY.md` (read-only scans; no `sed` / no repo writes).
