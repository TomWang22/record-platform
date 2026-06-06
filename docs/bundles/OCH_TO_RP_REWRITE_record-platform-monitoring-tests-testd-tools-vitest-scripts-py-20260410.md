# OCH → RP rewrite scan: `record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410`

**Staging (read-only scan):** `/Users/tom/bundle-staging/record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410`

This report lists **detected** OCH-era strings. It does **not** apply edits.

---

## Namespace references

*Kubernetes / config namespace strings*

**Hits:** 5 (capped per file in scanner)

- `record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/README-BUNDLE.md`
  - L30: `Follow **Off-Campus-Housing-Tracker** upstream license.`
- `record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/monitoring/prometheus-rules/kafka-kraft-dns.yaml`
  - L23: `namespace="off-campus-housing-tracker",`
  - L36: `(sum(kube_pod_status_condition{namespace="off-campus-housing-tracker", pod=~"kafka-[0-9]+", type="Ready", status="true"}) or vector(0)) < 2`
- `record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/package.json`
  - L2: `"name": "off-campus-housing-tracker",`
  - L52: `"setup:full-stack": "bash scripts/setup-full-off-campus-housing-stack.sh",`

## SNI / hostnames

*Hosts, URLs, and dotted domains*

*None found in scanned text files.*

## OCH-prefixed identifiers

*Secrets, services, env keys with och- / och_*

**Hits:** 27 (capped per file in scanner)

- `record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/package.json`
  - L23: `"test:system": "OCH_INTEGRATION_KAFKA_FROM_K8S_LB=1 ROLLUP_DISABLE_NATIVE=true vitest run --config vitest.system.config.mts",`
  - L34: `"rebuild:och:rollout": "bash scripts/rebuild-och-images-and-rollout.sh",`
  - L37: `"rebuild:service:analytics": "SERVICES=analytics-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L38: `"rebuild:service:auth": "SERVICES=auth-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L39: `"rebuild:service:booking": "SERVICES=booking-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L40: `"rebuild:service:cron": "SERVICES=cron-jobs bash scripts/rebuild-och-images-and-rollout.sh",`
  - L41: `"rebuild:service:listings": "SERVICES=listings-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L42: `"rebuild:service:media": "SERVICES=media-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L43: `"rebuild:service:messaging": "SERVICES=messaging-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L44: `"rebuild:service:notification": "SERVICES=notification-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L45: `"rebuild:service:search": "SERVICES=listings-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L46: `"rebuild:service:trust": "SERVICES=trust-service bash scripts/rebuild-och-images-and-rollout.sh",`
  - L47: `"rebuild:service:watchdog": "SERVICES=transport-watchdog bash scripts/rebuild-och-images-and-rollout.sh",`
  - L48: `"rebuild:gateway:rollout": "SERVICES=api-gateway bash scripts/rebuild-och-images-and-rollout.sh",`
- `record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/tests/system/listing-analytics.contract.test.ts`
  - L7: `* Topic creation: `tests/system/global-setup.ts` + `ensureVitestClusterKafkaTopic` (suffix from `vitest.system.config.mts`: `.sys-<pid>-<time>` via `OCH_KAFKA_TOPIC_SUFFIX` / `ochKafkaTopicIsolatio…`
  - L13: `*   OCH_INTEGRATION_KAFKA_FROM_K8S_LB=1 pnpm run test:system`
  - L64: `clientId: "och-system-contract-listing-producer",`
- `record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/tools/kafka-contract/src/index.ts`
  - L9: `* Env: REPO_ROOT, KAFKA_CONTRACT_PROTO_ROOT, PROTO_ROOT, ENV_PREFIX, OCH_KAFKA_TOPIC_SUFFIX, KAFKA_BROKER, KAFKA_SSL_*,`
  - L53: `const suf = topicSuffixFromEnv(process.env.OCH_KAFKA_TOPIC_SUFFIX);`
  - L204: `ENV_PREFIX, OCH_KAFKA_TOPIC_SUFFIX, KAFKA_BROKER, KAFKA_SSL_ENABLED,`
  - L207: `OCH_KAFKA_REQUIRE_QUORUM_3=1 — scripts/validate-kafka-stack-contract.sh sets min brokers to 3 when used there`
- `record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/tools/kafka-contract/src/topicBuilder.ts`
  - L2: `* Match scripts/lib/och-kafka-event-topics-from-proto.sh + ochKafkaTopicIsolationSuffix().`
- `record-platform-monitoring-tests-testd-tools-vitest-scripts-py-20260410/vitest.system.config.mts`
  - L13: `process.env.OCH_REPO_ROOT?.trim() ||`
  - L24: `process.env.OCH_KAFKA_TOPIC_SUFFIX = `.sys-${process.pid}-${Date.now()}`;`
  - L29: `const suffixClean = process.env.OCH_KAFKA_TOPIC_SUFFIX.replace(/^\.+/u, "").replace(/[^a-zA-Z0-9_.-]/gu, "-");`
  - L30: `process.env.ANALYTICS_LISTING_KAFKA_GROUP ??= `och-sys-contract-${suffixClean}`;`
  - L47: `OCH_KAFKA_TOPIC_SUFFIX: process.env.OCH_KAFKA_TOPIC_SUFFIX!,`

## K8s `namespace:` lines (YAML)

*Raw namespace: declarations*

*None found in scanned text files.*

## Cert / SAN hints

*x509-ish strings mentioning OCH hosts*

*None found in scanned text files.*

## Hardcoded gateway / legacy ports

*4020-style ports (RP api-gateway default is :4000)*

*None found in scanned text files.*

## HOUSING / legacy env

*Environment variables and assignments*

*None found in scanned text files.*

---

## Summary

Apply **`docs/bundles/OCH_TO_RP_CONVERSION_MATRIX.md`** when porting; prefer surgical patches over bulk replace.
