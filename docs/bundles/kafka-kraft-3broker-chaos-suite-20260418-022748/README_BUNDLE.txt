Kafka KRaft — 3 brokers + MetalLB + alignment test suite + chaos bundle
========================================================================

What this tarball contains
--------------------------
  • infra/k8s/kafka-kraft-metallb/ — StatefulSet (replicas: 3), headless + per-broker external LB Services, RBAC, PDB, alignment exporter
  • infra/k8s/kafka-certs/ — cert-manager ClusterIssuer + per-broker Certificate CRDs + preflight Job (see README.md inside)
  • infra/k8s/kafka-ops/ — optional CronJob wiring for alignment validation
  • infra/docker/kafka-alignment-cron/ — image build context for that CronJob
  • scripts/tests/kafka-alignment-suite.sh — full alignment suite (safe default; KAFKA_ALIGNMENT_TEST_MODE=1 for destructive tests)
  • scripts/run-chaos-suite.sh + chaos-kafka-alignment-stochastic.sh (+ related chaos scripts / generate-chaos-report.py)
  • Kafka TLS / LB sync helpers: kafka-runtime-sync, kafka-refresh-tls-from-lb, verify-kafka-cluster, check-kafka-config-drift, …
  • Cert generation (no private keys in this archive):
      - scripts/dev-generate-certs.sh — local CA + leaf + optional Kafka JKS under certs/ (openssl + optional keytool)
      - scripts/ensure-dev-root-ca.sh — ensures dev-root.pem/key (may invoke pnpm reissue if present in a full repo)
      - scripts/kafka-ssl-from-dev-root.sh — broker keystore + kafka-ssl-secret from dev-root CA + MetalLB SANs
      - scripts/generate-canonical-dev-tls.sh — ordered full-stack TLS orchestration (calls additional scripts if you extend the bundle)
  • certs/README.txt — expectations and EKU notes for Kafka broker material
  • make-fragments/*.fragment — Makefile excerpts for: kafka-alignment-suite, kafka-health, apply-kafka-kraft, chaos-suite-kafka
  • .github/workflows/kafka-cluster-verify.yml — CI touchpoints for alignment script
  • prometheus-rules-kafka-health.yaml — alert hints referencing the alignment suite

Prerequisites on the target cluster
------------------------------------
  • kubectl, openssl; keytool recommended for JKS
  • MetalLB (or equivalent) with an address pool for kafka-*-external LoadBalancers
  • Namespace record-platform (see infra/k8s/base/namespaces.yaml) or set HOUSING_NS consistently

Typical apply order (Colima / dev)
-----------------------------------
  1. kubectl apply -f infra/k8s/base/namespaces.yaml   # or create HOUSING_NS only
  2. Generate TLS: ./scripts/dev-generate-certs.sh   # from bundle root (creates certs/dev-root.*, etc.)
  3. ./scripts/kafka-ssl-from-dev-root.sh            # kafka-ssl-secret with SANs for 3 brokers + LB IPs when brokers exist
  4. make apply-kafka-kraft   # or: bash scripts/apply-kafka-kraft-staged.sh
  5. ./scripts/tests/kafka-alignment-suite.sh
  6. Destructive chaos (requires explicit flags):
       CHAOS_CONFIRM=1 KAFKA_ALIGNMENT_TEST_MODE=1 make chaos-suite-kafka
     or run components manually (see scripts/run-chaos-suite.sh).

Regenerate this tarball from the OCH repo:
  bash scripts/package-kafka-kraft-3broker-chaos-bundle.sh

No committed secrets. Generate keys locally; do not commit .key / .jks from certs/.
