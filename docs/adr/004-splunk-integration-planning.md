# ADR-004: Splunk Integration — Planning

**Status:** Planning  
**Date:** 2026-02  
**Context:** Record Platform has an observability stack (Prometheus, Grafana, Jaeger, OpenTelemetry Collector, optional New Relic). We want to plan how **Splunk** (or Splunk-style log/event ingestion and search) could be integrated so that logs and optionally metrics/traces are available in a central place for ops and debugging.

## Current state

- **Logs**: Service stdout/stderr, Kubernetes logs (`kubectl logs`), Docker/containerd.
- **Metrics**: Prometheus scrapes; Grafana dashboards.
- **Traces**: Jaeger via OTel Collector.
- **No central log store** (e.g. no Elasticsearch/Splunk/Loki) for long-term search and alerting.

## Goals

- Plan **Splunk** (or equivalent) integration: log ingestion from K8s pods, Docker, and key files (e.g. Caddy, Envoy, gateway).
- Define scope: logs only vs logs + metrics (Splunk metrics) vs logs + metrics + traces (Splunk APM); start minimal (logs).
- Produce a short **integration plan**: how logs get from record-platform to Splunk (forwarders, HTTP event collector, or sidecar), and how to keep existing Prometheus/Grafana/Jaeger unchanged.

## Scope (planning)

1. **Data sources**
   - Kubernetes: pod logs (which namespaces: record-platform, ingress-nginx, monitoring, observability).
   - Docker Compose: Postgres, Redis, Kafka logs (if we want DB logs in Splunk).
   - Host/edge: Caddy/Envoy logs if written to files.

2. **Ingestion**
   - Splunk Universal Forwarder on nodes vs DaemonSet in K8s.
   - Or: Fluent Bit / Fluentd → Splunk HEC (HTTP Event Collector).
   - Or: OTel Collector Splunk exporter (if we add logs pipeline to OTel).

3. **Retention and indexing**
   - What to index (which log sources, which fields); retention policy (e.g. 30 days hot, 90 days warm).
   - Indexes: one per environment or per layer (app, infra, security).

4. **Operational impact**
   - No change to application code if we use forwarders/sidecars.
   - Prometheus/Grafana/Jaeger remain primary for metrics and traces unless we later add Splunk metrics/APM.

## Decisions (to be made)

- [ ] Splunk Cloud vs Splunk Enterprise (self-hosted).
- [ ] Forwarder vs Fluent Bit/OTel to HEC.
- [ ] Which namespaces and workloads to include in the first phase.

## Next steps

- Document one recommended path (e.g. “Fluent Bit DaemonSet → Splunk HEC”) with a minimal config sample.
- Add a “Logging and Splunk (planned)” subsection to ENGINEERING.md or Runbook when the plan is approved.
- If Splunk is adopted: add Splunk to the observability diagram and list it in README supporting infrastructure.
