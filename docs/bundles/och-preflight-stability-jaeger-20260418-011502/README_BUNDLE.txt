OCH — Preflight + cluster stability + Jaeger + QUIC / HTTP3 transport bundle (upstream paths)
===============================================================================================

This archive matches the Off-Campus-Housing-Tracker repo (no hostname/namespace rewrites).

Includes (high level):
  • Makefile (full root) + make-fragments/Makefile.packet-capture.fragment + Makefile.transport-quic.fragment
  • scripts/lib/quic_command_center/*.py + scripts/lib/quic-forensic/*.sh
  • Cluster: scripts/cluster-stability-guard.sh, scripts/phase-barrier.sh (+ docs/preflight-phase-barrier-contract.md when present upstream)
  • Preflight / transport: scripts/preflight-controlled-transport-otel-prove.sh,
    scripts/run-preflight-scale-and-all-suites.sh, docs/preflight-transport-phase-grep.txt
  • 7b load-phase contract: scripts/transport-study-v7b.mjs, schemas/transport-study-v7b.schema.json,
    scripts/run-transport-study-experiments.sh (PREFLIGHT_TRANSPORT_STUDY_REQUIRED path)
  • Jaeger: scripts/verify-jaeger-*.sh, verify-jaeger-trace-flows.mjs, seed-jaeger-via-edge-health.sh,
    validate-jaeger-lb.sh, infra/k8s/base/observability/jaeger-deploy.yaml + kustomization.yaml,
    infra/observability/trace-flows.json
  • QUIC + capture: packet-capture-v2.sh, analyzers, verify-quic-jaeger-correlation.mjs, CI hostname script,
    requirements-transport-forensics.txt, example Prometheus rule
  • Listings Vitest: services/listings-service/vitest.integration.config.mts
  • Meta: README_BUNDLE.txt, MANIFEST.txt, scripts/package-och-preflight-transport-bundle.sh

Record Platform port (record.test / record-platform everywhere in bundle):
  RECORD_PLATFORM_PORTING_BUNDLE=1 bash scripts/package-och-preflight-transport-bundle.sh

Regenerate (upstream):
  bash scripts/package-och-preflight-transport-bundle.sh
  OCH_PREFLIGHT_BUNDLE_DIR=/tmp bash scripts/package-och-preflight-transport-bundle.sh

Extract:
  tar -xzf /path/to/och-preflight-cluster-stability-jaeger-transport-bundle-<stamp>.tar.gz -C /path/to/dest

No secrets. PCAPs and sslkeylog outputs are created at runtime.
