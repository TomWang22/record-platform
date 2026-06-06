## Bundle Extraction Protocol v1

Extraction used `tools/bundle-audit/extract_bundle_v1.sh` (verify → index validate → extract → manifest match → per-file SHA256 → case check → freeze).

- **CHECKSUM_RECORD:** `/Users/tom/record-platform/docs/bundles/CHECKSUM_RECORD_record-platform-kafka-kraft-3broker-kafka-certs-20260410.txt`
- **INTEGRITY (machine):** `/Users/tom/record-platform/docs/bundles/INTEGRITY_record-platform-kafka-kraft-3broker-kafka-certs-20260410.json`

### INTEGRITY summary

```json
{
  "bundle_extraction_protocol": "v1",
  "generated_at": "2026-04-19T00:52:11.113086+00:00",
  "archive": "/Users/tom/record-platform-kafka-kraft-3broker-kafka-certs-20260410.tar.gz",
  "archive_sha256": "e547496e053877dcbeec678e9b37a13b1f8c132e77285ceb893d4bf2b66359a9",
  "staging_path": "/Users/tom/bundle-staging/record-platform-kafka-kraft-3broker-kafka-certs-20260410",
  "archive_root_layout": {
    "type": "single_top_level",
    "root": "record-platform-kafka-3broker-kraft-kafka-certs-20260410"
  },
  "pre_extract": {
    "safe": true,
    "issues": [],
    "warnings": [],
    "file_member_count": 16
  },
  "post_extract": {
    "manifest_tar_equals_find": true,
    "file_count": 16,
    "case_collision_free": true,
    "staging_frozen_read_only": true,
    "apple_double_neutral_manifest": true
  },
  "explicit_non_actions": [
    "tarball_not_mutated",
    "no_line_endings_normalized",
    "no_top_level_strip_rewrite",
    "no_repo_copy",
    "no_git_add"
  ]
}```

## Mechanical parity (tar index vs repo)

```text
# mechanical_parity: record-platform-kafka-kraft-3broker-kafka-certs-20260410.tar.gz
repo: /Users/tom/record-platform
stripped_prefix: ''
checked_paths: 44
missing_in_repo: 44
  MISSING ._record-platform-kafka-3broker-kraft-kafka-certs-20260410
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/._README-BUNDLE.md
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/._infra
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/README-BUNDLE.md
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/._k8s
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/._kafka-certs
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/._kafka-kraft-metallb
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-certs
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-certs/._README.md
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-certs/._certificates
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-certs/._clusterissuer-kafka-broker.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-certs/._kafka-tls-preflight-job.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-certs/._kustomization.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-certs/README.md
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-certs/certificates
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-certs/certificates/._kafka-0-cert.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-certs/certificates/._kafka-1-cert.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-certs/certificates/._kafka-2-cert.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-certs/certificates/kafka-0-cert.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-certs/certificates/kafka-1-cert.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-certs/certificates/kafka-2-cert.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-certs/clusterissuer-kafka-broker.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-certs/kafka-tls-preflight-job.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-certs/kustomization.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-kraft-metallb
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-kraft-metallb/._exporter.py
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-kraft-metallb/._external-services.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-kraft-metallb/._headless-service.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-kraft-metallb/._kafka-metallb-alignment-exporter.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-kraft-metallb/._kafka-pdb.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-kraft-metallb/._kustomization.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-kraft-metallb/._rbac-kafka-svc-reader.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-kraft-metallb/._statefulset.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-kraft-metallb/exporter.py
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-kraft-metallb/external-services.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-kraft-metallb/headless-service.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-kraft-metallb/kafka-metallb-alignment-exporter.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-kraft-metallb/kafka-pdb.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-kraft-metallb/kustomization.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-kraft-metallb/rbac-kafka-svc-reader.yaml
  MISSING record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-kraft-metallb/statefulset.yaml
```

---

# Bundle analysis: `record-platform-kafka-kraft-3broker-kafka-certs-20260410`

Generated by `tools/bundle-audit/bundle_ingestion_analyze.py` (controlled ingestion; repo is canonical).

## Metadata

- **Staging tree:** `/Users/tom/bundle-staging/record-platform-kafka-kraft-3broker-kafka-certs-20260410`
- **Repo root:** `/Users/tom/record-platform`
- **Source tarball:** `/Users/tom/record-platform-kafka-kraft-3broker-kafka-certs-20260410.tar.gz`
- **Detected strip prefix:** `record-platform-kafka-3broker-kraft-kafka-certs-20260410`
- **Files under staging (after skips):** 16
- **UTC timestamp:** 2026-04-19T00:52:11.595082+00:00

## Parity summary

| Class | Count |
|-------|------:|
| `identical` | 11 |
| `content_diff` | 4 |
| `missing_in_repo` | 1 |

## Classification (sample per bucket)

### `bundle_only_scaffolding`

- `README-BUNDLE.md [missing_in_repo]`

### `infra_script`

- `infra/k8s/kafka-certs/README.md [content_diff]`
- `infra/k8s/kafka-certs/certificates/kafka-0-cert.yaml [identical]`
- `infra/k8s/kafka-certs/certificates/kafka-1-cert.yaml [identical]`
- `infra/k8s/kafka-certs/certificates/kafka-2-cert.yaml [identical]`
- `infra/k8s/kafka-certs/clusterissuer-kafka-broker.yaml [identical]`
- `infra/k8s/kafka-certs/kafka-tls-preflight-job.yaml [content_diff]`
- `infra/k8s/kafka-certs/kustomization.yaml [identical]`
- `infra/k8s/kafka-kraft-metallb/exporter.py [identical]`
- `infra/k8s/kafka-kraft-metallb/external-services.yaml [content_diff]`
- `infra/k8s/kafka-kraft-metallb/headless-service.yaml [identical]`
- `infra/k8s/kafka-kraft-metallb/kafka-metallb-alignment-exporter.yaml [identical]`
- `infra/k8s/kafka-kraft-metallb/kafka-pdb.yaml [identical]`
- `infra/k8s/kafka-kraft-metallb/kustomization.yaml [content_diff]`
- `infra/k8s/kafka-kraft-metallb/rbac-kafka-svc-reader.yaml [identical]`
- `infra/k8s/kafka-kraft-metallb/statefulset.yaml [identical]`

## Safe import suggestions

- Paths marked **`missing_in_repo`** may be candidates for **add-if-missing** imports; review namespace/SNI (`record-platform`, `record.test`, `kafka-ssl-secret`).
- Paths marked **`content_diff`** require **manual diff** (`diff -u` or IDE); do not `cp -r` from staging.
- Prefer **`git apply`** / focused **`git checkout -- path`** over wholesale copy.
- **Do not** overwrite `scripts/run-preflight-scale-and-all-suites.sh` from bundles unless explicitly approved.

## Top paths to review

- `infra/k8s/kafka-certs/README.md` — **content_diff** (infra_script) sha256 staging=e16c4946f41c… repo=8ed2419f1413…
- `infra/k8s/kafka-certs/kafka-tls-preflight-job.yaml` — **content_diff** (infra_script) sha256 staging=b190402810fb… repo=0990f3da6ef9…
- `infra/k8s/kafka-kraft-metallb/external-services.yaml` — **content_diff** (infra_script) sha256 staging=e9fe1bbefd99… repo=224f606c722d…
- `infra/k8s/kafka-kraft-metallb/kustomization.yaml` — **content_diff** (infra_script) sha256 staging=6d41731e8293… repo=ca2a63bf3590…
- `README-BUNDLE.md` — **missing_in_repo** (bundle_only_scaffolding)
