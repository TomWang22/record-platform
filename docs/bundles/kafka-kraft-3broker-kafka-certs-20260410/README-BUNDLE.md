# Record Platform — standalone Kafka KRaft (3 brokers) + cert-manager certs

**Archive:** `record-platform-kafka-kraft-3broker-kafka-certs-20260410.tar.gz`  
**SHA-256:** `e547496e053877dcbeec678e9b37a13b1f8c132e77285ceb893d4bf2b66359a9`

## Contents (merged into this monorepo)

| Path | Role |
|------|------|
| **`infra/k8s/kafka-kraft-metallb/`** | 3-broker KRaft: StatefulSet, headless **`kafka`**, **`kafka-{0,1,2}-external`**, PDB, RBAC, alignment exporter. |
| **`infra/k8s/kafka-certs/`** | cert-manager: **`ClusterIssuer`**, **`Certificate`** per broker with **server auth + client auth** usages, preflight Job, **`kustomization.yaml`**. |

## Extract (reference only — prefer git)

```bash
tar xzf /path/to/record-platform-kafka-kraft-3broker-kafka-certs-20260410.tar.gz
cd record-platform-kafka-3broker-kraft-kafka-certs-20260410
kubectl apply -k infra/k8s/kafka-kraft-metallb/
# optional, if cert-manager is installed:
kubectl apply -k infra/k8s/kafka-certs/
```

## Monorepo notes (vs tarball README)

- **Namespace:** **`record-platform`** (in-tree YAML).
- **Edge hostname:** canonical HTTPS is **`record.test`** (see **`docs/COMMAND_CENTER.md`**); tarball text may say **`record.local`** — irrelevant for these cluster-only manifests.
- **JKS path (default):** brokers use **`kafka-ssl-secret`** from **`scripts/kafka-ssl-from-dev-root.sh`** (shared JKS + **serverAuth + clientAuth** broker leaf). cert-manager **`Certificate`** CRs are an **optional** rotation path until PEM→JKS per pod is wired.
- **Preflight Job** mounts **`kafka-ssl-secret`** for client mTLS probes (legacy **`och-kafka-ssl-secret`** is the same material if you only have that name).

## Ports

- **9093** — INTERNAL SSL (headless).
- **9094** — EXTERNAL per-broker LoadBalancer.

## License

Follow **Off-Campus-Housing-Tracker** upstream license.
