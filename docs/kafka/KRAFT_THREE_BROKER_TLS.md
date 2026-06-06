# KRaft Kafka — three brokers, TLS, and cert layout (Record Platform)

This repo’s **canonical** Kafka path is **3 combined broker+controller replicas** in namespace **`record-platform`**, with **TLS** on internal / external listeners and **mTLS** (`ssl.client.auth=required`) on INTERNAL and EXTERNAL.

## Relative paths (from repository root)

| What | Path |
|------|------|
| Kustomize bundle (Services, StatefulSet, PDB, MetalLB externals, alignment exporter) | **`infra/k8s/kafka-kraft-metallb/`** |
| Apply | `kubectl apply -k infra/k8s/kafka-kraft-metallb/` |
| Ops CronJobs (DNS slice repair, quorum check) | **`infra/ops/`** → `kubectl apply -k infra/ops/` |
| Replica guard (VAP; needs capable apiserver) | **`infra/policies/kafka-replica-guard.yaml`** |
| Dev CA + broker JKS + K8s `kafka-ssl-secret` | **`scripts/kafka-ssl-from-dev-root.sh`** |
| SAN source of truth (DNS names for `kafka-0..2`) | **`scripts/lib/kafka-broker-sans.sh`** |
| JKS EKU gate (serverAuth **and** clientAuth on broker cert) | **`scripts/verify-kafka-broker-keystore-jks.sh`** |
| cert-manager option (optional) | **`infra/k8s/kafka-certs/README.md`** |

## Three brokers

- **StatefulSet** `kafka`, **`spec.replicas: 3`**, **`podManagementPolicy: Parallel`** (required for KRaft bootstrap DNS).
- **Headless** Service **`kafka`** for **`kafka-0.kafka` … `kafka-2.kafka`** on **:9093** (INTERNAL SSL).
- **Per-broker LoadBalancer** Services **`kafka-0-external` … `kafka-2-external`** on **:9094** (EXTERNAL SSL) for MetalLB IPs in broker cert SANs.
- **Controller** quorum: env **`KAFKA_CONTROLLER_QUORUM_VOTERS`** uses **`kafka-0..2.kafka.record-platform.svc.cluster.local:9095`**.

See **`infra/k8s/kafka-kraft-metallb/kustomization.yaml`** and **`statefulset.yaml`** for the full wiring.

## Cert “folder” on disk (gitignored)

Generated material lives under **`certs/kafka-ssl/`** (parent **`certs/`** is in **`.gitignore`** — do not commit keys).

After **`certs/dev-root.pem`** and **`certs/dev-root.key`** exist:

```bash
./scripts/kafka-ssl-from-dev-root.sh
```

Defaults:

- **`KAFKA_BROKER_REPLICAS=3`**
- **`KAFKA_SSL_NS=record-platform`**
- Merges **MetalLB** IPs from **`kafka-*-external`** into the broker cert when discoverable.

Outputs (examples):

- **`certs/kafka-ssl/kafka.keystore.jks`** / **`kafka.truststore.jks`** + password files  
- **`certs/kafka-ssl/kafka-broker.pem`** (broker leaf)  
- **`certs/kafka-ssl/client.crt`** / **`client.key`** (app mTLS client; also stored in **`kafka-ssl-secret`**)

Kubernetes:

- Secret **`kafka-ssl-secret`** in **`record-platform`** (broker JKS + truststore + PEM + client material).

## serverAuth and clientAuth (broker leaf)

Kafka brokers use the **same** leaf for **listener (server)** and **inter-broker / client-verified** paths. The broker certificate **must** include:

- **`extendedKeyUsage = serverAuth, clientAuth`**

Otherwise you get handshake errors such as *Extended key usage does not permit use for TLS client authentication*.

This is enforced in **`scripts/kafka-ssl-from-dev-root.sh`** (OpenSSL signing extension) and **`scripts/verify-kafka-broker-keystore-jks.sh`** (keytool **ExtendedKeyUsages** must show **serverAuth** and **clientAuth**).

**Truststore / PKIX (3-stage CA):** broker leafs are signed by **`certs/dev-intermediate.pem`**, not the root directly. The Kafka **`kafka.truststore.jks`** must include **both** the intermediate and **`dev-root`** anchors; a root-only truststore causes *PKIX path building failed* on broker startup. Keystore PKCS12 includes **leaf + intermediate** chain. Gate: **`scripts/verify-kafka-broker-truststore-jks.sh`**.

The **app/client** identity uses a **separate** leaf with **`clientAuth` only** (`client.crt` / `client.key`).

## Chaos & golden snapshot (Make targets)

- **`make golden-snapshot`** — rebuild images + rollouts + **`make kafka-health`** + **`make kafka-alignment-suite`**; set **`GOLDEN_SNAPSHOT_CHAOS=1`** for destructive alignment + **`make chaos-suite-kafka`**.
- **`make chaos-suite`** / **`make chaos-suite-kafka`** / **`make governed-chaos`** — run **`scripts/run-chaos-suite.sh`** (+ stochastic alignment when confirmed).
- **`make chaos-kafka-broker`** — deletes **`kafka-1`** pod by default (**`CHAOS_KAFKA_BROKER_INDEX`**, **`CHAOS_CONFIRM=1`**); then **`verify-kafka-cluster`**.
- **Alignment suite:** **`make kafka-alignment-suite`** → **`scripts/tests/kafka-alignment-suite.sh`** (3-broker MetalLB / TLS / advertised listener checks; **`KAFKA_ALIGNMENT_TEST_MODE=1`** for mutating tests).

Broker cert **EKU** (**`serverAuth` + `clientAuth`**) for JKS: **`scripts/kafka-ssl-from-dev-root.sh`** + **`scripts/verify-kafka-broker-keystore-jks.sh`**; optional **`scripts/verify-kafka-broker-tls-eku.sh`** for PEM/JKS gates.

## DNS diagnostics

```bash
make diagnose-kafka-broker-dns
# or
HOUSING_NS=record-platform ./scripts/diagnose-kafka-broker-dns.sh
```

## Ops + policy (already in-tree)

```bash
kubectl apply -k infra/ops/
kubectl apply -f infra/policies/kafka-replica-guard.yaml   # optional; cluster must support VAP
```

## Makefile / golden / chaos **tarball** (reference tree)

To inspect the upstream bundle (do **not** unpack over this git checkout):

```bash
tar xzf /path/to/record-platform-makefile-golden-snapshot-kafka-chaos-20260410.tar.gz
cd record-platform-makefile-golden-chaos-kafka-20260410
```

**Record Platform** source of truth stays **this monorepo** (`record.test`, **api-gateway :4000**, **`record-platform`**, paths above). Merge only selected files after diff review.

See also **`docs/COMMAND_CENTER.md`**, **`docs/bundles/makefile-golden-chaos-kafka-20260410/README-BUNDLE.md`**, and **`docs/bundles/TARBALL_SELECTIVE_MERGE.md`** (full tarball audit).
