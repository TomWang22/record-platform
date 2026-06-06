## Bundle Extraction Protocol v1

Extraction used `tools/bundle-audit/extract_bundle_v1.sh` (verify → index validate → extract → manifest match → per-file SHA256 → case check → freeze).

- **CHECKSUM_RECORD:** `/Users/tom/record-platform/docs/bundles/CHECKSUM_RECORD_record-platform-kafka-metallb-tls-reference-20260409.txt`
- **INTEGRITY (machine):** `/Users/tom/record-platform/docs/bundles/INTEGRITY_record-platform-kafka-metallb-tls-reference-20260409.json`

### INTEGRITY summary

```json
{
  "bundle_extraction_protocol": "v1",
  "generated_at": "2026-04-19T00:52:14.255483+00:00",
  "archive": "/Users/tom/record-platform-kafka-metallb-tls-reference-20260409.tar.gz",
  "archive_sha256": "467d021cb9ebeca7939aad2b236e1c755f9cd2283ad341d7737f04efdba15f30",
  "staging_path": "/Users/tom/bundle-staging/record-platform-kafka-metallb-tls-reference-20260409",
  "archive_root_layout": {
    "type": "single_top_level",
    "root": "record-platform-kafka-metallb-tls-reference-20260409"
  },
  "pre_extract": {
    "safe": true,
    "issues": [],
    "warnings": [],
    "file_member_count": 86
  },
  "post_extract": {
    "manifest_tar_equals_find": true,
    "file_count": 86,
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
# mechanical_parity: record-platform-kafka-metallb-tls-reference-20260409.tar.gz
repo: /Users/tom/record-platform
stripped_prefix: ''
checked_paths: 210
missing_in_repo: 210
  MISSING ._record-platform-kafka-metallb-tls-reference-20260409
  MISSING record-platform-kafka-metallb-tls-reference-20260409
  MISSING record-platform-kafka-metallb-tls-reference-20260409/._.github
  MISSING record-platform-kafka-metallb-tls-reference-20260409/._README-BUNDLE.md
  MISSING record-platform-kafka-metallb-tls-reference-20260409/._infra
  MISSING record-platform-kafka-metallb-tls-reference-20260409/._scripts
  MISSING record-platform-kafka-metallb-tls-reference-20260409/.github
  MISSING record-platform-kafka-metallb-tls-reference-20260409/.github/._workflows
  MISSING record-platform-kafka-metallb-tls-reference-20260409/.github/workflows
  MISSING record-platform-kafka-metallb-tls-reference-20260409/.github/workflows/._kafka-alignment.yml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/.github/workflows/._kafka-cluster-verify.yml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/.github/workflows/._kafka-dns-validate.yml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/.github/workflows/kafka-alignment.yml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/.github/workflows/kafka-cluster-verify.yml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/.github/workflows/kafka-dns-validate.yml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/README-BUNDLE.md
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/._k8s
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/._base
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/._kafka-certs
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/._kafka-kraft-metallb
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/._metallb
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/._kafka
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/._kafka-ca-exporter
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/._kafka-external
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/._observability
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-ca-exporter
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-ca-exporter/._configmap.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-ca-exporter/._deployment.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-ca-exporter/._kustomization.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-ca-exporter/._rbac.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-ca-exporter/._service.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-ca-exporter/configmap.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-ca-exporter/deployment.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-ca-exporter/kustomization.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-ca-exporter/rbac.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-ca-exporter/service.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-external
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-external/._external-service.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-external/._kustomization.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-external/external-service.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka-external/kustomization.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka/._deploy.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka/._external-service.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka/._kustomization.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka/._service.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka/deploy.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka/external-service.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka/kustomization.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/kafka/service.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/observability
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/observability/._prometheus-rules-auth-outbox.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/observability/._prometheus-rules-kafka-health.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/observability/._prometheus-rules-och-slo.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/observability/prometheus-rules-auth-outbox.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/observability/prometheus-rules-kafka-health.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/base/observability/prometheus-rules-och-slo.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/._README.md
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/._certificates
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/._clusterissuer-kafka-broker.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/._kafka-tls-preflight-job.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/._kustomization.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/README.md
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/certificates
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/certificates/._kafka-0-cert.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/certificates/._kafka-1-cert.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/certificates/._kafka-2-cert.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/certificates/kafka-0-cert.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/certificates/kafka-1-cert.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/certificates/kafka-2-cert.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/clusterissuer-kafka-broker.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/kafka-tls-preflight-job.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-certs/kustomization.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/._exporter.py
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/._external-services.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/._headless-service.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/._kafka-metallb-alignment-exporter.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/._kafka-pdb.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/._kustomization.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/._rbac-kafka-svc-reader.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/._statefulset.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/exporter.py
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/external-services.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/headless-service.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/kafka-metallb-alignment-exporter.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/kafka-pdb.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/kustomization.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/rbac-kafka-svc-reader.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/kafka-kraft-metallb/statefulset.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/._README.md
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/._bgpadvertisement.example.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/._bgpadvertisement.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/._bgppeer-frr.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/._bgppeer.example.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/._bgppeer.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/._frr
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/._frr-config.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/._frr-deploy.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/._ipaddresspool.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/._kustomization.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/._l2advertisement.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/README.md
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/bgpadvertisement.example.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/bgpadvertisement.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/bgppeer-frr.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/bgppeer.example.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/bgppeer.yaml
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/frr
  MISSING record-platform-kafka-metallb-tls-reference-20260409/infra/k8s/metallb/frr-config.yaml
... (truncated; re-run mechanical_parity_tar_vs_repo.py for full list)
```

---

# Bundle analysis: `record-platform-kafka-metallb-tls-reference-20260409`

Generated by `tools/bundle-audit/bundle_ingestion_analyze.py` (controlled ingestion; repo is canonical).

## Metadata

- **Staging tree:** `/Users/tom/bundle-staging/record-platform-kafka-metallb-tls-reference-20260409`
- **Repo root:** `/Users/tom/record-platform`
- **Source tarball:** `/Users/tom/record-platform-kafka-metallb-tls-reference-20260409.tar.gz`
- **Detected strip prefix:** `record-platform-kafka-metallb-tls-reference-20260409`
- **Files under staging (after skips):** 86
- **UTC timestamp:** 2026-04-19T00:52:14.714649+00:00

## Parity summary

| Class | Count |
|-------|------:|
| `content_diff` | 64 |
| `identical` | 19 |
| `missing_in_repo` | 3 |

## Classification (sample per bucket)

### `bundle_only_scaffolding`

- `README-BUNDLE.md [missing_in_repo]`

### `infra_script`

- `infra/k8s/base/kafka-ca-exporter/configmap.yaml [content_diff]`
- `infra/k8s/base/kafka-ca-exporter/deployment.yaml [content_diff]`
- `infra/k8s/base/kafka-ca-exporter/kustomization.yaml [identical]`
- `infra/k8s/base/kafka-ca-exporter/rbac.yaml [content_diff]`
- `infra/k8s/base/kafka-ca-exporter/service.yaml [content_diff]`
- `infra/k8s/base/kafka-external/external-service.yaml [content_diff]`
- `infra/k8s/base/kafka-external/kustomization.yaml [identical]`
- `infra/k8s/base/kafka/deploy.yaml [content_diff]`
- `infra/k8s/base/kafka/external-service.yaml [content_diff]`
- `infra/k8s/base/kafka/kustomization.yaml [identical]`
- `infra/k8s/base/kafka/service.yaml [content_diff]`
- `infra/k8s/kafka-certs/README.md [content_diff]`
- `infra/k8s/kafka-certs/certificates/kafka-0-cert.yaml [content_diff]`
- `infra/k8s/kafka-certs/certificates/kafka-1-cert.yaml [content_diff]`
- `infra/k8s/kafka-certs/certificates/kafka-2-cert.yaml [content_diff]`
- `infra/k8s/kafka-certs/clusterissuer-kafka-broker.yaml [identical]`
- `infra/k8s/kafka-certs/kafka-tls-preflight-job.yaml [content_diff]`
- `infra/k8s/kafka-certs/kustomization.yaml [identical]`
- `infra/k8s/kafka-kraft-metallb/exporter.py [content_diff]`
- `infra/k8s/kafka-kraft-metallb/external-services.yaml [content_diff]`
- `infra/k8s/kafka-kraft-metallb/headless-service.yaml [content_diff]`
- `infra/k8s/kafka-kraft-metallb/kafka-metallb-alignment-exporter.yaml [content_diff]`
- `infra/k8s/kafka-kraft-metallb/kafka-pdb.yaml [content_diff]`
- `infra/k8s/kafka-kraft-metallb/kustomization.yaml [content_diff]`
- `infra/k8s/kafka-kraft-metallb/rbac-kafka-svc-reader.yaml [content_diff]`
- `infra/k8s/kafka-kraft-metallb/statefulset.yaml [content_diff]`
- `infra/k8s/metallb/README.md [identical]`
- `infra/k8s/metallb/bgpadvertisement.example.yaml [content_diff]`
- `infra/k8s/metallb/bgpadvertisement.yaml [content_diff]`
- `infra/k8s/metallb/bgppeer-frr.yaml [content_diff]`
- `infra/k8s/metallb/bgppeer.example.yaml [content_diff]`
- `infra/k8s/metallb/bgppeer.yaml [content_diff]`
- `infra/k8s/metallb/frr-config.yaml [identical]`
- `infra/k8s/metallb/frr-deploy.yaml [identical]`
- `infra/k8s/metallb/frr/Dockerfile [identical]`
- `infra/k8s/metallb/frr/bgpd-configmap.yaml [identical]`
- `infra/k8s/metallb/frr/deploy.yaml [identical]`
- `infra/k8s/metallb/frr/frr-configmap.yaml [identical]`
- `infra/k8s/metallb/frr/frr-deployment.yaml [identical]`
- `infra/k8s/metallb/frr/svc.yaml [identical]`
- … *39 more*

### `observability`

- `infra/k8s/base/observability/prometheus-rules-auth-outbox.yaml [identical]`
- `infra/k8s/base/observability/prometheus-rules-kafka-health.yaml [content_diff]`
- `infra/k8s/base/observability/prometheus-rules-och-slo.yaml [missing_in_repo]`

### `runtime_critical`

- `.github/workflows/kafka-alignment.yml [content_diff]`
- `.github/workflows/kafka-cluster-verify.yml [content_diff]`
- `.github/workflows/kafka-dns-validate.yml [content_diff]`

## Safe import suggestions

- Paths marked **`missing_in_repo`** may be candidates for **add-if-missing** imports; review namespace/SNI (`record-platform`, `record.test`, `kafka-ssl-secret`).
- Paths marked **`content_diff`** require **manual diff** (`diff -u` or IDE); do not `cp -r` from staging.
- Prefer **`git apply`** / focused **`git checkout -- path`** over wholesale copy.
- **Do not** overwrite `scripts/run-preflight-scale-and-all-suites.sh` from bundles unless explicitly approved.

## Top paths to review

- `infra/k8s/base/kafka-ca-exporter/configmap.yaml` — **content_diff** (infra_script) sha256 staging=de921f8525e1… repo=5d28d95ce9ac…
- `infra/k8s/base/kafka-ca-exporter/deployment.yaml` — **content_diff** (infra_script) sha256 staging=1dc398a807e1… repo=941fa4546629…
- `infra/k8s/base/kafka-ca-exporter/rbac.yaml` — **content_diff** (infra_script) sha256 staging=fc5257cd75b4… repo=c0084878fdf8…
- `infra/k8s/base/kafka-ca-exporter/service.yaml` — **content_diff** (infra_script) sha256 staging=887ade69a210… repo=d004ab14766d…
- `infra/k8s/base/kafka-external/external-service.yaml` — **content_diff** (infra_script) sha256 staging=f23b57332aa5… repo=0ed1a0395f00…
- `infra/k8s/base/kafka/deploy.yaml` — **content_diff** (infra_script) sha256 staging=97817524a9cc… repo=0ed7b5d382ae…
- `infra/k8s/base/kafka/external-service.yaml` — **content_diff** (infra_script) sha256 staging=df662fcb5804… repo=686986e296e8…
- `infra/k8s/base/kafka/service.yaml` — **content_diff** (infra_script) sha256 staging=7171b186b992… repo=9144c9a13878…
- `infra/k8s/kafka-certs/README.md` — **content_diff** (infra_script) sha256 staging=042a5d7f710b… repo=8ed2419f1413…
- `infra/k8s/kafka-certs/certificates/kafka-0-cert.yaml` — **content_diff** (infra_script) sha256 staging=892d19967b31… repo=2bfc9a4e20ec…
- `infra/k8s/kafka-certs/certificates/kafka-1-cert.yaml` — **content_diff** (infra_script) sha256 staging=713ebc58f758… repo=8b1b9aa2caf6…
- `infra/k8s/kafka-certs/certificates/kafka-2-cert.yaml` — **content_diff** (infra_script) sha256 staging=0cba02fb4202… repo=590d344c56c2…
- `infra/k8s/kafka-certs/kafka-tls-preflight-job.yaml` — **content_diff** (infra_script) sha256 staging=29e6837e8617… repo=0990f3da6ef9…
- `infra/k8s/kafka-kraft-metallb/exporter.py` — **content_diff** (infra_script) sha256 staging=fcf7b33ba13c… repo=09abfe4525b5…
- `infra/k8s/kafka-kraft-metallb/external-services.yaml` — **content_diff** (infra_script) sha256 staging=b3c897e253e8… repo=224f606c722d…
- `infra/k8s/kafka-kraft-metallb/headless-service.yaml` — **content_diff** (infra_script) sha256 staging=4b0ae6ebc920… repo=8678d986f675…
- `infra/k8s/kafka-kraft-metallb/kafka-metallb-alignment-exporter.yaml` — **content_diff** (infra_script) sha256 staging=4ed8db1dbf7a… repo=8c5751eb30cf…
- `infra/k8s/kafka-kraft-metallb/kafka-pdb.yaml` — **content_diff** (infra_script) sha256 staging=a0eae3ecd81c… repo=7850b33fec90…
- `infra/k8s/kafka-kraft-metallb/kustomization.yaml` — **content_diff** (infra_script) sha256 staging=fe152dd75937… repo=ca2a63bf3590…
- `infra/k8s/kafka-kraft-metallb/rbac-kafka-svc-reader.yaml` — **content_diff** (infra_script) sha256 staging=41a46731a446… repo=689cb37993aa…
- `infra/k8s/kafka-kraft-metallb/statefulset.yaml` — **content_diff** (infra_script) sha256 staging=4b03b020a521… repo=86ac22f4a153…
- `infra/k8s/metallb/bgpadvertisement.example.yaml` — **content_diff** (infra_script) sha256 staging=22643d572374… repo=9d137589b1a5…
- `infra/k8s/metallb/bgpadvertisement.yaml` — **content_diff** (infra_script) sha256 staging=f8c43c790e5c… repo=1bc5a831f2fc…
- `infra/k8s/metallb/bgppeer-frr.yaml` — **content_diff** (infra_script) sha256 staging=cdeaa357090a… repo=e44a324baec5…
- `infra/k8s/metallb/bgppeer.example.yaml` — **content_diff** (infra_script) sha256 staging=b9cb1918f033… repo=7ae333e2fb49…
- `infra/k8s/metallb/bgppeer.yaml` — **content_diff** (infra_script) sha256 staging=e23cdcbf21e7… repo=f302982d5c6e…
- `infra/k8s/metallb/ipaddresspool.yaml` — **content_diff** (infra_script) sha256 staging=ba18eb35ba28… repo=a5a207b99387…
- `infra/k8s/metallb/l2advertisement.yaml` — **content_diff** (infra_script) sha256 staging=7c4efe20c6b3… repo=4901f32f1f88…
- `scripts/apply-kafka-kraft-staged.sh` — **content_diff** (infra_script) sha256 staging=4f1c34880ee6… repo=864a7987207a…
- `scripts/check-kafka-config-drift.sh` — **content_diff** (infra_script) sha256 staging=0aa539551435… repo=763f641f5dee…
- `scripts/ci/generate-kafka-ci-tls.sh` — **content_diff** (infra_script) sha256 staging=9f1e048d6782… repo=0a2f99005db0…
- `scripts/ci/start-kafka-tls-ci.sh` — **content_diff** (infra_script) sha256 staging=5344695e47e0… repo=1f9521e73254…
- `scripts/create-kafka-event-topics-k8s.sh` — **content_diff** (infra_script) sha256 staging=bd99f1637ca1… repo=3c7173026554…
- `scripts/export-kafka-ca-metric.sh` — **content_diff** (infra_script) sha256 staging=490804cde837… repo=e5b331488b5d…
- `scripts/kafka-after-rollout-verify-brokers.sh` — **content_diff** (infra_script) sha256 staging=ae4c44d59349… repo=81affc48139e…
- `scripts/kafka-auto-heal-inter-broker-tls.sh` — **content_diff** (infra_script) sha256 staging=8168e71dbc8a… repo=7a9d04c378fd…
- `scripts/kafka-clean-slate.sh` — **content_diff** (infra_script) sha256 staging=4a33c80fdd2b… repo=02f76631bfe8…
- `scripts/kafka-onboarding-reset.sh` — **content_diff** (infra_script) sha256 staging=af3668581a01… repo=e5c024b83332…
- `scripts/kafka-quorum-stable.sh` — **content_diff** (infra_script) sha256 staging=8b3c7a386f76… repo=56daa6cb3846…
- `scripts/kafka-refresh-tls-from-lb.sh` — **content_diff** (infra_script) sha256 staging=adcef109c52a… repo=df008f526e35…
- `scripts/kafka-rolling-restart.sh` — **content_diff** (infra_script) sha256 staging=1cfeb9523cb2… repo=ca32ad71c4ff…
- `scripts/kafka-runtime-sync.sh` — **content_diff** (infra_script) sha256 staging=85ada7fef375… repo=b46466e72266…
- `scripts/kafka-ssl-from-dev-root.sh` — **content_diff** (infra_script) sha256 staging=7d27a298d6bc… repo=d5356fba84e6…
- `scripts/kafka-sync-metallb.sh` — **content_diff** (infra_script) sha256 staging=a948ba6f95f2… repo=61e86afcbed6…
- `scripts/kafka-tls-guard.sh` — **content_diff** (infra_script) sha256 staging=31d24b76edf8… repo=576b801d505e…
- `scripts/kafka-tls-rotate-atomic.sh` — **content_diff** (infra_script) sha256 staging=f1c2a0222ada… repo=dc4cdb631b1e…
- `scripts/lib/kafka-kraft-quorum-ok.sh` — **content_diff** (infra_script) sha256 staging=5b7398e60853… repo=0841670fc3dd…
- `scripts/preflight-kafka-k8s-rollout.sh` — **content_diff** (infra_script) sha256 staging=3ea4df21c8da… repo=94f9da127f2c…
- `scripts/tests/kafka-alignment-suite.sh` — **content_diff** (infra_script) sha256 staging=24b38f7413ac… repo=d236989319c3…
- `scripts/validate-kafka-dns.sh` — **content_diff** (infra_script) sha256 staging=c69312b42f43… repo=3facc961539e…
- `scripts/validate-kafka-stack-contract.sh` — **content_diff** (infra_script) sha256 staging=f52835e8e9b5… repo=3b245b15a6b6…
- `scripts/verify-cluster-kafka-three-brokers.sh` — **content_diff** (infra_script) sha256 staging=c91f95c2a431… repo=a4523badfa92…
- `scripts/verify-kafka-cluster.sh` — **content_diff** (infra_script) sha256 staging=d9d20e5bf5d2… repo=08dbdf86837e…
- `scripts/verify-kafka-event-topic-partitions.sh` — **content_diff** (infra_script) sha256 staging=355fc9a277ab… repo=c7db5fcb732a…
- `scripts/verify-kafka-kraft-advertised-listeners.sh` — **content_diff** (infra_script) sha256 staging=e4a2b53fbf58… repo=a7b6551b9be6…
- `scripts/verify-kafka-kraft-e2e.sh` — **content_diff** (infra_script) sha256 staging=5776b5efb45b… repo=3e7f86aced57…
- `scripts/verify-kafka-no-static-advertised-env.sh` — **content_diff** (infra_script) sha256 staging=2affdaadf4fd… repo=f0b1944032d6…
- `scripts/verify-kafka-tls-sans.sh` — **content_diff** (infra_script) sha256 staging=9a934d34f172… repo=c9d91bd0210e…
- `scripts/verify-preflight-edge-routing.sh` — **content_diff** (infra_script) sha256 staging=a66972a53b26… repo=24710251c622…
- `scripts/wait-for-kafka-external-lb-ips.sh` — **content_diff** (infra_script) sha256 staging=2cc2f806911e… repo=b37183641af2…
- `infra/k8s/base/observability/prometheus-rules-kafka-health.yaml` — **content_diff** (observability) sha256 staging=1670e95cec65… repo=93841a7992bd…
- `.github/workflows/kafka-alignment.yml` — **content_diff** (runtime_critical) sha256 staging=d0b6802c2fdb… repo=06e812117545…
- `.github/workflows/kafka-cluster-verify.yml` — **content_diff** (runtime_critical) sha256 staging=424f1daef170… repo=830db2da85fc…
- `.github/workflows/kafka-dns-validate.yml` — **content_diff** (runtime_critical) sha256 staging=9637901b561d… repo=bd8f3af85bdd…
- `README-BUNDLE.md` — **missing_in_repo** (bundle_only_scaffolding)
- `scripts/lib/och-kafka-event-topics-from-proto.sh` — **missing_in_repo** (infra_script)
- `infra/k8s/base/observability/prometheus-rules-och-slo.yaml` — **missing_in_repo** (observability)
