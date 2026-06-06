# OCH → RP rewrite scan: `record-platform-kafka-kraft-3broker-kafka-certs-20260410`

**Staging (read-only scan):** `/Users/tom/bundle-staging/record-platform-kafka-kraft-3broker-kafka-certs-20260410`

This report lists **detected** OCH-era strings. It does **not** apply edits.

---

## Namespace references

*Kubernetes / config namespace strings*

**Hits:** 1 (capped per file in scanner)

- `record-platform-kafka-3broker-kraft-kafka-certs-20260410/README-BUNDLE.md`
  - L37: `Follow **Off-Campus-Housing-Tracker** upstream license.`

## SNI / hostnames

*Hosts, URLs, and dotted domains*

*None found in scanned text files.*

## OCH-prefixed identifiers

*Secrets, services, env keys with och- / och_*

**Hits:** 4 (capped per file in scanner)

- `record-platform-kafka-3broker-kraft-kafka-certs-20260410/README-BUNDLE.md`
  - L26: `Brokers still need **`och-kafka-ssl-secret`** (JKS) for the Confluent image unless you wire PEM from cert-manager into the StatefulSet — see **`infra/k8s/kafka-certs/README.md`**.`
- `record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-certs/README.md`
  - L47: `After Kafka and `och-kafka-ssl-secret` exist:`
- `record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-certs/kafka-tls-preflight-job.yaml`
  - L2: `# Apply after Kafka + och-kafka-ssl-secret exist:`
  - L52: `secretName: och-kafka-ssl-secret`

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

**Hits:** 1 (capped per file in scanner)

- `record-platform-kafka-3broker-kraft-kafka-certs-20260410/infra/k8s/kafka-certs/README.md`
  - L24: `HOUSING_NS=record-platform bash scripts/verify-kafka-tls-sans.sh`

---

## Summary

Apply **`docs/bundles/OCH_TO_RP_CONVERSION_MATRIX.md`** when porting; prefer surgical patches over bulk replace.
