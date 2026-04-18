Record Platform — OCH preflight + scale suites + transport v7b (ported paths)
=============================================================================

Bundled defaults (rewritten from OCH upstream):
  • Edge hostname / SNI: record.test  (override HOST / CAPTURE_EXPECTED_SNI)
  • Kubernetes workload namespace: record-platform  (override NS / HOUSING_NS)

Same layout as the OCH upstream bundle, including:
  • scripts/lib/quic_command_center/*.py and scripts/lib/quic-forensic/*.sh (rewritten)
  • scripts/run-preflight-scale-and-all-suites.sh, transport-study-v7b.mjs, Jaeger helpers, Makefile + fragments

Regenerate:
  RECORD_PLATFORM_PORTING_BUNDLE=1 bash scripts/package-och-preflight-transport-bundle.sh

Extract:
  tar -xzf /path/to/record-platform-och-preflight-scale-transport-v7b-<stamp>.tar.gz -C /path/to/dest
