## Bundle Extraction Protocol v1

Extraction used `tools/bundle-audit/extract_bundle_v1.sh` (verify → index validate → extract → manifest match → per-file SHA256 → case check → freeze).

- **CHECKSUM_RECORD:** `/Users/tom/record-platform/docs/bundles/CHECKSUM_RECORD_record-platform-kafka-observability-proto-reference-20260410.txt`
- **INTEGRITY (machine):** `/Users/tom/record-platform/docs/bundles/INTEGRITY_record-platform-kafka-observability-proto-reference-20260410.json`

### INTEGRITY summary

```json
{
  "bundle_extraction_protocol": "v1",
  "generated_at": "2026-04-19T00:52:18.181683+00:00",
  "archive": "/Users/tom/record-platform-kafka-observability-proto-reference-20260410.tar.gz",
  "archive_sha256": "cccf91235608ce4b7d3b64db24defacd0bd3a5683e7695c8c5abbc73e83da912",
  "staging_path": "/Users/tom/bundle-staging/record-platform-kafka-observability-proto-reference-20260410",
  "archive_root_layout": {
    "type": "single_top_level",
    "root": "record-platform-kafka-observability-proto-reference-20260410"
  },
  "pre_extract": {
    "safe": true,
    "issues": [],
    "warnings": [],
    "file_member_count": 128
  },
  "post_extract": {
    "manifest_tar_equals_find": true,
    "file_count": 128,
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
# mechanical_parity: record-platform-kafka-observability-proto-reference-20260410.tar.gz
repo: /Users/tom/record-platform
stripped_prefix: ''
checked_paths: 306
missing_in_repo: 306
  MISSING ._record-platform-kafka-observability-proto-reference-20260410
  MISSING record-platform-kafka-observability-proto-reference-20260410
  MISSING record-platform-kafka-observability-proto-reference-20260410/._.github
  MISSING record-platform-kafka-observability-proto-reference-20260410/._Makefile
  MISSING record-platform-kafka-observability-proto-reference-20260410/._README-BUNDLE.md
  MISSING record-platform-kafka-observability-proto-reference-20260410/._infra
  MISSING record-platform-kafka-observability-proto-reference-20260410/._proto
  MISSING record-platform-kafka-observability-proto-reference-20260410/._scripts
  MISSING record-platform-kafka-observability-proto-reference-20260410/.github
  MISSING record-platform-kafka-observability-proto-reference-20260410/.github/._workflows
  MISSING record-platform-kafka-observability-proto-reference-20260410/.github/workflows
  MISSING record-platform-kafka-observability-proto-reference-20260410/.github/workflows/._kafka-alignment.yml
  MISSING record-platform-kafka-observability-proto-reference-20260410/.github/workflows/._kafka-cluster-verify.yml
  MISSING record-platform-kafka-observability-proto-reference-20260410/.github/workflows/._kafka-dns-validate.yml
  MISSING record-platform-kafka-observability-proto-reference-20260410/.github/workflows/kafka-alignment.yml
  MISSING record-platform-kafka-observability-proto-reference-20260410/.github/workflows/kafka-cluster-verify.yml
  MISSING record-platform-kafka-observability-proto-reference-20260410/.github/workflows/kafka-dns-validate.yml
  MISSING record-platform-kafka-observability-proto-reference-20260410/Makefile
  MISSING record-platform-kafka-observability-proto-reference-20260410/README-BUNDLE.md
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/._k8s
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/._base
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/._kafka-certs
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/._kafka-kraft-metallb
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/._metallb
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/._kafka
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/._kafka-ca-exporter
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/._kafka-external
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/._observability
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka-ca-exporter
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka-ca-exporter/._configmap.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka-ca-exporter/._deployment.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka-ca-exporter/._kustomization.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka-ca-exporter/._rbac.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka-ca-exporter/._service.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka-ca-exporter/configmap.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka-ca-exporter/deployment.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka-ca-exporter/kustomization.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka-ca-exporter/rbac.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka-ca-exporter/service.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka-external
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka-external/._external-service.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka-external/._kustomization.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka-external/external-service.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka-external/kustomization.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka/._deploy.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka/._external-service.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka/._kustomization.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka/._service.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka/deploy.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka/external-service.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka/kustomization.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/kafka/service.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/._alertmanager-slo-route-example.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/._grafana-dashboard-auth-outbox.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/._grafana-dashboard-providers.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/._grafana-dashboards-transport.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/._grafana-dashboards.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/._grafana-deploy.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/._jaeger-deploy.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/._kustomization.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/._namespace.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/._newrelic-secret.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/._och-slo-prometheusrule.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/._otel-collector-deploy.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/._otel-instrumentation.md.gz
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/._podmonitors.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/._prometheus-deploy.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/._prometheus-rules-auth-outbox.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/._prometheus-rules-kafka-health.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/._prometheus-rules-och-slo.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/._servicemonitors.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/._splunk-secret.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/alertmanager-slo-route-example.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/grafana-dashboard-auth-outbox.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/grafana-dashboard-providers.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/grafana-dashboards-transport.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/grafana-dashboards.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/grafana-deploy.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/jaeger-deploy.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/kustomization.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/namespace.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/newrelic-secret.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/och-slo-prometheusrule.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/otel-collector-deploy.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/otel-instrumentation.md.gz
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/podmonitors.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/prometheus-deploy.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/prometheus-rules-auth-outbox.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/prometheus-rules-kafka-health.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/prometheus-rules-och-slo.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/servicemonitors.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/base/observability/splunk-secret.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/kafka-certs
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/kafka-certs/._README.md
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/kafka-certs/._certificates
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/kafka-certs/._clusterissuer-kafka-broker.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/kafka-certs/._kafka-tls-preflight-job.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/kafka-certs/._kustomization.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/kafka-certs/README.md
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/kafka-certs/certificates
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/kafka-certs/certificates/._kafka-0-cert.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/kafka-certs/certificates/._kafka-1-cert.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/kafka-certs/certificates/._kafka-2-cert.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/kafka-certs/certificates/kafka-0-cert.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/kafka-certs/certificates/kafka-1-cert.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/kafka-certs/certificates/kafka-2-cert.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/kafka-certs/clusterissuer-kafka-broker.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/kafka-certs/kafka-tls-preflight-job.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/kafka-certs/kustomization.yaml
  MISSING record-platform-kafka-observability-proto-reference-20260410/infra/k8s/kafka-kraft-metallb
... (truncated; re-run mechanical_parity_tar_vs_repo.py for full list)
```

---

# Bundle analysis: `record-platform-kafka-observability-proto-reference-20260410`

Generated by `tools/bundle-audit/bundle_ingestion_analyze.py` (controlled ingestion; repo is canonical).

## Metadata

- **Staging tree:** `/Users/tom/bundle-staging/record-platform-kafka-observability-proto-reference-20260410`
- **Repo root:** `/Users/tom/record-platform`
- **Source tarball:** `/Users/tom/record-platform-kafka-observability-proto-reference-20260410.tar.gz`
- **Detected strip prefix:** `record-platform-kafka-observability-proto-reference-20260410`
- **Files under staging (after skips):** 128
- **UTC timestamp:** 2026-04-19T00:52:18.661970+00:00

## Parity summary

| Class | Count |
|-------|------:|
| `content_diff` | 95 |
| `identical` | 29 |
| `missing_in_repo` | 4 |

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
- … *40 more*

### `observability`

- `infra/k8s/base/observability/alertmanager-slo-route-example.yaml [content_diff]`
- `infra/k8s/base/observability/grafana-dashboard-auth-outbox.yaml [content_diff]`
- `infra/k8s/base/observability/grafana-dashboard-providers.yaml [content_diff]`
- `infra/k8s/base/observability/grafana-dashboards-transport.yaml [content_diff]`
- `infra/k8s/base/observability/grafana-dashboards.yaml [content_diff]`
- `infra/k8s/base/observability/grafana-deploy.yaml [content_diff]`
- `infra/k8s/base/observability/jaeger-deploy.yaml [content_diff]`
- `infra/k8s/base/observability/kustomization.yaml [content_diff]`
- `infra/k8s/base/observability/namespace.yaml [identical]`
- `infra/k8s/base/observability/newrelic-secret.yaml [identical]`
- `infra/k8s/base/observability/och-slo-prometheusrule.yaml [missing_in_repo]`
- `infra/k8s/base/observability/otel-collector-deploy.yaml [identical]`
- `infra/k8s/base/observability/otel-instrumentation.md.gz [identical]`
- `infra/k8s/base/observability/podmonitors.yaml [content_diff]`
- `infra/k8s/base/observability/prometheus-deploy.yaml [content_diff]`
- `infra/k8s/base/observability/prometheus-rules-auth-outbox.yaml [identical]`
- `infra/k8s/base/observability/prometheus-rules-kafka-health.yaml [content_diff]`
- `infra/k8s/base/observability/prometheus-rules-och-slo.yaml [missing_in_repo]`
- `infra/k8s/base/observability/servicemonitors.yaml [identical]`
- `infra/k8s/base/observability/splunk-secret.yaml [identical]`
- `scripts/diagram/data/kafka-broker-status.prometheus-notes.md [identical]`

### `optional_docs`

- `proto/events/README.md [content_diff]`

### `optional_other`

- `Makefile [content_diff]`
- `proto/common.proto [content_diff]`
- `proto/events/analytics.proto [content_diff]`
- `proto/events/auth.proto [content_diff]`
- `proto/events/booking.proto [content_diff]`
- `proto/events/envelope.proto [content_diff]`
- `proto/events/listing.proto [content_diff]`
- `proto/events/media.proto [content_diff]`
- `proto/events/messaging.proto [content_diff]`
- `proto/events/messaging/v1/messaging_events.proto [content_diff]`
- `proto/events/notification.proto [content_diff]`
- `proto/events/trust.proto [content_diff]`

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
- `scripts/chaos-kafka-alignment-stochastic.sh` — **content_diff** (infra_script) sha256 staging=ad6a6e0f97be… repo=2be807dee56e…
- `scripts/chaos-kafka-broker.sh` — **content_diff** (infra_script) sha256 staging=2cb6feea30ee… repo=623661e321df…
- `scripts/chaos-kafka-partition.sh` — **content_diff** (infra_script) sha256 staging=66937c2fbcbb… repo=341f9cc8b486…
- `scripts/chaos-metallb-kafka-lb.sh` — **content_diff** (infra_script) sha256 staging=8a729dcbece1… repo=a054c856520d…
- `scripts/check-kafka-config-drift.sh` — **content_diff** (infra_script) sha256 staging=0aa539551435… repo=763f641f5dee…
- `scripts/ci/generate-kafka-ci-tls.sh` — **content_diff** (infra_script) sha256 staging=9f1e048d6782… repo=0a2f99005db0…
- `scripts/ci/start-kafka-tls-ci.sh` — **content_diff** (infra_script) sha256 staging=5344695e47e0… repo=1f9521e73254…
- `scripts/cleanup-kafka-ops-cronjob-pods.sh` — **content_diff** (infra_script) sha256 staging=dbbf1fedb1f3… repo=7bfa7bb38e46…
- `scripts/create-kafka-event-topics-k8s.sh` — **content_diff** (infra_script) sha256 staging=bd99f1637ca1… repo=3c7173026554…
- `scripts/create-kafka-event-topics.sh` — **content_diff** (infra_script) sha256 staging=d1ad5b10d745… repo=de37bad6bd39…
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
- `scripts/verify-proto-events-topics.sh` — **content_diff** (infra_script) sha256 staging=6943f175373d… repo=e580d153cf27…
- `scripts/verify-proto-topic-alignment.sh` — **content_diff** (infra_script) sha256 staging=990f7e3576c6… repo=247e046252e0…
- `scripts/wait-for-kafka-external-lb-ips.sh` — **content_diff** (infra_script) sha256 staging=2cc2f806911e… repo=b37183641af2…
- `infra/k8s/base/observability/alertmanager-slo-route-example.yaml` — **content_diff** (observability) sha256 staging=9dfc518ea0d1… repo=e2ed42aa0470…
- `infra/k8s/base/observability/grafana-dashboard-auth-outbox.yaml` — **content_diff** (observability) sha256 staging=df6201459339… repo=cd8f9bd89c55…
- `infra/k8s/base/observability/grafana-dashboard-providers.yaml` — **content_diff** (observability) sha256 staging=55bcb30066e2… repo=130f6b42a58f…
- `infra/k8s/base/observability/grafana-dashboards-transport.yaml` — **content_diff** (observability) sha256 staging=cee3301de182… repo=da4c6e86fe40…
- `infra/k8s/base/observability/grafana-dashboards.yaml` — **content_diff** (observability) sha256 staging=21a55bf3aa1b… repo=f0ebe279b471…
- `infra/k8s/base/observability/grafana-deploy.yaml` — **content_diff** (observability) sha256 staging=88a6eeeef3ef… repo=a208df5696c6…
- `infra/k8s/base/observability/jaeger-deploy.yaml` — **content_diff** (observability) sha256 staging=e96c804deced… repo=21bfad33537e…
- `infra/k8s/base/observability/kustomization.yaml` — **content_diff** (observability) sha256 staging=1cbec5cba0cf… repo=45ca04429451…
- `infra/k8s/base/observability/podmonitors.yaml` — **content_diff** (observability) sha256 staging=478a35ca66ca… repo=3710aa84b6ff…
- `infra/k8s/base/observability/prometheus-deploy.yaml` — **content_diff** (observability) sha256 staging=508cf5d21904… repo=9e03ed20115d…
- `infra/k8s/base/observability/prometheus-rules-kafka-health.yaml` — **content_diff** (observability) sha256 staging=1670e95cec65… repo=93841a7992bd…
- `proto/events/README.md` — **content_diff** (optional_docs) sha256 staging=5d17e332fdcd… repo=47d4c2a7c569…
- `Makefile` — **content_diff** (optional_other) sha256 staging=f9989cb04c7c… repo=cb421630f46f…
- `proto/common.proto` — **content_diff** (optional_other) sha256 staging=7ec3b2a34010… repo=3b2e7c3e2e73…
- `proto/events/analytics.proto` — **content_diff** (optional_other) sha256 staging=9de242ad2789… repo=f1c8e1f1b4dd…
- `proto/events/auth.proto` — **content_diff** (optional_other) sha256 staging=fe6a46feab4c… repo=c5ba054c31af…
- `proto/events/booking.proto` — **content_diff** (optional_other) sha256 staging=ec6521734fc2… repo=58636de68d03…
- `proto/events/envelope.proto` — **content_diff** (optional_other) sha256 staging=1b420f6b27ff… repo=d561c8ae66dc…
- `proto/events/listing.proto` — **content_diff** (optional_other) sha256 staging=bff7b11c64c8… repo=d307bbfdc981…
- `proto/events/media.proto` — **content_diff** (optional_other) sha256 staging=3d1338033c85… repo=310c377bc56a…
- `proto/events/messaging.proto` — **content_diff** (optional_other) sha256 staging=23713911f0cb… repo=55c9f3ce8ba9…
- `proto/events/messaging/v1/messaging_events.proto` — **content_diff** (optional_other) sha256 staging=2af794c236b0… repo=6193fd80fc79…
- `proto/events/notification.proto` — **content_diff** (optional_other) sha256 staging=416e59b06155… repo=5fbb7f5ba624…
- `proto/events/trust.proto` — **content_diff** (optional_other) sha256 staging=72e0cd7ca632… repo=5928fe62e2ec…
- `.github/workflows/kafka-alignment.yml` — **content_diff** (runtime_critical) sha256 staging=d0b6802c2fdb… repo=06e812117545…
- `.github/workflows/kafka-cluster-verify.yml` — **content_diff** (runtime_critical) sha256 staging=424f1daef170… repo=830db2da85fc…
- `.github/workflows/kafka-dns-validate.yml` — **content_diff** (runtime_critical) sha256 staging=9637901b561d… repo=bd8f3af85bdd…
- `README-BUNDLE.md` — **missing_in_repo** (bundle_only_scaffolding)
- `scripts/lib/och-kafka-event-topics-from-proto.sh` — **missing_in_repo** (infra_script)
- `infra/k8s/base/observability/och-slo-prometheusrule.yaml` — **missing_in_repo** (observability)
- `infra/k8s/base/observability/prometheus-rules-och-slo.yaml` — **missing_in_repo** (observability)
