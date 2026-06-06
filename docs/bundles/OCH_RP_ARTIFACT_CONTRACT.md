# OCH → RP artifact contract (bundles)

Shipped lab bundles **must** be consumable by **Bundle Extraction Protocol v1** (`tools/bundle-audit/extract_bundle_v1.sh`) without relaxing safety rules.

## Required artifacts

| Deliverable | Purpose |
|-------------|---------|
| `*.tar.gz` | Immutable payload (never rewritten after publish). |
| `*.sha256` sidecar | Same directory as the tarball **or** `docs/bundles/<stem>.sha256` in-repo for CI / Cursor runs. |
| Optional `MANIFEST.txt` | Human audit trail; not a substitute for tar index validation. |

## Archive content rules

1. **No absolute paths** in member names (`/etc/passwd`, leading `/`).
2. **No `..` segments** in member names (path traversal).
3. **No hardlinks** (`tar` hardlink members).
4. **No device or FIFO members.**
5. **Symlinks** are allowed only when the bundle has a **single top-level directory** and the symlink target resolves **under that root** after POSIX normalization (see `validate_bundle_v1.py`). Mixed top-level layouts (e.g. flat `scripts/` + `infra/`) **must not** ship symlinks.
6. **No secrets** baked into archives (tokens, private keys, `.env` with real credentials). Use placeholders and runtime injection.
7. Prefer a **single top-level directory** (`record-platform-…/`) for snapshot bundles to simplify root detection and symlink policy.

## Record Platform canonical names

Imports must align with **Record** defaults (`record-platform`, `record.test`, `kafka-ssl-secret`, gateway **:4000**) unless the RP change is explicitly scoped and reviewed.

## Consumption

- Extraction target: **`$HOME/bundle-staging/<stem>/`** only.
- Ingestion never mutates the tarball, never normalizes line endings, never auto-`git add`, never bulk-copies into the repo without a PR.
- After protocol success, analysis outputs live under `docs/bundles/` (`CHECKSUM_RECORD_*`, `INTEGRITY_*`, `BUNDLE_ANALYSIS_*`).

See also: `docs/bundles/BUNDLE_INGESTION_POLICY.md`.
