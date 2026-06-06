# OCH → Record Platform reference bundle

This archive is a **full export** of **`scripts/`** from **Off-Campus-Housing-Tracker**, plus **Kafka / MetalLB / observability** Kubernetes manifests, **Prometheus & Grafana** rule/dashboard packs, **`proto/events`**, **`infra/db`** SQL (including **outbox** schemas), and the repo **`Makefile`** + selected **GitHub Actions** workflows.

Nothing in this bundle was committed back into the OCH repo; it is meant to live **beside** Record Platform.

## Read next

| Document | Purpose |
|----------|---------|
| **[RECORD_PLATFORM_ALIGNMENT.md](./RECORD_PLATFORM_ALIGNMENT.md)** | Rename paths, namespaces, ports, `REPO_ROOT`, `ENV_PREFIX`, and Makefile integration. |
| **[OUTBOX_AND_OBSERVABILITY.md](./OUTBOX_AND_OBSERVABILITY.md)** | Auth and domain **outbox** SQL, scripts, metrics, PrometheusRules, Grafana dashboards. |

## Top-level layout

```
Makefile                          # OCH targets; set REPO_ROOT to this unpack directory
scripts/                          # Complete tree (469+ files): bash, k6, Python helpers, lib/, ci/, tests/, load/, diagram/, …
proto/common.proto
proto/events/                     # Event envelope + domain payloads (adapt go_package)
infra/k8s/…                     # KRaft 3-broker, MetalLB, observability stack YAML
infra/monitoring/               # Extra Prometheus rules + Grafana JSON (kafka, TLS, outbox, …)
infra/db/                         # SQL including *-outbox.sql and service schemas
.github/workflows/              # kafka-* + protocol-validation (shellcheck surface)
```

## License

Follow the license of the upstream **Off-Campus-Housing-Tracker** repository.
