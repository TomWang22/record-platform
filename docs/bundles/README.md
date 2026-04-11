# Vendored bundle documentation

See **[`../README.md`](../README.md)** for a short index of `docs/` (this directory, **`TARBALL_SELECTIVE_MERGE.md`**, **`COMMAND_CENTER.md`**, etc.).

- **`TARBALL_SELECTIVE_MERGE.md`** — How **all** `record-platform*.tar.gz` archives under **`~/`** were audited; what merges safely; what to **never** overwrite blindly; **second-pass** additive merge (base protos, strict-envelope / transport-routing, dev overlay patches, **`scripts/resilience-interactive-menu.sh`**). Linked from **`ENGINEERING.md`** (intro), **`docs/COMMAND_CENTER.md`** (SHA table), and **`docs/README.md`**.
- **`kafka-kraft-3broker-kafka-certs-20260410/README-BUNDLE.md`** — Standalone **`infra/k8s/kafka-kraft-metallb/`** + **`infra/k8s/kafka-certs/`** (SHA **`e547496e…`**).

- **`preflight-kafka-caddy-20260409/`** — Extracted from `record-platform-och-preflight-kafka-kraft-certs-caddy-reference-20260409.tar.gz` (SHA-256 in **`docs/COMMAND_CENTER.md`**): `README-BUNDLE.md`, `PLATFORM_REUSE_AND_PREFLIGHT.md`, `CADDY_IMAGE_XCADDY_TCPDUMP_TSHARK.md`.
- **`makefile-golden-chaos-kafka-20260410/`** — From `record-platform-makefile-golden-snapshot-kafka-chaos-20260410.tar.gz`: golden snapshot + chaos Make targets; extract with `tar xzf …` then `cd record-platform-makefile-golden-chaos-kafka-20260410`. In-tree: **`docs/kafka/KRAFT_THREE_BROKER_TLS.md`**, **`infra/k8s/base/observability/prometheus-rules-kafka-health.yaml`**, **`scripts/rebuild-all-record-platform-images-k3s.sh`**.

Regenerate after a new tarball: extract the three markdown files into this directory (keep paths stable so **`docs/COMMAND_CENTER.md`** links stay valid).
