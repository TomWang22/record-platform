## Bundle Extraction Protocol v1

Extraction used `tools/bundle-audit/extract_bundle_v1.sh` (verify → index validate → extract → manifest match → per-file SHA256 → case check → freeze).

- **CHECKSUM_RECORD:** `/Users/tom/record-platform/docs/bundles/CHECKSUM_RECORD_record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410.txt`
- **INTEGRITY (machine):** `/Users/tom/record-platform/docs/bundles/INTEGRITY_record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410.json`

### INTEGRITY summary

```json
{
  "bundle_extraction_protocol": "v1",
  "generated_at": "2026-04-19T00:52:44.737657+00:00",
  "archive": "/Users/tom/record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410.tar.gz",
  "archive_sha256": "561d76b4f17b813659116772785d7770a6e5dd01a3f486b2fa4ad238a6593690",
  "staging_path": "/Users/tom/bundle-staging/record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410",
  "archive_root_layout": {
    "type": "single_top_level",
    "root": "record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410"
  },
  "pre_extract": {
    "safe": true,
    "issues": [],
    "warnings": [],
    "file_member_count": 77
  },
  "post_extract": {
    "manifest_tar_equals_find": true,
    "file_count": 77,
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
# mechanical_parity: record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410.tar.gz
repo: /Users/tom/record-platform
stripped_prefix: ''
checked_paths: 190
missing_in_repo: 190
  MISSING ._record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/._README-BUNDLE.md
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/._monitoring
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/._package.json
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/._pnpm-lock.yaml
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/._pnpm-workspace.yaml
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/._scripts
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/._testd
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/._tests
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/._tools
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/._tsconfig.base.json
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/._vitest.account-deletion.config.ts
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/._vitest.system.config.mts
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/README-BUNDLE.md
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/monitoring
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/monitoring/._prometheus-rules
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/monitoring/prometheus-rules
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/monitoring/prometheus-rules/._kafka-kraft-dns.yaml
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/monitoring/prometheus-rules/kafka-kraft-dns.yaml
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/package.json
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/pnpm-lock.yaml
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/pnpm-workspace.yaml
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/._calc-failure-budget.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/._generate-chaos-report.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/._generate-kafka-alignment-report.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/._generate-restart-timeline.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/._lib
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/._load
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/._perf
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/._requirements-kafka-alignment-report.txt
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/calc-failure-budget.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/generate-chaos-report.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/generate-kafka-alignment-report.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/generate-restart-timeline.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/._analyze_quic_metrics.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/._analyze_tls_timing.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/._bottleneck_classifier.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/._bottleneck_classifier_v2.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/._build_ceiling_report.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/._build_ceiling_report_v2.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/._compare-transport.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/._congestion_diff_engine.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/._dominance_map.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/._evaluate-breakpoint.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/._experiment_metadata.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/._format_ceiling_report.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/._http3_frame_inspector.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/._knee_detection.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/._knee_detection_v2.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/._knee_detection_v3.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/._loss_model.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/._pcap_transport_summary.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/._quic_loss_analyzer.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/._regression_detector.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/._transport-diff.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/._transport_validator.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/analyze_quic_metrics.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/analyze_tls_timing.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/bottleneck_classifier.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/bottleneck_classifier_v2.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/build_ceiling_report.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/build_ceiling_report_v2.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/compare-transport.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/congestion_diff_engine.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/dominance_map.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/evaluate-breakpoint.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/experiment_metadata.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/format_ceiling_report.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/http3_frame_inspector.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/knee_detection.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/knee_detection_v2.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/knee_detection_v3.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/loss_model.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/pcap_transport_summary.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/quic_loss_analyzer.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/regression_detector.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/transport-diff.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/lib/transport_validator.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/load
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/load/._aggregate-k6-summaries.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/load/aggregate-k6-summaries.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/perf
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/perf/._generate-service-envelope-report.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/perf/generate-service-envelope-report.py
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/scripts/requirements-kafka-alignment-report.txt
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/._domain
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/._physical
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/domain
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/domain/._domain.dot
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/domain/._domain.svg
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/domain/domain.dot
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/domain/domain.svg
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/physical
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/physical/._analytics.dot
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/physical/._analytics.svg
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/physical/._auth.dot
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/physical/._auth.svg
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/physical/._bookings.dot
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/physical/._bookings.svg
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/physical/._json
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/physical/._listings.dot
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/physical/._listings.svg
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/physical/._media.dot
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/physical/._media.svg
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/physical/._messaging.dot
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/physical/._messaging.svg
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/physical/._notification.dot
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/physical/._notification.svg
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/physical/._trust.dot
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/physical/._trust.svg
  MISSING record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/testd/physical/analytics.dot
... (truncated; re-run mechanical_parity_tar_vs_repo.py for full list)
```

---

# Bundle analysis: `record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410`

Generated by `tools/bundle-audit/bundle_ingestion_analyze.py` (controlled ingestion; repo is canonical).

## Metadata

- **Staging tree:** `/Users/tom/bundle-staging/record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410`
- **Repo root:** `/Users/tom/record-platform`
- **Source tarball:** `/Users/tom/record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410.tar.gz`
- **Detected strip prefix:** `record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410`
- **Files under staging (after skips):** 77
- **UTC timestamp:** 2026-04-19T00:52:45.176334+00:00

## Parity summary

| Class | Count |
|-------|------:|
| `identical` | 38 |
| `missing_in_repo` | 34 |
| `content_diff` | 5 |

## Classification (sample per bucket)

### `bundle_only_scaffolding`

- `README-BUNDLE.md [missing_in_repo]`

### `infra_script`

- `scripts/calc-failure-budget.py [identical]`
- `scripts/generate-chaos-report.py [identical]`
- `scripts/generate-kafka-alignment-report.py [identical]`
- `scripts/generate-restart-timeline.py [identical]`
- `scripts/lib/analyze_quic_metrics.py [identical]`
- `scripts/lib/analyze_tls_timing.py [identical]`
- `scripts/lib/bottleneck_classifier.py [identical]`
- `scripts/lib/bottleneck_classifier_v2.py [identical]`
- `scripts/lib/build_ceiling_report.py [identical]`
- `scripts/lib/build_ceiling_report_v2.py [identical]`
- `scripts/lib/compare-transport.py [identical]`
- `scripts/lib/congestion_diff_engine.py [identical]`
- `scripts/lib/dominance_map.py [identical]`
- `scripts/lib/evaluate-breakpoint.py [identical]`
- `scripts/lib/experiment_metadata.py [identical]`
- `scripts/lib/format_ceiling_report.py [identical]`
- `scripts/lib/http3_frame_inspector.py [identical]`
- `scripts/lib/knee_detection.py [identical]`
- `scripts/lib/knee_detection_v2.py [identical]`
- `scripts/lib/knee_detection_v3.py [identical]`
- `scripts/lib/loss_model.py [identical]`
- `scripts/lib/pcap_transport_summary.py [identical]`
- `scripts/lib/quic_loss_analyzer.py [identical]`
- `scripts/lib/regression_detector.py [identical]`
- `scripts/lib/transport-diff.py [identical]`
- `scripts/lib/transport_validator.py [content_diff]`
- `scripts/load/aggregate-k6-summaries.py [identical]`
- `scripts/perf/generate-service-envelope-report.py [identical]`
- `scripts/requirements-kafka-alignment-report.txt [identical]`
- `tools/kafka-contract/package.json [identical]`
- `tools/kafka-contract/src/index.ts [identical]`
- `tools/kafka-contract/src/kafkaClient.ts [identical]`
- `tools/kafka-contract/src/protoScanner.ts [identical]`
- `tools/kafka-contract/src/topicBuilder.ts [identical]`
- `tools/kafka-contract/src/types.ts [identical]`
- `tools/kafka-contract/src/validator.ts [identical]`
- `tools/kafka-contract/tsconfig.json [identical]`

### `observability`

- `monitoring/prometheus-rules/kafka-kraft-dns.yaml [content_diff]`

### `optional_other`

- `package.json [content_diff]`
- `pnpm-lock.yaml [content_diff]`
- `pnpm-workspace.yaml [identical]`
- `testd/domain/domain.dot [missing_in_repo]`
- `testd/domain/domain.svg [missing_in_repo]`
- `testd/physical/analytics.dot [missing_in_repo]`
- `testd/physical/analytics.svg [missing_in_repo]`
- `testd/physical/auth.dot [missing_in_repo]`
- `testd/physical/auth.svg [missing_in_repo]`
- `testd/physical/bookings.dot [missing_in_repo]`
- `testd/physical/bookings.svg [missing_in_repo]`
- `testd/physical/json/analytics.json [missing_in_repo]`
- `testd/physical/json/auth.json [missing_in_repo]`
- `testd/physical/json/bookings.json [missing_in_repo]`
- `testd/physical/json/listings.json [missing_in_repo]`
- `testd/physical/json/media.json [missing_in_repo]`
- `testd/physical/json/messaging.json [missing_in_repo]`
- `testd/physical/json/notification.json [missing_in_repo]`
- `testd/physical/json/trust.json [missing_in_repo]`
- `testd/physical/listings.dot [missing_in_repo]`
- `testd/physical/listings.svg [missing_in_repo]`
- `testd/physical/media.dot [missing_in_repo]`
- `testd/physical/media.svg [missing_in_repo]`
- `testd/physical/messaging.dot [missing_in_repo]`
- `testd/physical/messaging.svg [missing_in_repo]`
- `testd/physical/notification.dot [missing_in_repo]`
- `testd/physical/notification.svg [missing_in_repo]`
- `testd/physical/trust.dot [missing_in_repo]`
- `testd/physical/trust.svg [missing_in_repo]`
- `tests/account-deletion.e2e.test.ts [missing_in_repo]`
- `tests/system/booking-analytics.contract.test.ts [missing_in_repo]`
- `tests/system/global-setup.ts [missing_in_repo]`
- `tests/system/helpers/waitForCondition.ts [missing_in_repo]`
- `tests/system/listing-analytics.contract.test.ts [missing_in_repo]`
- `tsconfig.base.json [identical]`
- `vitest.account-deletion.config.ts [missing_in_repo]`
- `vitest.system.config.mts [content_diff]`

### `runtime_critical`

- `tests/helpers/wait-for-kafka-propagation.ts [missing_in_repo]`

## Safe import suggestions

- Paths marked **`missing_in_repo`** may be candidates for **add-if-missing** imports; review namespace/SNI (`record-platform`, `record.test`, `kafka-ssl-secret`).
- Paths marked **`content_diff`** require **manual diff** (`diff -u` or IDE); do not `cp -r` from staging.
- Prefer **`git apply`** / focused **`git checkout -- path`** over wholesale copy.
- **Do not** overwrite `scripts/run-preflight-scale-and-all-suites.sh` from bundles unless explicitly approved.

## Top paths to review

- `scripts/lib/transport_validator.py` — **content_diff** (infra_script) sha256 staging=0c8d991c99d5… repo=f54b9003eab5…
- `monitoring/prometheus-rules/kafka-kraft-dns.yaml` — **content_diff** (observability) sha256 staging=e13e6b5d212d… repo=530614f9fff2…
- `package.json` — **content_diff** (optional_other) sha256 staging=53a41f724cce… repo=11599ba9b6d7…
- `pnpm-lock.yaml` — **content_diff** (optional_other) sha256 staging=2054826bdd73… repo=11e42c866869…
- `vitest.system.config.mts` — **content_diff** (optional_other) sha256 staging=6f31945e4073… repo=34ec973cedb2…
- `README-BUNDLE.md` — **missing_in_repo** (bundle_only_scaffolding)
- `testd/domain/domain.dot` — **missing_in_repo** (optional_other)
- `testd/domain/domain.svg` — **missing_in_repo** (optional_other)
- `testd/physical/analytics.dot` — **missing_in_repo** (optional_other)
- `testd/physical/analytics.svg` — **missing_in_repo** (optional_other)
- `testd/physical/auth.dot` — **missing_in_repo** (optional_other)
- `testd/physical/auth.svg` — **missing_in_repo** (optional_other)
- `testd/physical/bookings.dot` — **missing_in_repo** (optional_other)
- `testd/physical/bookings.svg` — **missing_in_repo** (optional_other)
- `testd/physical/json/analytics.json` — **missing_in_repo** (optional_other)
- `testd/physical/json/auth.json` — **missing_in_repo** (optional_other)
- `testd/physical/json/bookings.json` — **missing_in_repo** (optional_other)
- `testd/physical/json/listings.json` — **missing_in_repo** (optional_other)
- `testd/physical/json/media.json` — **missing_in_repo** (optional_other)
- `testd/physical/json/messaging.json` — **missing_in_repo** (optional_other)
- `testd/physical/json/notification.json` — **missing_in_repo** (optional_other)
- `testd/physical/json/trust.json` — **missing_in_repo** (optional_other)
- `testd/physical/listings.dot` — **missing_in_repo** (optional_other)
- `testd/physical/listings.svg` — **missing_in_repo** (optional_other)
- `testd/physical/media.dot` — **missing_in_repo** (optional_other)
- `testd/physical/media.svg` — **missing_in_repo** (optional_other)
- `testd/physical/messaging.dot` — **missing_in_repo** (optional_other)
- `testd/physical/messaging.svg` — **missing_in_repo** (optional_other)
- `testd/physical/notification.dot` — **missing_in_repo** (optional_other)
- `testd/physical/notification.svg` — **missing_in_repo** (optional_other)
- `testd/physical/trust.dot` — **missing_in_repo** (optional_other)
- `testd/physical/trust.svg` — **missing_in_repo** (optional_other)
- `tests/account-deletion.e2e.test.ts` — **missing_in_repo** (optional_other)
- `tests/system/booking-analytics.contract.test.ts` — **missing_in_repo** (optional_other)
- `tests/system/global-setup.ts` — **missing_in_repo** (optional_other)
- `tests/system/helpers/waitForCondition.ts` — **missing_in_repo** (optional_other)
- `tests/system/listing-analytics.contract.test.ts` — **missing_in_repo** (optional_other)
- `vitest.account-deletion.config.ts` — **missing_in_repo** (optional_other)
- `tests/helpers/wait-for-kafka-propagation.ts` — **missing_in_repo** (runtime_critical)
